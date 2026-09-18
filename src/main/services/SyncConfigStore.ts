import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { StorageConnectConfig } from '../../shared/types/ipc';
import type { SFTPConfig, S3Config } from '../../shared/types/storage';
import { encryptSecretValue, decryptSecretValue, transformEntrySecrets } from '../crypto/SecretFieldCrypto';

const SFTP_SECRET_FIELDS: Array<keyof SFTPConfig> = ['password', 'passphrase', 'pin'];
const S3_SECRET_FIELDS: Array<keyof S3Config> = ['secretAccessKey', 'sessionToken'];

export interface SyncConfigData {
  /** Where sync files are read from / written to. Never the data being synced itself. */
  target?: StorageConnectConfig;
  /**
   * Directory (SFTP) or `bucket[/prefix]` (S3 — a "remotePath" is always
   * `bucket/key...`, S3Config itself carries no bucket) under which the
   * `.sshs3` sync folder is created. Empty means the connection's own
   * default/home directory.
   */
  remoteBasePath?: string;
  /** Base64-encoded. Not secret — only the two master passwords are — but never sent anywhere except embedded in the encrypted sync files themselves. */
  topologySaltBase64?: string;
  credentialsSaltBase64?: string;
  lastSyncAt?: string;
}

function encryptTarget(target: StorageConnectConfig): StorageConnectConfig {
  const result: StorageConnectConfig = { ...target };
  if (result.sftpConfig) {
    result.sftpConfig = transformEntrySecrets(result.sftpConfig, SFTP_SECRET_FIELDS, encryptSecretValue);
  }
  if (result.s3Config) {
    result.s3Config = transformEntrySecrets(result.s3Config, S3_SECRET_FIELDS, encryptSecretValue);
  }
  return result;
}

function decryptTarget(target: StorageConnectConfig): StorageConnectConfig {
  const result: StorageConnectConfig = { ...target };
  if (result.sftpConfig) {
    result.sftpConfig = transformEntrySecrets(result.sftpConfig, SFTP_SECRET_FIELDS, decryptSecretValue);
  }
  if (result.s3Config) {
    result.s3Config = transformEntrySecrets(result.s3Config, S3_SECRET_FIELDS, decryptSecretValue);
  }
  return result;
}

/**
 * Persists remote profile sync's own configuration: which S3/SFTP location
 * to sync to/from (with its own credentials, at-rest encrypted the same way
 * ProfileStore encrypts saved connection profiles), and the per-key-group
 * salts established at first enable. The two master passwords themselves
 * are never written here — only SyncCryptoService's in-memory cache holds
 * the derived keys, for as long as the app considers sync "unlocked".
 */
export class SyncConfigStore {
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
      this.filePath = path.join(baseDir, 'sync-config.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async getConfig(): Promise<SyncConfigData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as SyncConfigData;
      return {
        ...data,
        target: data.target ? decryptTarget(data.target) : undefined,
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return {};
      return {};
    }
  }

  public async setTarget(target: StorageConnectConfig, remoteBasePath = ''): Promise<void> {
    return this.queueMutation(async () => {
      const current = await this.getConfig();
      await this.persist({ ...current, target, remoteBasePath });
    });
  }

  /**
   * Updates whichever salt(s) are provided, leaving the other untouched.
   * Independent so that e.g. a bootstrap pull that only received one of the
   * two master passwords doesn't clobber the salt for the other, not-yet-
   * learned, key group.
   */
  public async setSalts(salts: { topologySalt?: Buffer; credentialsSalt?: Buffer }): Promise<void> {
    return this.queueMutation(async () => {
      const current = await this.getConfig();
      await this.persist({
        ...current,
        topologySaltBase64: salts.topologySalt ? salts.topologySalt.toString('base64') : current.topologySaltBase64,
        credentialsSaltBase64: salts.credentialsSalt
          ? salts.credentialsSalt.toString('base64')
          : current.credentialsSaltBase64,
      });
    });
  }

  public async setLastSyncAt(timestamp: string): Promise<void> {
    return this.queueMutation(async () => {
      const current = await this.getConfig();
      await this.persist({ ...current, lastSyncAt: timestamp });
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

  private async persist(data: SyncConfigData): Promise<void> {
    const onDisk: SyncConfigData = {
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
      // Ignore chmod failures on non-POSIX filesystems
    }
  }
}
