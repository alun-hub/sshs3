import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { StorageConnectConfig } from '../../shared/types/ipc';
import type { S3Config } from '../../shared/types/storage';
import { encryptSecretValue, decryptSecretValue, transformEntrySecrets } from '../crypto/SecretFieldCrypto';
import { createLogger } from '../log/Logger';

const teamVaultConfigLog = createLogger('team-vault-config');

const S3_SECRET_FIELDS: Array<keyof S3Config> = ['secretAccessKey', 'sessionToken'];

export interface TeamVaultConfigData {
  /** Where the vault file is read from / written to — S3/MinIO only (docs/team-vault-plan.md
   * Fas 3 is scoped to S3; SFTP is intentionally out of scope). */
  target?: StorageConnectConfig;
  /** `bucket[/prefix]` the vault file is written under — same convention as `SyncConfigStore`'s
   * `remoteBasePath`, see its doc comment. */
  remoteBasePath?: string;
  lastSyncAt?: string;
  /** This machine's own recipient id and PIV identity file, remembered purely so the UI can
   * prefill the unlock form instead of making the admin retype/relocate them every session —
   * neither value is a secret (the identity file holds a public `AGE-PLUGIN-YUBIKEY-...` stanza,
   * not a key; see `TeamVaultCryptoService.enrollOwnPivRecipient`'s doc comment). */
  selfRecipientId?: string;
  selfIdentityFilePath?: string;
}

function encryptTarget(target: StorageConnectConfig): StorageConnectConfig {
  const result: StorageConnectConfig = { ...target };
  if (result.s3Config) {
    result.s3Config = transformEntrySecrets(result.s3Config, S3_SECRET_FIELDS, encryptSecretValue);
  }
  return result;
}

function decryptTarget(target: StorageConnectConfig): StorageConnectConfig {
  const result: StorageConnectConfig = { ...target };
  if (result.s3Config) {
    result.s3Config = transformEntrySecrets(result.s3Config, S3_SECRET_FIELDS, decryptSecretValue);
  }
  return result;
}

/**
 * Persists the Team Vault's own S3/MinIO sync target — a deliberately separate file from
 * `SyncConfigStore` (docs/team-vault-plan.md: the Team Vault is a separate trust model from
 * Remote Profile Sync, never sharing infrastructure with it). Credentials are at-rest encrypted
 * the same way `SyncConfigStore` encrypts its own target, via `SecretFieldCrypto`.
 */
export class TeamVaultConfigStore {
  private filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
    } else {
      let baseDir: string;
      try {
        baseDir = app.getPath('userData');
      } catch {
        baseDir = path.join(os.homedir(), '.sshs3');
      }
      this.filePath = path.join(baseDir, 'team-vault-sync-config.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async getConfig(): Promise<TeamVaultConfigData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as TeamVaultConfigData;
      return {
        ...data,
        target: data.target ? decryptTarget(data.target) : undefined,
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return {};
      // Anything else (corrupted JSON, an OS-keychain/decrypt failure after e.g. a machine
      // migration, a truncated secret field) was previously indistinguishable from "never
      // configured" — same empty result, zero diagnostic signal. Logged (not thrown): every
      // caller already treats a missing config as "no target configured yet" and handles that
      // gracefully, so surfacing a hard error here would be a bigger behavior change than this
      // fix intends; the log line is what actually closes the observability gap.
      teamVaultConfigLog.warn('Failed to read Team Vault config (treating as not configured):', err);
      return {};
    }
  }

  public async setTarget(target: StorageConnectConfig, remoteBasePath = ''): Promise<void> {
    return this.queueMutation(async () => {
      const current = await this.getConfig();
      await this.persist({ ...current, target, remoteBasePath });
    });
  }

  public async setLastSyncAt(timestamp: string): Promise<void> {
    return this.queueMutation(async () => {
      const current = await this.getConfig();
      await this.persist({ ...current, lastSyncAt: timestamp });
    });
  }

  /** Either argument may be omitted to update just the other field (e.g. a fresh
   * `enrollOwnPivRecipient()` call only knows the identity file path — the recipient id, a
   * user-chosen label, isn't known until `createVault`/`unlock` confirms it). */
  public async setSelfIdentity(recipientId: string | undefined, identityFilePath: string | undefined): Promise<void> {
    return this.queueMutation(async () => {
      const current = await this.getConfig();
      await this.persist({
        ...current,
        selfRecipientId: recipientId ?? current.selfRecipientId,
        selfIdentityFilePath: identityFilePath ?? current.selfIdentityFilePath,
      });
    });
  }

  /** Explicitly nulls out both remembered self-identity fields (e.g. on `deleteVault()`) — unlike
   * `setSelfIdentity(undefined, undefined)`, which is a no-op by design (lets a caller that only
   * knows one field update just that one without clobbering the other). */
  public async clearSelfIdentity(): Promise<void> {
    return this.queueMutation(async () => {
      const current = await this.getConfig();
      await this.persist({ ...current, selfRecipientId: undefined, selfIdentityFilePath: undefined });
    });
  }

  /** Clears the target entirely — only local configuration, never the remote vault file itself. */
  public async clear(): Promise<void> {
    return this.queueMutation(async () => {
      await this.persist({});
    });
  }

  private queueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const resultPromise = this.writeQueue.then(mutation, mutation);
    this.writeQueue = resultPromise.then(
      () => {},
      () => {}
    );
    return resultPromise;
  }

  private async persist(data: TeamVaultConfigData): Promise<void> {
    const onDisk: TeamVaultConfigData = {
      ...data,
      target: data.target ? encryptTarget(data.target) : undefined,
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(onDisk, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    try {
      await fs.chmod(this.filePath, 0o600);
    } catch {
      // Ignore chmod failures on non-POSIX filesystems.
    }
  }
}
