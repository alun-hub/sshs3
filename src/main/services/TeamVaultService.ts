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
import { TeamVaultCryptoService } from './TeamVaultCryptoService';

const FORMAT_VERSION = 1 as const;

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

      return { recoveryIdentity };
    });
  }

  /** Pure public-key wrap, no card/PIN involved on either side (§4.3) — requires the Vault Key
   * already unlocked in this session (e.g. right after `createVault`, or via `unlock()`). */
  async addMember(
    recipientId: string,
    ageRecipient: string,
    role: TeamVaultRole,
    addedBy: string
  ): Promise<void> {
    return this.queueMutation(async () => {
      const file = await this.requireFile();
      const vaultKey = this.requireUnlocked();
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
  async removeMember(recipientId: string, removedBy: string): Promise<{ remainingAdmins: number }> {
    return this.queueMutation(async () => {
      const file = await this.requireFile();
      const vaultKey = this.requireUnlocked();
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
   * never needs re-keying (§4.3). */
  async setRole(recipientId: string, role: TeamVaultRole, updatedBy: string): Promise<void> {
    return this.queueMutation(async () => {
      const file = await this.requireFile();
      const entry = file.accessHeader.find((e) => e.recipientId === recipientId);
      if (!entry) {
        throw new Error(`"${recipientId}" is not a member of this vault`);
      }
      entry.role = role;
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
  }

  private requireUnlocked(): Buffer {
    if (!this.unlockedVaultKey) {
      throw new Error('Unlock the Team Vault before making changes to it');
    }
    return this.unlockedVaultKey;
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
