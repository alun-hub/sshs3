import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IStorageProvider, FileEntry } from '../../shared/types/storage';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { S3Config } from '../../shared/types/storage';
import type { DotfilePool, DotfilePoolFile } from '../../shared/types/dotfiles';
import type { AppSettings } from '../../shared/types/settings';
import { ProfileStore, type ProfilesData } from '../profile/ProfileStore';
import { DotfilePoolStore } from '../dotfiles/DotfilePoolStore';
import { SettingsStore } from '../settings/SettingsStore';
import { SyncCryptoService, SyncLockedError, type SyncDataCategory } from './SyncCryptoService';
import { joinPaths } from '../transfer/TransferPipeline';
import {
  mergeKnownHosts,
  parseManagedSshConfigBlock,
  writeManagedSshConfigBlock,
  type KnownHostsConflict,
} from './SshNativeFileMerger';

const SYNC_DIR_NAME = '.sshs3';

function formatTimestamp(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Builds the remote file paths for a sync target. `remoteBasePath` is
 * required for an S3 target — an S3 "remotePath" is `bucket/key...` with no
 * bucket embedded in S3Config itself (see parseS3Path in
 * S3StorageProvider.ts) — so the bucket (and optionally a sub-path) must be
 * prefixed here. For an SFTP target it's the directory to sync under
 * (empty = the connection's default/home directory).
 */
/**
 * For an SFTP target, anchors a relative base path to the home directory
 * (`~`) explicitly. `SFTPStorageProvider.resolveRemotePath` only resolves
 * paths that are empty or start with `~` against the real home directory —
 * a bare relative path like `.sshs3` is passed through to the server
 * unresolved, and the underlying SFTP client's recursive `mkdir` does not
 * reliably create it in that form, so the very first upload fails with the
 * server's "No such file". S3 paths are always `bucket/key...` already, so
 * this is a no-op for an S3 target.
 */
function resolveEffectiveBasePath(provider: IStorageProvider, remoteBasePath: string): string {
  if (provider.type !== 'sftp') return remoteBasePath;
  const trimmed = remoteBasePath.trim();
  if (!trimmed) return '~';
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return trimmed;
  return `~/${trimmed}`;
}

function buildRemoteFiles(remoteBasePath: string): Record<SyncDataCategory, string> {
  const dir = joinPaths('sftp', remoteBasePath, SYNC_DIR_NAME);
  return {
    topology: joinPaths('sftp', dir, 'topology.enc'),
    credentials: joinPaths('sftp', dir, 'credentials.enc'),
    'dotfile-pools': joinPaths('sftp', dir, 'dotfile-pools.enc'),
    settings: joinPaths('sftp', dir, 'settings.enc'),
    'ssh-native': joinPaths('sftp', dir, 'ssh-native.enc'),
  };
}

export class SyncConflictError extends Error {
  constructor(category: SyncDataCategory) {
    super(
      `Remote "${category}" file changed since it was last read here. Pull the latest changes before pushing again.`
    );
    this.name = 'SyncConflictError';
  }
}

interface Syncable {
  id: string;
  updatedAt?: string;
  deletedAt?: string;
}

/**
 * Merges two arrays of the same syncable record type by id, last-`updatedAt`
 * wins. When the remote copy wins, it's applied on top of the existing local
 * record (not used to replace it outright) so that fields never included in
 * the synced payload — e.g. a local SSH private key path — survive the pull.
 */
export function mergeRecords<T extends Syncable>(local: T[], remote: T[]): { merged: T[]; changed: boolean } {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  let changed = false;

  for (const remoteItem of remote) {
    const localItem = byId.get(remoteItem.id);
    if (!localItem) {
      byId.set(remoteItem.id, remoteItem);
      changed = true;
      continue;
    }
    const remoteTime = remoteItem.updatedAt ?? '';
    const localTime = localItem.updatedAt ?? '';
    if (remoteTime > localTime) {
      const mergedItem: any = { ...localItem, ...remoteItem };
      if (!remoteItem.deletedAt && (localItem as any).deletedAt) {
        delete mergedItem.deletedAt;
      }
      byId.set(remoteItem.id, mergedItem);
      changed = true;
    } else if (remoteTime === localTime) {
      // If timestamps match, but remote has fields that local is missing
      // (e.g. topology was pulled first, credentials unlocked and pulled second),
      // merge the non-empty fields in without overwriting existing local values.
      let updated = false;
      const mergedItem: any = { ...localItem };
      for (const [key, val] of Object.entries(remoteItem)) {
        if (val !== undefined && val !== '' && (mergedItem[key] === undefined || mergedItem[key] === '')) {
          mergedItem[key] = val;
          updated = true;
        }
      }
      if (updated) {
        byId.set(remoteItem.id, mergedItem);
        changed = true;
      }
    }
  }

  return { merged: Array.from(byId.values()), changed };
}

/**
 * Nested merge for dotfile pools: a pool-level tombstone that's newer than
 * the other side wins outright (no point merging files of a pool being
 * deleted); otherwise the pool "shell" (name etc.) is taken from whichever
 * side is newer, but its files are always merged independently via
 * mergeRecords, since a file can be edited on one machine while a sibling
 * file in the same pool is edited on another.
 */
export function mergePools(
  local: DotfilePool[],
  remote: DotfilePool[]
): { merged: DotfilePool[]; changedIds: Set<string> } {
  const byId = new Map<string, DotfilePool>();
  for (const pool of local) byId.set(pool.id, pool);
  const changedIds = new Set<string>();

  for (const remotePool of remote) {
    const localPool = byId.get(remotePool.id);
    if (!localPool) {
      byId.set(remotePool.id, remotePool);
      changedIds.add(remotePool.id);
      continue;
    }

    const remoteIsNewer = (remotePool.updatedAt ?? '') > (localPool.updatedAt ?? '');

    if (remoteIsNewer && remotePool.deletedAt) {
      byId.set(remotePool.id, remotePool);
      changedIds.add(remotePool.id);
      continue;
    }
    if (!remoteIsNewer && localPool.deletedAt) {
      continue; // Local tombstone stands as-is.
    }

    const { merged: mergedFiles, changed: filesChanged } = mergeRecords<DotfilePoolFile>(
      localPool.files,
      remotePool.files
    );
    const winnerShell = remoteIsNewer ? remotePool : localPool;
    byId.set(remotePool.id, { ...winnerShell, files: mergedFiles });
    if (remoteIsNewer || filesChanged) {
      changedIds.add(remotePool.id);
    }
  }

  return { merged: Array.from(byId.values()), changedIds };
}

interface FieldSplitSpec<T> {
  /** Fields that hold secrets and belong in credentials.enc, not topology.enc. */
  credentialFields: Array<keyof T>;
  /** Local-only fields (e.g. a filesystem path to a private key) that are never synced at all. */
  excludedFields: Array<keyof T>;
  /** Sub-fields of an optional `proxy` object that are credential-tier. */
  proxyCredentialFields: Array<'username' | 'password'>;
}

const SSH_FIELD_SPLIT: FieldSplitSpec<SSHConnectionConfig> = {
  credentialFields: ['username', 'password', 'passphrase'],
  excludedFields: ['privateKeyPath', 'pkcs11LibPath', 'agentPath'],
  proxyCredentialFields: ['username', 'password'],
};

const S3_FIELD_SPLIT: FieldSplitSpec<S3Config> = {
  credentialFields: ['accessKeyId', 'secretAccessKey', 'sessionToken'],
  excludedFields: ['customCaPath'],
  proxyCredentialFields: ['username', 'password'],
};

/** Splits one record into its topology-tier and credentials-tier halves, both keeping `id` so they can be rejoined. */
function splitFields<T extends { id: string; proxy?: { username?: string; password?: string } }>(
  item: T,
  spec: FieldSplitSpec<T>
): { topology: Partial<T>; credentials: Partial<T> } {
  const topology: any = { ...item };
  for (const field of spec.excludedFields) {
    delete topology[field];
  }

  const credentials: any = { id: item.id };
  for (const field of spec.credentialFields) {
    if (topology[field] !== undefined) {
      credentials[field] = topology[field];
    }
    delete topology[field];
  }

  if (topology.proxy && spec.proxyCredentialFields.length > 0) {
    const proxy = { ...topology.proxy };
    const proxyCredentials: any = {};
    for (const field of spec.proxyCredentialFields) {
      if (proxy[field] !== undefined) {
        proxyCredentials[field] = proxy[field];
      }
      delete proxy[field];
    }
    topology.proxy = proxy;
    if (Object.keys(proxyCredentials).length > 0) {
      credentials.proxy = proxyCredentials;
    }
  }

  return { topology, credentials };
}

/** Rejoins a topology half with its matching credentials half (if any) back into one full record. */
function joinFields<T extends { id: string; proxy?: any }>(topology: Partial<T>, credentials?: Partial<T>): T {
  const merged: any = { ...topology };
  if (credentials) {
    for (const [key, value] of Object.entries(credentials)) {
      if (key === 'id') continue;
      if (key === 'proxy') {
        merged.proxy = { ...(merged.proxy ?? {}), ...(value as any) };
      } else {
        merged[key] = value;
      }
    }
  }
  return merged as T;
}

function joinById<T extends { id: string }>(topologyHalves: Partial<T>[], credentialHalves: Partial<T>[]): T[] {
  const credentialsById = new Map<string, Partial<T>>();
  for (const half of credentialHalves) {
    if (half.id) credentialsById.set(half.id, half);
  }
  const ids = new Set<string>();
  const results: T[] = [];
  for (const topologyHalf of topologyHalves) {
    if (!topologyHalf.id || ids.has(topologyHalf.id)) continue;
    ids.add(topologyHalf.id);
    results.push(joinFields<T>(topologyHalf, credentialsById.get(topologyHalf.id)));
  }
  return results;
}

interface TopologyPayload {
  ssh: Partial<SSHConnectionConfig>[];
  s3: Partial<S3Config>[];
}
interface CredentialsPayload {
  ssh: Partial<SSHConnectionConfig>[];
  s3: Partial<S3Config>[];
}
interface DotfilePoolsPayload {
  pools: DotfilePool[];
}
interface SshNativePayload {
  sshConfigBlock: { updatedAt: string; body: string } | null;
  knownHostsContent: string;
}

import type {
  ProfileSyncPullResult,
  SyncComparisonResult,
  CategoryComparison,
} from '../../shared/types/sync';

export type PullResult = ProfileSyncPullResult;

export interface ProfileSyncServiceOptions {
  sshConfigPath?: string;
  knownHostsPath?: string;
}

export function getComparisonState(ahead: number, behind: number): 'in_sync' | 'ahead' | 'behind' | 'diverged' {
  if (ahead > 0 && behind > 0) return 'diverged';
  if (ahead > 0) return 'ahead';
  if (behind > 0) return 'behind';
  return 'in_sync';
}

export function compareRecords<T extends { id: string; name?: string; updatedAt?: string; deletedAt?: string }>(
  local: T[],
  remote: T[],
  label: string,
  spec?: FieldSplitSpec<any>
): { ahead: number; behind: number; details: string[] } {
  const localById = new Map<string, T>();
  for (const item of local) localById.set(item.id, item);

  const remoteById = new Map<string, T>();
  for (const item of remote) remoteById.set(item.id, item);

  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
  let ahead = 0;
  let behind = 0;
  const details: string[] = [];

  for (const id of allIds) {
    const localItem = localById.get(id);
    const remoteItem = remoteById.get(id);

    if (localItem && !remoteItem) {
      if (!localItem.deletedAt) {
        ahead++;
        details.push(`${label} "${localItem.name ?? id}" created locally`);
      }
      continue;
    }

    if (!localItem && remoteItem) {
      if (!remoteItem.deletedAt) {
        behind++;
        details.push(`${label} "${remoteItem.name ?? id}" added on remote`);
      }
      continue;
    }

    if (localItem && remoteItem) {
      if (localItem.deletedAt && !remoteItem.deletedAt) {
        const localDel = localItem.deletedAt ?? '';
        const remoteUpd = remoteItem.updatedAt ?? '';
        if (localDel >= remoteUpd) {
          ahead++;
          details.push(`${label} "${localItem.name ?? id}" deleted locally`);
        } else {
          behind++;
          details.push(`${label} "${remoteItem.name ?? id}" updated on remote`);
        }
        continue;
      }

      if (!localItem.deletedAt && remoteItem.deletedAt) {
        const remoteDel = remoteItem.deletedAt ?? '';
        const localUpd = localItem.updatedAt ?? '';
        if (remoteDel >= localUpd) {
          behind++;
          details.push(`${label} "${remoteItem.name ?? id}" deleted on remote`);
        } else {
          ahead++;
          details.push(`${label} "${localItem.name ?? id}" updated locally`);
        }
        continue;
      }

      if (localItem.deletedAt && remoteItem.deletedAt) {
        continue; // Both deleted, in sync
      }

      // Both active
      const localTime = localItem.updatedAt ?? '';
      const remoteTime = remoteItem.updatedAt ?? '';
      if (localTime > remoteTime) {
        ahead++;
        details.push(`${label} "${localItem.name ?? id}" updated locally`);
      } else if (remoteTime > localTime) {
        behind++;
        details.push(`${label} "${remoteItem.name ?? id}" updated on remote`);
      } else if (spec) {
        const localSyncable = splitFields(localItem, spec);
        const remoteSyncable = splitFields(remoteItem, spec);
        if (JSON.stringify(localSyncable) !== JSON.stringify(remoteSyncable)) {
          ahead++;
          details.push(`${label} "${localItem.name ?? id}" modified locally`);
        }
      }
    }
  }

  return { ahead, behind, details };
}

export function compareDotfilePools(
  local: DotfilePool[],
  remote: DotfilePool[]
): { ahead: number; behind: number; details: string[] } {
  const localById = new Map<string, DotfilePool>();
  for (const pool of local) localById.set(pool.id, pool);

  const remoteById = new Map<string, DotfilePool>();
  for (const pool of remote) remoteById.set(pool.id, pool);

  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
  let ahead = 0;
  let behind = 0;
  const details: string[] = [];

  for (const id of allIds) {
    const localPool = localById.get(id);
    const remotePool = remoteById.get(id);

    if (localPool && !remotePool) {
      if (!localPool.deletedAt) {
        ahead++;
        details.push(`Dotfile pool "${localPool.name}" created locally`);
      }
      continue;
    }

    if (!localPool && remotePool) {
      if (!remotePool.deletedAt) {
        behind++;
        details.push(`Dotfile pool "${remotePool.name}" added on remote`);
      }
      continue;
    }

    if (localPool && remotePool) {
      if (localPool.deletedAt && !remotePool.deletedAt) {
        if ((localPool.deletedAt ?? '') >= (remotePool.updatedAt ?? '')) {
          ahead++;
          details.push(`Dotfile pool "${localPool.name}" deleted locally`);
        } else {
          behind++;
          details.push(`Dotfile pool "${remotePool.name}" updated on remote`);
        }
        continue;
      }

      if (!localPool.deletedAt && remotePool.deletedAt) {
        if ((remotePool.deletedAt ?? '') >= (localPool.updatedAt ?? '')) {
          behind++;
          details.push(`Dotfile pool "${remotePool.name}" deleted on remote`);
        } else {
          ahead++;
          details.push(`Dotfile pool "${localPool.name}" updated locally`);
        }
        continue;
      }

      if (localPool.deletedAt && remotePool.deletedAt) {
        continue;
      }

      // Check pool files
      const fileComp = compareRecords(localPool.files, remotePool.files, `File in "${localPool.name}"`);
      if (fileComp.ahead > 0 || fileComp.behind > 0) {
        ahead += fileComp.ahead;
        behind += fileComp.behind;
        details.push(...fileComp.details);
      } else {
        const localTime = localPool.updatedAt ?? '';
        const remoteTime = remotePool.updatedAt ?? '';
        if (localTime > remoteTime) {
          ahead++;
          details.push(`Dotfile pool "${localPool.name}" updated locally`);
        } else if (remoteTime > localTime) {
          behind++;
          details.push(`Dotfile pool "${remotePool.name}" updated on remote`);
        }
      }
    }
  }

  return { ahead, behind, details };
}

/**
 * Pushes/pulls the app's local data to/from a remote S3/SFTP location as a
 * set of Zero-Knowledge encrypted files, via an already-connected
 * IStorageProvider. Handling of the sync target's own connection details and
 * of the master passwords' lifecycle (setup/enable/unlock UI) is a separate
 * concern (IPC + Renderer layer) — this service only implements the crypto,
 * merge, and file-transfer mechanics.
 */
export class ProfileSyncService {
  private readonly sshConfigPath: string;
  private readonly knownHostsPath: string;
  /**
   * Last known remote file state per category, used for optimistic
   * concurrency (see checkNotChangedRemotely). In-memory only for this
   * service — persisting it across app restarts is a concern for the
   * IPC/settings layer that owns this service's lifecycle.
   */
  private readonly lastKnownRemoteState = new Map<SyncDataCategory, FileEntry | null>();
  private lastComparison: SyncComparisonResult | null = null;

  public getLastComparison(): SyncComparisonResult | null {
    return this.lastComparison;
  }

  constructor(
    private readonly profileStore: ProfileStore,
    private readonly dotfilePoolStore: DotfilePoolStore,
    private readonly settingsStore: SettingsStore,
    private readonly cryptoService: SyncCryptoService,
    options: ProfileSyncServiceOptions = {}
  ) {
    this.sshConfigPath = options.sshConfigPath ?? path.join(os.homedir(), '.ssh', 'config');
    this.knownHostsPath = options.knownHostsPath ?? path.join(os.homedir(), '.ssh', 'known_hosts');
  }

  /**
   * Whether this sync target already has data pushed from some machine.
   * Used to refuse generating a brand new salt (which would silently start
   * an incompatible, unrelated sync history) on a machine that should
   * instead bootstrap via pullFromRemote().
   */
  public async hasRemoteData(provider: IStorageProvider, remoteBasePath = ''): Promise<boolean> {
    const remoteFiles = buildRemoteFiles(resolveEffectiveBasePath(provider, remoteBasePath));
    return (await this.statOrNull(provider, remoteFiles.topology)) !== null;
  }

  // ---------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------

  public async pushToRemote(provider: IStorageProvider, remoteBasePath = ''): Promise<void> {
    if (!this.cryptoService.isUnlocked('topology')) {
      throw new SyncLockedError('topology');
    }
    if (!this.cryptoService.isUnlocked('credentials')) {
      throw new SyncLockedError('credentials');
    }

    const effectiveBasePath = resolveEffectiveBasePath(provider, remoteBasePath);
    const remoteFiles = buildRemoteFiles(effectiveBasePath);
    const syncDir = joinPaths('sftp', effectiveBasePath, SYNC_DIR_NAME);
    await provider.createFolder(syncDir).catch(() => {
      // Already exists, or the provider creates directories implicitly (S3).
    });
    if (provider.chmod) {
      await provider.chmod(syncDir, 0o700).catch(() => {});
    }

    const [profiles, pools, settings, sshNativePayload] = await Promise.all([
      this.profileStore.getProfilesIncludingTombstones(),
      this.dotfilePoolStore.getPoolsIncludingTombstones(),
      this.settingsStore.getSettings(),
      this.buildLocalSshNativePayload(),
    ]);

    const sshSplit = profiles.ssh.map((item) => splitFields(item, SSH_FIELD_SPLIT));
    const s3Split = profiles.s3.map((item) => splitFields(item, S3_FIELD_SPLIT));

    const topologyPayload: TopologyPayload = {
      ssh: sshSplit.map((s) => s.topology),
      s3: s3Split.map((s) => s.topology),
    };
    const credentialsPayload: CredentialsPayload = {
      ssh: sshSplit.map((s) => s.credentials),
      s3: s3Split.map((s) => s.credentials),
    };
    const dotfilePoolsPayload: DotfilePoolsPayload = { pools };

    await this.checkNotChangedRemotely(provider, 'topology', remoteFiles);
    await this.checkNotChangedRemotely(provider, 'credentials', remoteFiles);
    await this.checkNotChangedRemotely(provider, 'dotfile-pools', remoteFiles);
    await this.checkNotChangedRemotely(provider, 'settings', remoteFiles);
    await this.checkNotChangedRemotely(provider, 'ssh-native', remoteFiles);

    await this.encryptAndUpload(provider, 'topology', JSON.stringify(topologyPayload), remoteFiles);
    await this.encryptAndUpload(provider, 'credentials', JSON.stringify(credentialsPayload), remoteFiles);
    await this.encryptAndUpload(provider, 'dotfile-pools', JSON.stringify(dotfilePoolsPayload), remoteFiles);
    await this.encryptAndUpload(provider, 'settings', JSON.stringify(settings), remoteFiles);
    await this.encryptAndUpload(provider, 'ssh-native', JSON.stringify(sshNativePayload), remoteFiles);

    this.lastComparison = {
      state: 'in_sync',
      aheadCount: 0,
      behindCount: 0,
      categories: [
        { category: 'topology', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'credentials', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'dotfile-pools', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'settings', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'ssh-native', state: 'in_sync', ahead: 0, behind: 0 },
      ],
      checkedAt: formatTimestamp(),
    };
  }

  // ---------------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------------

  public async pullFromRemote(
    provider: IStorageProvider,
    remoteBasePath = '',
    passwords?: { topology?: string; credentials?: string }
  ): Promise<PullResult> {
    const remoteFiles = buildRemoteFiles(resolveEffectiveBasePath(provider, remoteBasePath));
    const changedCategories: SyncDataCategory[] = [];

    const [topologyRaw, credentialsRaw, dotfilePoolsRaw, settingsRaw, sshNativeRaw] = await Promise.all([
      this.downloadAndDecrypt(provider, 'topology', remoteFiles, passwords?.topology),
      this.downloadAndDecrypt(provider, 'credentials', remoteFiles, passwords?.credentials),
      this.downloadAndDecrypt(provider, 'dotfile-pools', remoteFiles, passwords?.credentials),
      this.downloadAndDecrypt(provider, 'settings', remoteFiles, passwords?.topology),
      this.downloadAndDecrypt(provider, 'ssh-native', remoteFiles, passwords?.credentials),
    ]);

    if (topologyRaw !== null || credentialsRaw !== null) {
      const topology: TopologyPayload = topologyRaw ? JSON.parse(topologyRaw) : { ssh: [], s3: [] };
      const credentials: CredentialsPayload = credentialsRaw ? JSON.parse(credentialsRaw) : { ssh: [], s3: [] };

      const remoteSsh = joinById<SSHConnectionConfig>(topology.ssh, credentials.ssh);
      const remoteS3 = joinById<S3Config>(topology.s3, credentials.s3);

      const local = await this.profileStore.getProfilesIncludingTombstones();
      const sshResult = mergeRecords(local.ssh, remoteSsh);
      const s3Result = mergeRecords(local.s3, remoteS3);

      if (sshResult.changed || s3Result.changed) {
        const merged: ProfilesData = { ssh: sshResult.merged, s3: s3Result.merged };
        await this.profileStore.replaceAll(merged);
        changedCategories.push('topology', 'credentials');
      }
    }

    if (dotfilePoolsRaw !== null) {
      const remotePayload: DotfilePoolsPayload = JSON.parse(dotfilePoolsRaw);
      const local = await this.dotfilePoolStore.getPoolsIncludingTombstones();
      const { merged, changedIds } = mergePools(local, remotePayload.pools);
      if (changedIds.size > 0) {
        const mergedById = new Map(merged.map((pool) => [pool.id, pool]));
        for (const id of changedIds) {
          const pool = mergedById.get(id);
          if (pool) {
            await this.dotfilePoolStore.savePool(pool, { preserveTimestamps: true });
          }
        }
        changedCategories.push('dotfile-pools');
      }
    }

    if (settingsRaw !== null) {
      const remoteSettings: AppSettings = JSON.parse(settingsRaw);
      const localSettings = await this.settingsStore.getSettings();
      if ((remoteSettings.updatedAt ?? '') > (localSettings.updatedAt ?? '')) {
        await this.settingsStore.saveSettings(remoteSettings, { preserveTimestamp: true });
        changedCategories.push('settings');
      }
    }

    let sshNativeConflicts: KnownHostsConflict[] = [];
    if (sshNativeRaw !== null) {
      const remotePayload: SshNativePayload = JSON.parse(sshNativeRaw);
      const applied = await this.applySshNativePayload(remotePayload);
      if (applied.changed) {
        changedCategories.push('ssh-native');
      }
      sshNativeConflicts = applied.conflicts;
    }

    this.lastComparison = {
      state: 'in_sync',
      aheadCount: 0,
      behindCount: 0,
      categories: [
        { category: 'topology', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'credentials', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'dotfile-pools', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'settings', state: 'in_sync', ahead: 0, behind: 0 },
        { category: 'ssh-native', state: 'in_sync', ahead: 0, behind: 0 },
      ],
      checkedAt: formatTimestamp(),
    };

    return { changedCategories, sshNativeConflicts };
  }

  // ---------------------------------------------------------------------
  // Compare / Sync state detection
  // ---------------------------------------------------------------------

  public async compareWithRemote(
    provider: IStorageProvider,
    remoteBasePath = ''
  ): Promise<SyncComparisonResult> {
    if (!this.cryptoService.isUnlocked('topology') || !this.cryptoService.isUnlocked('credentials')) {
      throw new SyncLockedError('topology');
    }

    const effectiveBasePath = resolveEffectiveBasePath(provider, remoteBasePath);
    const remoteFiles = buildRemoteFiles(effectiveBasePath);

    const hasTopology = (await this.statOrNull(provider, remoteFiles.topology)) !== null;

    const [localProfiles, localPools, localSettings, localSshNative] = await Promise.all([
      this.profileStore.getProfilesIncludingTombstones(),
      this.dotfilePoolStore.getPoolsIncludingTombstones(),
      this.settingsStore.getSettings(),
      this.buildLocalSshNativePayload(),
    ]);

    if (!hasTopology) {
      const activeSsh = localProfiles.ssh.filter((p) => !p.deletedAt).length;
      const activeS3 = localProfiles.s3.filter((p) => !p.deletedAt).length;
      const activePools = localPools.filter((p) => !p.deletedAt).length;
      const totalAhead = activeSsh + activeS3 + activePools + (localSettings ? 1 : 0);

      const result: SyncComparisonResult = {
        state: 'not_initialized',
        aheadCount: totalAhead,
        behindCount: 0,
        categories: [
          {
            category: 'topology',
            state: activeSsh + activeS3 > 0 ? 'ahead' : 'in_sync',
            ahead: activeSsh + activeS3,
            behind: 0,
            details: ['Remote sync target is not initialized'],
          },
          {
            category: 'credentials',
            state: activeSsh + activeS3 > 0 ? 'ahead' : 'in_sync',
            ahead: activeSsh + activeS3,
            behind: 0,
          },
          {
            category: 'dotfile-pools',
            state: activePools > 0 ? 'ahead' : 'in_sync',
            ahead: activePools,
            behind: 0,
          },
          {
            category: 'settings',
            state: 'ahead',
            ahead: 1,
            behind: 0,
          },
          {
            category: 'ssh-native',
            state: 'in_sync',
            ahead: 0,
            behind: 0,
          },
        ],
        checkedAt: formatTimestamp(),
      };
      this.lastComparison = result;
      return result;
    }

    const [topologyRaw, credentialsRaw, dotfilePoolsRaw, settingsRaw, sshNativeRaw] = await Promise.all([
      this.downloadAndDecrypt(provider, 'topology', remoteFiles),
      this.downloadAndDecrypt(provider, 'credentials', remoteFiles),
      this.downloadAndDecrypt(provider, 'dotfile-pools', remoteFiles),
      this.downloadAndDecrypt(provider, 'settings', remoteFiles),
      this.downloadAndDecrypt(provider, 'ssh-native', remoteFiles),
    ]);

    const categories: CategoryComparison[] = [];

    // 1. Topology & Credentials
    const topology: TopologyPayload = topologyRaw ? JSON.parse(topologyRaw) : { ssh: [], s3: [] };
    const credentials: CredentialsPayload = credentialsRaw ? JSON.parse(credentialsRaw) : { ssh: [], s3: [] };
    const remoteSsh = joinById<SSHConnectionConfig>(topology.ssh, credentials.ssh);
    const remoteS3 = joinById<S3Config>(topology.s3, credentials.s3);

    const sshComp = compareRecords(localProfiles.ssh, remoteSsh, 'SSH profile', SSH_FIELD_SPLIT);
    const s3Comp = compareRecords(localProfiles.s3, remoteS3, 'S3 profile', S3_FIELD_SPLIT);

    const profilesAhead = sshComp.ahead + s3Comp.ahead;
    const profilesBehind = sshComp.behind + s3Comp.behind;
    const profilesDetails = [...sshComp.details, ...s3Comp.details];
    const profilesState = getComparisonState(profilesAhead, profilesBehind);

    categories.push({
      category: 'topology',
      state: profilesState,
      ahead: profilesAhead,
      behind: profilesBehind,
      details: profilesDetails,
    });
    categories.push({
      category: 'credentials',
      state: profilesState,
      ahead: profilesAhead,
      behind: profilesBehind,
    });

    // 2. Dotfile Pools
    const remotePools: DotfilePool[] = dotfilePoolsRaw ? JSON.parse(dotfilePoolsRaw).pools ?? [] : [];
    const poolsComp = compareDotfilePools(localPools, remotePools);
    categories.push({
      category: 'dotfile-pools',
      state: getComparisonState(poolsComp.ahead, poolsComp.behind),
      ahead: poolsComp.ahead,
      behind: poolsComp.behind,
      details: poolsComp.details,
    });

    // 3. Settings
    const remoteSettings: AppSettings | null = settingsRaw ? JSON.parse(settingsRaw) : null;
    let settingsAhead = 0;
    let settingsBehind = 0;
    const settingsDetails: string[] = [];
    if (remoteSettings) {
      const localTime = localSettings.updatedAt ?? '';
      const remoteTime = remoteSettings.updatedAt ?? '';
      if (localTime > remoteTime) {
        settingsAhead = 1;
        settingsDetails.push('Settings modified locally');
      } else if (remoteTime > localTime) {
        settingsBehind = 1;
        settingsDetails.push('Settings modified on remote');
      }
    }
    categories.push({
      category: 'settings',
      state: getComparisonState(settingsAhead, settingsBehind),
      ahead: settingsAhead,
      behind: settingsBehind,
      details: settingsDetails,
    });

    // 4. SSH Native
    const remoteSshNative: SshNativePayload | null = sshNativeRaw ? JSON.parse(sshNativeRaw) : null;
    let sshNativeAhead = 0;
    let sshNativeBehind = 0;
    const sshNativeDetails: string[] = [];

    if (remoteSshNative?.sshConfigBlock) {
      const localBlock = localSshNative.sshConfigBlock;
      if (!localBlock) {
        sshNativeBehind += 1;
        sshNativeDetails.push('Managed SSH config block on remote');
      } else if (localBlock.updatedAt > remoteSshNative.sshConfigBlock.updatedAt) {
        sshNativeAhead += 1;
        sshNativeDetails.push('Managed SSH config block updated locally');
      } else if (remoteSshNative.sshConfigBlock.updatedAt > localBlock.updatedAt) {
        sshNativeBehind += 1;
        sshNativeDetails.push('Managed SSH config block updated on remote');
      }
    } else if (localSshNative.sshConfigBlock) {
      sshNativeAhead += 1;
      sshNativeDetails.push('Managed SSH config block created locally');
    }

    if (remoteSshNative?.knownHostsContent) {
      const localMerge = mergeKnownHosts(localSshNative.knownHostsContent, remoteSshNative.knownHostsContent);
      if (localMerge.addedCount > 0 || localMerge.conflicts.length > 0) {
        const count = localMerge.addedCount + localMerge.conflicts.length;
        sshNativeBehind += count;
        sshNativeDetails.push(`${count} known_hosts key(s) on remote`);
      }
      const remoteMerge = mergeKnownHosts(remoteSshNative.knownHostsContent, localSshNative.knownHostsContent);
      if (remoteMerge.addedCount > 0) {
        sshNativeAhead += remoteMerge.addedCount;
        sshNativeDetails.push(`${remoteMerge.addedCount} local known_hosts key(s) to push`);
      }
    }

    categories.push({
      category: 'ssh-native',
      state: getComparisonState(sshNativeAhead, sshNativeBehind),
      ahead: sshNativeAhead,
      behind: sshNativeBehind,
      details: sshNativeDetails,
    });

    const totalAhead = profilesAhead + poolsComp.ahead + settingsAhead + sshNativeAhead;
    const totalBehind = profilesBehind + poolsComp.behind + settingsBehind + sshNativeBehind;

    const result: SyncComparisonResult = {
      state: getComparisonState(totalAhead, totalBehind),
      aheadCount: totalAhead,
      behindCount: totalBehind,
      categories,
      checkedAt: formatTimestamp(),
    };
    this.lastComparison = result;
    return result;
  }

  // ---------------------------------------------------------------------
  // ssh-native (~/.ssh/config managed block + ~/.ssh/known_hosts)
  // ---------------------------------------------------------------------

  private async buildLocalSshNativePayload(): Promise<SshNativePayload> {
    const sshConfigContent = await this.readLocalFile(this.sshConfigPath);
    const knownHostsContent = await this.readLocalFile(this.knownHostsPath);
    return {
      sshConfigBlock: parseManagedSshConfigBlock(sshConfigContent ?? ''),
      knownHostsContent: knownHostsContent ?? '',
    };
  }

  private async applySshNativePayload(
    remotePayload: SshNativePayload
  ): Promise<{ changed: boolean; conflicts: KnownHostsConflict[] }> {
    let changed = false;
    const conflicts: KnownHostsConflict[] = [];

    if (remotePayload.sshConfigBlock) {
      const localContent = (await this.readLocalFile(this.sshConfigPath)) ?? '';
      const localBlock = parseManagedSshConfigBlock(localContent);
      if (!localBlock || remotePayload.sshConfigBlock.updatedAt > localBlock.updatedAt) {
        const updated = writeManagedSshConfigBlock(localContent, remotePayload.sshConfigBlock);
        await this.writeLocalFile(this.sshConfigPath, updated);
        changed = true;
      }
    }

    const localKnownHosts = (await this.readLocalFile(this.knownHostsPath)) ?? '';
    const knownHostsResult = mergeKnownHosts(localKnownHosts, remotePayload.knownHostsContent);
    conflicts.push(...knownHostsResult.conflicts);
    if (knownHostsResult.changed) {
      await this.writeLocalFile(this.knownHostsPath, knownHostsResult.mergedContent);
      changed = true;
    }

    return { changed, conflicts };
  }

  private async readLocalFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  private async writeLocalFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  // ---------------------------------------------------------------------
  // Remote transfer helpers
  // ---------------------------------------------------------------------

  /**
   * Optimistic concurrency check: refuses to push if the remote file has
   * changed since it was last read/written by this service instance, rather
   * than silently overwriting another machine's newer push.
   */
  private async checkNotChangedRemotely(
    provider: IStorageProvider,
    category: SyncDataCategory,
    remoteFiles: Record<SyncDataCategory, string>
  ): Promise<void> {
    const known = this.lastKnownRemoteState.get(category);
    if (known === undefined) return; // Never observed remotely from this instance — nothing to compare against.

    const current = await this.statOrNull(provider, remoteFiles[category]);
    const unchanged =
      (known === null && current === null) ||
      (known !== null && current !== null && known.size === current.size && known.mtime === current.mtime);

    if (!unchanged) {
      throw new SyncConflictError(category);
    }
  }

  private isNotFoundError(err: any): boolean {
    if (!err) return false;
    const code = err.code || err.$metadata?.httpStatusCode;
    if (code === 'ENOENT' || code === 2 || code === 404 || code === 'NotFound' || code === 'NoSuchKey') {
      return true;
    }
    const name = err.name || '';
    if (name === 'NoSuchKey' || name === 'NotFound') {
      return true;
    }
    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
    if (
      msg.includes('no such file') ||
      msg.includes('file does not exist') ||
      msg.includes('does not exist') ||
      msg.includes('not found')
    ) {
      if (
        msg.includes('host not found') ||
        msg.includes('socket not found') ||
        msg.includes('getaddrinfo') ||
        msg.includes('connect')
      ) {
        return false;
      }
      return true;
    }
    return false;
  }

  private async statOrNull(provider: IStorageProvider, remotePath: string): Promise<FileEntry | null> {
    try {
      return await provider.stat(remotePath);
    } catch (err: any) {
      if (this.isNotFoundError(err)) {
        return null;
      }
      throw err;
    }
  }

  private async encryptAndUpload(
    provider: IStorageProvider,
    category: SyncDataCategory,
    plaintext: string,
    remoteFiles: Record<SyncDataCategory, string>
  ): Promise<void> {
    const encrypted = this.cryptoService.encrypt(category, plaintext);
    const targetPath = remoteFiles[category];

    if (provider.type === 's3') {
      // S3 PutObject is inherently atomic (replaces the key atomically).
      // Writing directly avoids multipart CopyObject/DeleteObject races, replication latency,
      // and eliminates the need for separate s3:DeleteObject permissions.
      await this.writeProviderFile(provider, targetPath, encrypted);
    } else {
      const tmpPath = `${targetPath}.tmp-${crypto.randomUUID()}`;
      await this.writeProviderFile(provider, tmpPath, encrypted);
      try {
        await provider.rename(tmpPath, targetPath);
      } catch (err) {
        await provider.delete(tmpPath, false).catch(() => {});
        throw err;
      }
    }

    if (provider.chmod) {
      await provider.chmod(targetPath, 0o600).catch(() => {});
    }

    this.lastKnownRemoteState.set(category, await this.statOrNull(provider, targetPath));
  }

  /** Returns null if the remote file doesn't exist yet (first sync). */
  private async downloadAndDecrypt(
    provider: IStorageProvider,
    category: SyncDataCategory,
    remoteFiles: Record<SyncDataCategory, string>,
    password?: string
  ): Promise<string | null> {
    const remotePath = remoteFiles[category];
    const stat = await this.statOrNull(provider, remotePath);
    if (!stat) {
      this.lastKnownRemoteState.set(category, null);
      return null;
    }

    const buffer = await this.readProviderFile(provider, remotePath);
    this.lastKnownRemoteState.set(category, stat);
    return this.cryptoService.decrypt(category, buffer, password);
  }

  private async readProviderFile(provider: IStorageProvider, remotePath: string): Promise<Buffer> {
    if (typeof provider.readFile === 'function') {
      return provider.readFile(remotePath);
    }

    const stream = await provider.createReadStream(remotePath);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return Buffer.concat(chunks);
  }

  private async writeProviderFile(provider: IStorageProvider, remotePath: string, buffer: Buffer): Promise<void> {
    if (typeof provider.writeFile === 'function') {
      await provider.writeFile(remotePath, buffer, { mode: 0o600, size: buffer.length });
      return;
    }

    const stream = await provider.createWriteStream(remotePath, { mode: 0o600, size: buffer.length });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const fail = (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };
      stream.once('finish', finish);
      stream.once('error', fail);
      stream.end(buffer);
    });
  }
}
