import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type {
  TeamVaultAccessEntry,
  TeamVaultFile,
  TeamVaultMemberSummary,
  TeamVaultRole,
  TeamVaultStatus,
} from '../../shared/types/teamVault';
import type { FileEntry, IStorageProvider } from '../../shared/types/storage';
import { joinPaths } from '../transfer/TransferPipeline';
import { TeamVaultCryptoService } from './TeamVaultCryptoService';

const FORMAT_VERSION = 1 as const;
const REMOTE_VAULT_FILENAME = 'team-vault/vault.json';

export class TeamVaultSyncConflictError extends Error {
  constructor() {
    super('Remote Team Vault changed since it was last read here. Pull the latest changes before pushing again.');
    this.name = 'TeamVaultSyncConflictError';
  }
}

/** A remote write-access holder is not necessarily a vault recipient (bucket IAM vs. vault
 * membership are different trust domains) — this is thrown rather than silently overwriting
 * whatever unrelated (or malicious) content sits at the configured path. */
export class TeamVaultForeignVaultError extends Error {
  constructor() {
    super(
      'A different Team Vault already exists at this S3 target. Pull it, or point this vault at a different bucket/prefix.'
    );
    this.name = 'TeamVaultForeignVaultError';
  }
}

export class TeamVaultRollbackError extends Error {
  constructor() {
    super(
      'The remote Team Vault is older than what is already stored locally — refusing to roll back (possible tampering or a stale remote copy).'
    );
    this.name = 'TeamVaultRollbackError';
  }
}

function isValidAccessEntry(e: any): e is TeamVaultAccessEntry {
  return (
    e &&
    typeof e.recipientId === 'string' &&
    e.recipientId.length > 0 &&
    (e.role === 'admin' || e.role === 'member') &&
    typeof e.ageRecipient === 'string' &&
    e.ageRecipient.length > 0 &&
    typeof e.wrappedVaultKey === 'string' &&
    e.wrappedVaultKey.length > 0 &&
    typeof e.addedAt === 'string' &&
    typeof e.addedBy === 'string'
  );
}

/** Full-shape validation for a vault file pulled from a remote we don't control the writer of —
 * a shallow "has the right top-level keys" check isn't enough, since a malformed entry (e.g.
 * missing `ageRecipient`) would otherwise only fail later, deep inside `removeMember`'s re-wrap
 * loop, with a confusing error. */
function assertValidVaultFile(file: any): asserts file is TeamVaultFile {
  if (
    !file ||
    file.formatVersion !== FORMAT_VERSION ||
    typeof file.vaultId !== 'string' ||
    !file.vaultId ||
    typeof file.revision !== 'number' ||
    !Number.isInteger(file.revision) ||
    file.revision < 1 ||
    !Array.isArray(file.accessHeader) ||
    !file.accessHeader.every(isValidAccessEntry) ||
    !file.recovery ||
    typeof file.recovery.recipientId !== 'string' ||
    typeof file.recovery.ageRecipient !== 'string' ||
    typeof file.recovery.wrappedVaultKey !== 'string' ||
    typeof file.encryptedPayload !== 'string'
  ) {
    throw new Error('Team Vault file is not a recognizable vault (unexpected format)');
  }
}

export interface TeamVaultServiceOptions {
  cryptoService?: TeamVaultCryptoService;
  /** Overrides the vault file path — tests only; production always uses userData. */
  filePath?: string;
  /** Overrides where generated PIV identity files are written — tests only. */
  identityDir?: string;
}

/**
 * Owns the local Team Vault file (`<userData>/team-vault.json`, same directory convention as
 * `SyncConfigStore`) and the in-memory, never-persisted Vault Key once unlocked — exactly the
 * `SyncCryptoService`/§4.2 pattern: unlocked fresh every app session (or after an explicit
 * `lock()`), never cached to disk or the OS keyring.
 *
 * This is Fas 2 (docs/team-vault-plan.md): a single local vault, no S3 sync yet (Fas 3 adds
 * read/write against a remote target on top of this same file format and API).
 *
 * PIN-prompt wiring is deliberately NOT included here yet: whether `age-plugin-yubikey` can take
 * a PIN non-interactively is unverified against real hardware (see Fas 1/2 "Kvarstående risker"
 * in team-vault-plan.md). `unlock()` shells straight to `TeamVaultCryptoService.unwrapVaultKey`,
 * which currently relies on `age-plugin-yubikey` handling its own PIN/touch prompting — wiring in
 * the app's own PIN modal (e.g. reusing `IpcBridge.promptForPinDirect`) is future work once that
 * channel is confirmed to work.
 */
export class TeamVaultService {
  private readonly cryptoService: TeamVaultCryptoService;
  private readonly filePath: string;
  private readonly identityDir: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private unlockedVaultKey: Buffer | null = null;
  /** The recipientId that produced `unlockedVaultKey` (via `createVault` or `unlock`) — the
   * authoritative identity for `addedBy`/`removedBy`/`updatedBy` audit fields. Deliberately NOT a
   * caller-supplied parameter on `addMember`/`removeMember`/`setRole`: a renderer asserting an
   * arbitrary "I am X" string for an audit trail that's shared with the whole team (§2.3:
   * `updated_by` exists so a member can tell "who made the last change" without asking S3) would
   * make that field purely decorative instead of authoritative. */
  private unlockedAsRecipientId: string | null = null;
  /** Last observed remote `FileEntry` for the vault file, used for optimistic concurrency on
   * push (see `pushToRemote`) — `undefined` means never observed from this instance (no check
   * to do yet), `null` means observed as "doesn't exist yet". Same pattern as
   * `ProfileSyncService.lastKnownRemoteState`/`checkNotChangedRemotely`, which the real S3
   * provider has no `If-Match`-style primitive to replace (verified against the code; see
   * docs/team-vault-plan.md Fas 3). */
  private lastKnownRemoteEntry: FileEntry | null | undefined = undefined;

  constructor(options: TeamVaultServiceOptions = {}) {
    this.cryptoService = options.cryptoService ?? new TeamVaultCryptoService();

    let baseDir: string;
    try {
      baseDir = app.getPath('userData');
    } catch {
      baseDir = path.join(os.homedir(), '.sshs3');
    }
    this.filePath = options.filePath ?? path.join(baseDir, 'team-vault.json');
    this.identityDir = options.identityDir ?? path.join(baseDir, 'team-vault-identities');
  }

  getFilePath(): string {
    return this.filePath;
  }

  isUnlocked(): boolean {
    return this.unlockedVaultKey !== null;
  }

  /** Clears the Vault Key from memory — call on app lock/quit, same as `SyncCryptoService.lock()`. */
  lock(): void {
    this.unlockedVaultKey = null;
    this.unlockedAsRecipientId = null;
  }

  /** Derived entirely from the plaintext `accessHeader` (§2.3) — never requires unlocking. */
  async getStatus(): Promise<TeamVaultStatus> {
    const file = await this.readFile();
    if (!file) {
      return { exists: false, unlocked: this.isUnlocked(), filePath: this.filePath };
    }
    const members: TeamVaultMemberSummary[] = file.accessHeader.map((e) => ({
      recipientId: e.recipientId,
      role: e.role,
      addedAt: e.addedAt,
    }));
    return {
      exists: true,
      vaultId: file.vaultId,
      members,
      adminCount: members.filter((m) => m.role === 'admin').length,
      unlocked: this.isUnlocked(),
      filePath: this.filePath,
    };
  }

  /** Generates a fresh recipient from the caller's own PIV card — used both by the admin
   * enrolling themselves at vault creation and by any later member joining (§4.3). */
  async enrollOwnPivRecipient(): Promise<{ recipient: string; identityFilePath: string }> {
    return this.cryptoService.enrollOwnPivRecipient(this.identityDir);
  }

  /**
   * Initiates the vault (§4.1): generates the Vault Key, wraps it for the creating admin and for
   * a freshly generated recovery identity, writes the file. The recovery identity's plaintext is
   * returned exactly once — the caller must show it to the admin for printing and never persist
   * it anywhere in the app.
   */
  async createVault(
    selfRecipientId: string,
    selfAgeRecipient: string
  ): Promise<{ recoveryIdentity: string }> {
    return this.queueMutation(async () => {
      if (await this.readFile()) {
        throw new Error('A Team Vault already exists on this machine');
      }

      const vaultKey = this.cryptoService.generateVaultKey();
      const vaultId = `vlt_${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      const selfEntry: TeamVaultAccessEntry = {
        recipientId: selfRecipientId,
        role: 'admin',
        method: 'piv-rsa-oaep',
        ageRecipient: selfAgeRecipient,
        wrappedVaultKey: await this.cryptoService.wrapVaultKeyForRecipient(vaultKey, selfAgeRecipient),
        addedAt: now,
        addedBy: selfRecipientId,
      };

      const { identity: recoveryIdentity, recipient: recoveryRecipient } =
        await this.cryptoService.generateRecoveryIdentity();

      const file: TeamVaultFile = {
        formatVersion: FORMAT_VERSION,
        vaultId,
        revision: 1,
        updatedAt: now,
        updatedBy: selfRecipientId,
        accessHeader: [selfEntry],
        recovery: {
          recipientId: 'recovery-key-1',
          ageRecipient: recoveryRecipient,
          wrappedVaultKey: await this.cryptoService.wrapVaultKeyForRecipient(vaultKey, recoveryRecipient),
        },
        encryptedPayload: this.cryptoService.encryptPayload(vaultKey, vaultId, FORMAT_VERSION, '{}'),
      };

      await this.writeFile(file);
      this.unlockedVaultKey = vaultKey;
      this.unlockedAsRecipientId = selfRecipientId;

      return { recoveryIdentity };
    });
  }

  /** Pure public-key wrap, no card/PIN involved on either side (§4.3) — requires the Vault Key
   * already unlocked in this session (e.g. right after `createVault`, or via `unlock()`). The
   * audit `addedBy` is always the recipient that actually unlocked this session, never a
   * caller-supplied value (see `unlockedAsRecipientId`'s doc comment). */
  async addMember(recipientId: string, ageRecipient: string, role: TeamVaultRole): Promise<void> {
    return this.queueMutation(async () => {
      const file = await this.requireFile();
      const vaultKey = this.requireUnlocked();
      const addedBy = this.requireUnlockedRecipientId();
      if (file.accessHeader.some((e) => e.recipientId === recipientId)) {
        throw new Error(`"${recipientId}" is already a member of this vault`);
      }

      const now = new Date().toISOString();
      file.accessHeader.push({
        recipientId,
        role,
        method: 'piv-rsa-oaep',
        ageRecipient,
        wrappedVaultKey: await this.cryptoService.wrapVaultKeyForRecipient(vaultKey, ageRecipient),
        addedAt: now,
        addedBy,
      });
      file.revision += 1;
      file.updatedAt = now;
      file.updatedBy = addedBy;
      await this.writeFile(file);
    });
  }

  /**
   * Offboarding (§4.3): a fresh Vault Key, the payload re-encrypted under it, and every
   * *remaining* recipient (plus the recovery key) re-wrapped for it — the removed recipient's old
   * wrap still exists in any S3 version history (Fas 3), so they keep whatever they already
   * synced but lose all future updates. Returns the remaining admin count so the caller can warn,
   * not block, when it drops below 2 (§4.3's multi-admin rule is advisory).
   */
  async removeMember(recipientId: string): Promise<{ remainingAdmins: number }> {
    return this.queueMutation(async () => {
      const file = await this.requireFile();
      const vaultKey = this.requireUnlocked();
      const removedBy = this.requireUnlockedRecipientId();
      if (!file.accessHeader.some((e) => e.recipientId === recipientId)) {
        throw new Error(`"${recipientId}" is not a member of this vault`);
      }

      const plaintext = this.cryptoService.decryptPayload(
        vaultKey,
        file.vaultId,
        file.formatVersion,
        file.encryptedPayload
      );

      const remaining = file.accessHeader.filter((e) => e.recipientId !== recipientId);
      const newVaultKey = this.cryptoService.generateVaultKey();
      const now = new Date().toISOString();

      const rewrapped: TeamVaultAccessEntry[] = [];
      for (const entry of remaining) {
        rewrapped.push({
          ...entry,
          wrappedVaultKey: await this.cryptoService.wrapVaultKeyForRecipient(newVaultKey, entry.ageRecipient),
        });
      }

      const updated: TeamVaultFile = {
        ...file,
        revision: file.revision + 1,
        updatedAt: now,
        updatedBy: removedBy,
        accessHeader: rewrapped,
        recovery: {
          ...file.recovery,
          wrappedVaultKey: await this.cryptoService.wrapVaultKeyForRecipient(
            newVaultKey,
            file.recovery.ageRecipient
          ),
        },
        encryptedPayload: this.cryptoService.encryptPayload(newVaultKey, file.vaultId, file.formatVersion, plaintext),
      };

      await this.writeFile(updated);
      this.unlockedVaultKey = newVaultKey;

      return { remainingAdmins: rewrapped.filter((e) => e.role === 'admin').length };
    });
  }

  /** Role is UI-only — every member already shares the same Vault Key by design, so changing it
   * never needs re-keying (§4.3). Still requires an unlocked, identified caller: without this, any
   * caller (unlocked or not) could promote an arbitrary recipientId to admin. */
  async setRole(recipientId: string, role: TeamVaultRole): Promise<void> {
    return this.queueMutation(async () => {
      const file = await this.requireFile();
      const updatedBy = this.requireUnlockedRecipientId();
      const entry = file.accessHeader.find((e) => e.recipientId === recipientId);
      if (!entry) {
        throw new Error(`"${recipientId}" is not a member of this vault`);
      }
      entry.role = role;
      file.revision += 1;
      file.updatedAt = new Date().toISOString();
      file.updatedBy = updatedBy;
      await this.writeFile(file);
    });
  }

  /** Unwraps the Vault Key for `recipientId` (a member or the recovery identity) using
   * `identityFilePath`, and caches it for the rest of this session. See the class doc comment for
   * the unresolved PIN-prompt caveat. */
  async unlock(recipientId: string, identityFilePath: string): Promise<void> {
    const file = await this.requireFile();
    const source =
      file.accessHeader.find((e) => e.recipientId === recipientId) ??
      (file.recovery.recipientId === recipientId ? file.recovery : undefined);
    if (!source) {
      throw new Error(`"${recipientId}" is not a recipient of this vault`);
    }
    this.unlockedVaultKey = await this.cryptoService.unwrapVaultKey(source.wrappedVaultKey, identityFilePath);
    this.unlockedAsRecipientId = recipientId;
  }

  /** Must be called whenever the configured S3 target/remoteBasePath changes — otherwise a stat
   * recorded against a *previous* target would be compared against the newly configured one on
   * the next push, producing a spurious (or worse, falsely-absent) conflict. Same reasoning as
   * `ProfileSyncService.resetRemoteState()`. */
  resetRemoteState(): void {
    this.lastKnownRemoteEntry = undefined;
  }

  /** Whether a vault file already exists at the remote target — used by the UI to offer "Pull
   * existing vault" instead of "Create Vault" when no local file exists yet (§4.3: a new member
   * joins an existing team vault, they don't create their own). */
  async hasRemoteVault(provider: IStorageProvider, remoteBasePath = ''): Promise<boolean> {
    return (await this.statOrNull(provider, this.remoteVaultPath(remoteBasePath))) !== null;
  }

  /**
   * Pushes the local vault file to the configured S3 target (docs/team-vault-plan.md Fas 3).
   * Serialized through `queueMutation` along with every local mutation and `pullFromRemote`, so a
   * push can never interleave with a concurrent local write or pull touching the same in-memory
   * state (`lastKnownRemoteEntry`, `unlockedVaultKey`).
   *
   * Two independent checks, not one, run before any byte is written remotely:
   * 1. **Identity.** Whenever something already exists at the remote path, its `vaultId` is read
   *    and compared to the local file's — regardless of whether this instance has ever observed
   *    the remote before. Holding S3 write access to a path is not the same thing as being a
   *    vault recipient (bucket IAM vs. vault membership are different trust domains), so a stat
   *    cache that starts `undefined` after every app restart must never be treated as "nothing to
   *    check" — that would silently let a brand-new local vault clobber a completely unrelated
   *    team's vault the first time it's pushed. Mismatch throws `TeamVaultForeignVaultError`.
   * 2. **Freshness.** Once identity is confirmed, `ProfileSyncService.checkNotChangedRemotely`'s
   *    proven size+mtime comparison (the real `S3StorageProvider` has no `If-Match`
   *    conditional-write primitive to use instead — verified, and not portable across S3/MinIO
   *    versions anyway) still applies when this instance has previously observed the remote,
   *    rejecting with `TeamVaultSyncConflictError` if someone else pushed since.
   */
  async pushToRemote(provider: IStorageProvider, remoteBasePath = ''): Promise<void> {
    return this.queueMutation(async () => {
      const file = await this.requireFile();
      const remotePath = this.remoteVaultPath(remoteBasePath);

      const current = await this.statOrNull(provider, remotePath);
      if (current !== null) {
        const remoteFile = await this.readRemoteVaultFile(provider, remotePath);
        if (remoteFile.vaultId !== file.vaultId) {
          throw new TeamVaultForeignVaultError();
        }
      }

      if (this.lastKnownRemoteEntry !== undefined) {
        const known = this.lastKnownRemoteEntry;
        const unchanged =
          (known === null && current === null) ||
          (known !== null && current !== null && known.size === current.size && known.mtime === current.mtime);
        if (!unchanged) {
          throw new TeamVaultSyncConflictError();
        }
      }

      await this.writeProviderFile(provider, remotePath, Buffer.from(JSON.stringify(file), 'utf-8'));
      this.lastKnownRemoteEntry = await this.statOrNull(provider, remotePath);
    });
  }

  /**
   * Pulls the vault file from the configured S3 target and overwrites the local copy — used both
   * to catch up with changes pushed elsewhere and to join a vault that already exists remotely
   * (when no local file exists yet). Locks the vault afterwards if it was unlocked: the cached
   * Vault Key may no longer be valid against a freshly pulled file that another admin re-keyed
   * (see `removeMember`), and reusing it blindly would be wrong.
   *
   * Refuses a pulled file whose `revision` goes backwards relative to the local copy
   * (`TeamVaultRollbackError`) — see `TeamVaultFile.revision`'s doc comment for why a bucket
   * write-access holder restoring an older version is a real, not theoretical, concern.
   */
  async pullFromRemote(provider: IStorageProvider, remoteBasePath = ''): Promise<void> {
    return this.queueMutation(async () => {
      const remotePath = this.remoteVaultPath(remoteBasePath);
      const file = await this.readRemoteVaultFile(provider, remotePath);

      const localFile = await this.readFile();
      if (localFile && file.revision < localFile.revision) {
        throw new TeamVaultRollbackError();
      }

      await this.writeFile(file);
      this.lastKnownRemoteEntry = await this.statOrNull(provider, remotePath);
      this.lock();
    });
  }

  /** Reads and fully validates a vault file from the remote — shared by `pushToRemote`'s identity
   * check and `pullFromRemote`, since both need the same untrusted-content guarantees. */
  private async readRemoteVaultFile(provider: IStorageProvider, remotePath: string): Promise<TeamVaultFile> {
    const raw = await this.readProviderFile(provider, remotePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf-8'));
    } catch {
      throw new Error('Remote Team Vault file is not valid JSON');
    }
    assertValidVaultFile(parsed);
    return parsed;
  }

  private remoteVaultPath(remoteBasePath: string): string {
    return joinPaths('s3', remoteBasePath, REMOTE_VAULT_FILENAME);
  }

  // Same provider-capability fallback as ProfileSyncService.readProviderFile/writeProviderFile:
  // IStorageProvider.readFile/writeFile are optional on the interface (not every provider
  // implements the convenience form), so fall back to the stream API any provider must support.
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
      stream.on('error', reject);
      stream.end(buffer, () => resolve());
    });
  }

  private async statOrNull(provider: IStorageProvider, remotePath: string): Promise<FileEntry | null> {
    try {
      return await provider.stat(remotePath);
    } catch (err: any) {
      if (this.isNotFoundError(err)) return null;
      throw err;
    }
  }

  // Same heuristics as ProfileSyncService.isNotFoundError — distinguishes "the object doesn't
  // exist" from other failures (network errors, auth errors) which must propagate, not be
  // swallowed into a false "not found".
  private isNotFoundError(err: any): boolean {
    if (!err) return false;
    const code = err.code || err.$metadata?.httpStatusCode;
    if (code === 'ENOENT' || code === 2 || code === 404 || code === 'NotFound' || code === 'NoSuchKey') {
      return true;
    }
    const name = err.name || '';
    if (name === 'NoSuchKey' || name === 'NotFound') return true;
    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
    if (msg.includes('no such file') || msg.includes('file does not exist') || msg.includes('does not exist') || msg.includes('not found')) {
      if (msg.includes('host not found') || msg.includes('socket not found') || msg.includes('getaddrinfo') || msg.includes('connect')) {
        return false;
      }
      return true;
    }
    return false;
  }

  private requireUnlocked(): Buffer {
    if (!this.unlockedVaultKey) {
      throw new Error('Unlock the Team Vault before making changes to it');
    }
    return this.unlockedVaultKey;
  }

  private requireUnlockedRecipientId(): string {
    if (!this.unlockedAsRecipientId) {
      throw new Error('Unlock the Team Vault before making changes to it');
    }
    return this.unlockedAsRecipientId;
  }

  private async readFile(): Promise<TeamVaultFile | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as TeamVaultFile;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  private async requireFile(): Promise<TeamVaultFile> {
    const file = await this.readFile();
    if (!file) {
      throw new Error('No Team Vault exists on this machine yet');
    }
    return file;
  }

  private async writeFile(file: TeamVaultFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), { encoding: 'utf-8', mode: 0o600 });
    try {
      await fs.chmod(this.filePath, 0o600);
    } catch {
      // Ignore chmod failures on non-POSIX filesystems.
    }
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const resultPromise = this.writeQueue.then(mutation, mutation);
    this.writeQueue = resultPromise.then(
      () => {},
      () => {}
    );
    return resultPromise;
  }
}
