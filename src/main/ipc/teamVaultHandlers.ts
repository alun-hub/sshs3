import path from 'node:path';
import { IPC_CHANNELS, type StorageConnectConfig } from '../../shared/types/ipc';
import {
  TEAM_FOLDER_ICONS,
  type TeamVaultPayload,
  type TeamVaultRole,
  type TeamVaultStatus,
} from '../../shared/types/teamVault';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { S3Config } from '../../shared/types/storage';
import type { IpcBridge } from '../IpcBridge';
import { readSmartcardCertificates } from '../smartcard/SmartcardCertificateReader';
import { createLogger } from '../log';

const teamVaultLog = createLogger('team-vault');

/** The part of IpcBridge this handler group may use. */
export type TeamVaultHost = Pick<
  IpcBridge,
  | 'buildAllTeamVaultStatuses'
  | 'buildTeamVaultStatus'
  | 'registerHandler'
  | 'scheduleTeamVaultAutoPush'
  | 'startTeamVaultAutoPollTimer'
  | 'stopTeamVaultAutoPollTimer'
  | 'storageRegistry'
  | 'syncConfigStore'
  | 'teamVaultConfigStore'
  | 'teamVaultService'
>;

/** Best-effort only — reads whatever authentication-capable smartcard certificate is already
 * configured for Remote Profile Sync (same `smartcardSync.pkcs11LibPath` as
 * `IpcBridge.unlockWithSmartcardInternal`, no new setting needed) and suggests its UPN as a
 * default recipient-id label, purely to save the admin from inventing their own. No PIN prompt —
 * `readSmartcardCertificates` never logs in (public cert objects). Never throws: a missing/absent
 * card, an unconfigured path, or any read error just means no suggestion, not a failed enroll. */
async function suggestLabelFromSmartcard(bridge: TeamVaultHost): Promise<string | undefined> {
  try {
    const pkcs11LibPath = (await bridge.syncConfigStore.getConfig()).smartcardSync?.pkcs11LibPath;
    if (!pkcs11LibPath) return undefined;
    const certs = await readSmartcardCertificates(pkcs11LibPath);
    for (const details of certs.values()) {
      if (details.authCapable && details.upn) return details.upn;
    }
    return undefined;
  } catch (err) {
    teamVaultLog.warn('failed to suggest a label from the smartcard certificate (non-fatal):', err);
    return undefined;
  }
}

// `age`'s own recipient encoding (bech32: lowercase letters + digits only) — also doubles as an
// argument-injection guard, since nothing matching this can start with '-' or contain shell/CLI
// metacharacters.
const AGE_RECIPIENT_PATTERN = /^age1[a-z0-9]{20,}$/;

function requireAgeRecipient(value: string, label: string): void {
  if (typeof value !== 'string' || !AGE_RECIPIENT_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid age recipient string (age1...)`);
  }
}

function requireRecipientId(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new Error(`${label} is required`);
  }
}

function requireRole(role: TeamVaultRole): void {
  if (role !== 'admin' && role !== 'member') {
    throw new Error(`Invalid role "${role}"`);
  }
}

// A vaultId is either one this service itself minted (`vlt_${uuid}`) or the pending-config
// sentinel (`__pending__`, see shared/types/teamVault.ts) — never free-form renderer input used
// to build a filesystem path, so this is primarily an argument-shape guard (defense in depth,
// same posture as `requireIdentityFilePath` below) rather than the primary control against path
// traversal (every vaultId-derived path in TeamVaultService/TeamVaultConfigStore is a plain
// `path.join`, never interpolated into a shell command).
const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function requireVaultId(value: unknown): string {
  if (typeof value !== 'string' || !VAULT_ID_PATTERN.test(value)) {
    throw new Error('A valid vaultId is required');
  }
  return value;
}

/** The identity file is a path the user themselves typed/picked (their own card's identity
 * stanza, or the recovery identity they saved) — unlike a credential, rejecting it outright would
 * defeat the feature, so this only guards against it being mistaken for a CLI flag by `age`
 * (defense in depth; `TeamVaultCryptoService` enforces the same check at the actual exec site). */
function requireIdentityFilePath(value: string): void {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value) || value.startsWith('-')) {
    throw new Error('Identity file path must be an absolute path');
  }
}

// A real profile (host, username, key paths, tunnel definitions, ...) is a few KB at most —
// without a ceiling here, any unlocked (non-admin) member could save a profile with an
// arbitrarily large field (e.g. `group`, `privateKeyPath`), which gets stored verbatim in the
// shared, auto-pushed vault payload and downloaded again by every member on every pull.
const MAX_PROFILE_JSON_SIZE = 256 * 1024;

function requireProfile(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || !(value as { id?: unknown }).id) {
    throw new Error(`${label} is required`);
  }
  if (JSON.stringify(value).length > MAX_PROFILE_JSON_SIZE) {
    throw new Error(`${label} is too large (max ${MAX_PROFILE_JSON_SIZE} bytes serialized)`);
  }
}

function requireVaultName(value: string): void {
  if (typeof value !== 'string' || value.length > 200) {
    throw new Error('Vault name must be a string of at most 200 characters');
  }
}

// `TeamVaultService.saveTeamFolder`/`renameTeamFolder`/`deleteTeamFolder` already reject an
// empty-after-trim path, but nothing there bounds its size — without this, a compromised or
// buggy renderer could push an arbitrarily large (or absurdly deep) path straight into the
// synced, auto-pushed vault payload, bloating it for every member on every pull. 1000 chars /
// 50 segments is generous for a real folder tree while still being a hard ceiling.
const MAX_FOLDER_PATH_LENGTH = 1000;
const MAX_FOLDER_PATH_SEGMENTS = 50;

function requireFolderPath(value: string, label: string): void {
  if (typeof value !== 'string' || value.length > MAX_FOLDER_PATH_LENGTH) {
    throw new Error(`${label} must be a string of at most ${MAX_FOLDER_PATH_LENGTH} characters`);
  }
  if (value.split('/').length > MAX_FOLDER_PATH_SEGMENTS) {
    throw new Error(`${label} is nested too deeply (max ${MAX_FOLDER_PATH_SEGMENTS} segments)`);
  }
}

export function registerTeamVaultHandlers(bridge: TeamVaultHost): void {
  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_GET_STATUS, async (_event, vaultId: string): Promise<TeamVaultStatus> => {
    return bridge.buildTeamVaultStatus(requireVaultId(vaultId));
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_LIST, async (): Promise<TeamVaultStatus[]> => {
    return bridge.buildAllTeamVaultStatuses();
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT, async (_event, vaultId?: string) => {
    // Deliberately optional/unvalidated-as-path-segment here: enrolling a recipient for a vault
    // this machine is about to CREATE or JOIN has no real vaultId to pass yet (see
    // `TeamVaultService.enrollOwnPivRecipient`'s doc comment) — `undefined` is the normal case,
    // not a missing-argument bug. When a caller does pass one (enrolling a second identity for a
    // team already partially set up), it's still checked like any other vaultId.
    const knownVaultId = vaultId === undefined ? undefined : requireVaultId(vaultId);
    const result = await bridge.teamVaultService.enrollOwnPivRecipient(knownVaultId);
    // Only remember this identity when there's no local vault yet for this vaultId — this is the
    // first-time setup flow (about to create or join one), the one case `createVault`'s own
    // `setSelfIdentity` call relies on this having already saved the path. "Generate my
    // recipient" is also always visible once a vault already exists (for joining a *second*
    // team later — docs/team-vault-plan.md), and must NOT overwrite the identity `unlock()`
    // already needs for the current vault — a real regression found via real-world use
    // ("no identity matched any of the recipients" on the next unlock attempt).
    if (knownVaultId) {
      const { exists } = await bridge.teamVaultService.getStatus(knownVaultId);
      if (!exists) {
        await bridge.teamVaultConfigStore.setSelfIdentity(knownVaultId, undefined, result.identityFilePath);
      }
    }
    const suggestedLabel = await suggestLabelFromSmartcard(bridge);
    return { ...result, suggestedLabel };
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_CREATE,
    async (_event, selfRecipientId: string, selfAgeRecipient: string, vaultName?: string) => {
      requireRecipientId(selfRecipientId, 'Recipient id');
      requireAgeRecipient(selfAgeRecipient, 'Age recipient');
      requireVaultName(vaultName ?? '');
      const result = await bridge.teamVaultService.createVault(selfRecipientId, selfAgeRecipient, vaultName);
      await bridge.teamVaultConfigStore.setSelfIdentity(result.vaultId, selfRecipientId, undefined);
      bridge.startTeamVaultAutoPollTimer(result.vaultId);
      return result;
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_RENAME, async (_event, vaultId: string, vaultName: string) => {
    const vid = requireVaultId(vaultId);
    requireVaultName(vaultName);
    await bridge.teamVaultService.renameVault(vid, vaultName);
    bridge.scheduleTeamVaultAutoPush(vid);
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER,
    async (_event, vaultId: string, recipientId: string, ageRecipient: string, role: TeamVaultRole) => {
      const vid = requireVaultId(vaultId);
      requireRecipientId(recipientId, 'Recipient id');
      requireAgeRecipient(ageRecipient, 'Age recipient');
      requireRole(role);
      await bridge.teamVaultService.addMember(vid, recipientId, ageRecipient, role);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_REMOVE_MEMBER, async (_event, vaultId: string, recipientId: string) => {
    const vid = requireVaultId(vaultId);
    requireRecipientId(recipientId, 'Recipient id');
    return bridge.teamVaultService.removeMember(vid, recipientId);
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_SET_ROLE,
    async (_event, vaultId: string, recipientId: string, role: TeamVaultRole) => {
      const vid = requireVaultId(vaultId);
      requireRecipientId(recipientId, 'Recipient id');
      requireRole(role);
      await bridge.teamVaultService.setRole(vid, recipientId, role);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_UNLOCK,
    async (_event, vaultId: string, recipientId: string, identityFilePath: string) => {
      const vid = requireVaultId(vaultId);
      requireRecipientId(recipientId, 'Recipient id');
      requireIdentityFilePath(identityFilePath);
      await bridge.teamVaultService.unlock(vid, recipientId, identityFilePath);
      await bridge.teamVaultConfigStore.setSelfIdentity(vid, recipientId, identityFilePath);
      bridge.startTeamVaultAutoPollTimer(vid);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_UNLOCK_WITH_RECOVERY_TEXT,
    async (_event, vaultId: string, identityText: string) => {
      const vid = requireVaultId(vaultId);
      if (typeof identityText !== 'string' || !identityText.trim() || identityText.length > 10_000) {
        throw new Error('Recovery key text is required');
      }
      await bridge.teamVaultService.unlockWithRecoveryText(vid, identityText);
      bridge.startTeamVaultAutoPollTimer(vid);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_LOCK, async (_event, vaultId: string) => {
    const vid = requireVaultId(vaultId);
    bridge.teamVaultService.lock(vid);
    bridge.stopTeamVaultAutoPollTimer(vid);
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_DELETE, async (_event, vaultId: string) => {
    const vid = requireVaultId(vaultId);
    await bridge.teamVaultService.deleteVault(vid);
    await bridge.teamVaultConfigStore.clearSelfIdentity(vid);
    bridge.stopTeamVaultAutoPollTimer(vid);
  });

  // Distinct from TEAM_VAULT_DELETE: removes a LOCKED vault's local file/identity/config from
  // THIS device only, without the Vault Key — "forget a team I'm no longer actively using here",
  // not an authenticated whole-team-affecting action. See
  // `TeamVaultService.forgetLocalVault`'s doc comment for why it refuses an unlocked vault.
  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_FORGET, async (_event, vaultId: string) => {
    const vid = requireVaultId(vaultId);
    await bridge.teamVaultService.forgetLocalVault(vid);
    await bridge.teamVaultConfigStore.clear(vid);
    bridge.stopTeamVaultAutoPollTimer(vid);
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_SET_TARGET,
    async (_event, vaultId: string, target: StorageConnectConfig, remoteBasePath?: string) => {
      const vid = requireVaultId(vaultId);
      if (!target || !target.id || !target.name) {
        throw new Error('A Team Vault target with an id and name is required');
      }
      if (target.type !== 's3') {
        throw new Error('The Team Vault only supports an S3-compatible target');
      }
      if (!remoteBasePath?.trim()) {
        throw new Error('An S3 target requires a bucket (optionally "bucket/prefix") to sync to');
      }
      await bridge.teamVaultConfigStore.setTarget(vid, target, remoteBasePath);
      await bridge.storageRegistry.disconnect?.(target.id);
      // The (app-lifetime) TeamVaultService instance otherwise keeps comparing against whatever
      // remote state it last observed on the *previous* target — same reasoning as
      // ProfileSyncService.resetRemoteState() in syncHandlers.ts.
      bridge.teamVaultService.resetRemoteState(vid);
      // Restart rather than merely leave running: a stale timer would otherwise keep polling
      // against whatever target it captured when first started, not this new one.
      if (bridge.teamVaultService.isUnlocked(vid)) {
        bridge.startTeamVaultAutoPollTimer(vid);
      }
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_PUSH, async (_event, vaultId: string): Promise<TeamVaultStatus> => {
    const vid = requireVaultId(vaultId);
    const config = await bridge.teamVaultConfigStore.getConfig(vid);
    if (!config.target) {
      throw new Error('Configure a Team Vault target first (team-vault:set-target)');
    }
    const provider = await bridge.storageRegistry.getOrCreate(config.target);
    await bridge.teamVaultService.pushToRemote(vid, provider, config.remoteBasePath ?? '');
    await bridge.teamVaultConfigStore.setLastSyncAt(vid, new Date().toISOString());
    return bridge.buildTeamVaultStatus(vid);
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_PULL,
    async (_event, vaultId: string, options?: { force?: boolean }): Promise<TeamVaultStatus> => {
      const vid = requireVaultId(vaultId);
      const config = await bridge.teamVaultConfigStore.getConfig(vid);
      if (!config.target) {
        throw new Error('Configure a Team Vault target first (team-vault:set-target)');
      }
      const provider = await bridge.storageRegistry.getOrCreate(config.target);
      await bridge.teamVaultService.pullFromRemote(vid, provider, config.remoteBasePath ?? '', options);
      await bridge.teamVaultConfigStore.setLastSyncAt(vid, new Date().toISOString());
      // The first successful pull for a vault configured before its real vaultId was known
      // (joining: a target had to be set up under the pending sentinel to pull from at all —
      // see TEAM_VAULT_PENDING_VAULT_ID's doc comment) reveals that real id here. Promoting is a
      // no-op whenever there was nothing pending (the common case, every pull after the first).
      await bridge.teamVaultConfigStore.promotePendingConfig(vid);
      return bridge.buildTeamVaultStatus(vid);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_HAS_REMOTE_VAULT, async (_event, vaultId: string): Promise<boolean> => {
    const vid = requireVaultId(vaultId);
    const config = await bridge.teamVaultConfigStore.getConfig(vid);
    if (!config.target) return false;
    const provider = await bridge.storageRegistry.getOrCreate(config.target);
    return bridge.teamVaultService.hasRemoteVault(vid, provider, config.remoteBasePath ?? '');
  });

  // Shared SSH/S3 profiles (connection-manager-plan: the Team Vault's actual payoff) — any
  // unlocked member may read/edit them, not just an admin (see TeamVaultService.saveSSHProfile's
  // doc comment: profiles aren't a membership trust boundary). The one exception is the
  // password/secret fields themselves — getPayloadForRenderer strips those for a non-admin
  // before this ever reaches the renderer (see its doc comment).
  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_GET_PAYLOAD, async (_event, vaultId: string): Promise<TeamVaultPayload | null> => {
    const vid = requireVaultId(vaultId);
    if (!bridge.teamVaultService.isUnlocked(vid)) return null;
    try {
      return await bridge.teamVaultService.getPayloadForRenderer(vid);
    } catch (err) {
      teamVaultLog.warn('Failed to read Team Vault payload (treating as unavailable):', err);
      return null;
    }
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_SAVE_SSH_PROFILE, async (_event, vaultId: string, profile: SSHConnectionConfig) => {
    const vid = requireVaultId(vaultId);
    requireProfile(profile, 'SSH profile');
    await bridge.teamVaultService.saveSSHProfile(vid, profile);
    bridge.scheduleTeamVaultAutoPush(vid);
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_DELETE_SSH_PROFILE, async (_event, vaultId: string, id: string) => {
    const vid = requireVaultId(vaultId);
    requireRecipientId(id, 'Profile id');
    await bridge.teamVaultService.deleteSSHProfile(vid, id);
    bridge.scheduleTeamVaultAutoPush(vid);
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_SAVE_S3_PROFILE, async (_event, vaultId: string, profile: S3Config) => {
    const vid = requireVaultId(vaultId);
    requireProfile(profile, 'S3 profile');
    await bridge.teamVaultService.saveS3Profile(vid, profile);
    bridge.scheduleTeamVaultAutoPush(vid);
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_DELETE_S3_PROFILE, async (_event, vaultId: string, id: string) => {
    const vid = requireVaultId(vaultId);
    requireRecipientId(id, 'Profile id');
    await bridge.teamVaultService.deleteS3Profile(vid, id);
    bridge.scheduleTeamVaultAutoPush(vid);
  });

  bridge.registerHandler(IPC_CHANNELS.TEAM_VAULT_SAVE_FOLDER, async (_event, vaultId: string, folderPath: string) => {
    const vid = requireVaultId(vaultId);
    requireFolderPath(folderPath, 'Folder path');
    await bridge.teamVaultService.saveTeamFolder(vid, folderPath);
    bridge.scheduleTeamVaultAutoPush(vid);
  });

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_RENAME_FOLDER,
    async (_event, vaultId: string, oldPath: string, newPath: string) => {
      const vid = requireVaultId(vaultId);
      requireFolderPath(oldPath, 'Folder path');
      requireFolderPath(newPath, 'New folder path');
      await bridge.teamVaultService.renameTeamFolder(vid, oldPath, newPath);
      bridge.scheduleTeamVaultAutoPush(vid);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_DELETE_FOLDER,
    async (_event, vaultId: string, folderPath: string, deleteProfiles?: boolean) => {
      const vid = requireVaultId(vaultId);
      requireFolderPath(folderPath, 'Folder path');
      await bridge.teamVaultService.deleteTeamFolder(vid, folderPath, Boolean(deleteProfiles));
      bridge.scheduleTeamVaultAutoPush(vid);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.TEAM_VAULT_SET_FOLDER_ICON,
    async (_event, vaultId: string, folderPath: string, icon: string | undefined) => {
      const vid = requireVaultId(vaultId);
      requireFolderPath(folderPath, 'Folder path');
      if (icon !== undefined && !(TEAM_FOLDER_ICONS as readonly string[]).includes(icon)) {
        throw new Error(`Unknown folder icon "${icon}"`);
      }
      await bridge.teamVaultService.setTeamFolderIcon(vid, folderPath, icon);
      bridge.scheduleTeamVaultAutoPush(vid);
    }
  );
}
