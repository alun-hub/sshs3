import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app, safeStorage } from 'electron';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { S3Config } from '../../shared/types/storage';

export interface ProfilesData {
  ssh: SSHConnectionConfig[];
  s3: S3Config[];
}

const ENC_PREFIX = 'enc:v1:';

const SSH_SECRET_FIELDS: Array<keyof SSHConnectionConfig> = ['password', 'passphrase'];
const S3_SECRET_FIELDS: Array<keyof S3Config> = ['secretAccessKey', 'sessionToken'];

/**
 * Checks whether OS-backed encryption (libsecret/Keychain/DPAPI via Electron's
 * safeStorage) is available in the current process. Returns false outside a
 * running Electron app (e.g. under test) or when no OS keyring backend exists,
 * in which case secrets are persisted in plaintext as a graceful fallback.
 */
function isEncryptionAvailable(): boolean {
  try {
    return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptValue(value: string): string {
  if (!value) return value;
  try {
    if (isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
    }
  } catch {
    // Fall through and store as plaintext rather than losing the value.
  }
  return value;
}

function decryptValue(value: string): string {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) {
    return value;
  }
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
    if (isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
  } catch {
    // Undecryptable (e.g. moved to a machine/user without the original OS
    // keyring entry) — fall through and return the raw stored value.
  }
  return value;
}

function transformSecretFields<T extends object>(
  entry: T,
  fields: Array<keyof T>,
  transform: (value: string) => string
): T {
  const result: T = { ...entry };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && value) {
      result[field] = transform(value) as T[keyof T];
    }
  }
  return result;
}

function transformEntrySecrets<T extends { proxy?: any }>(
  entry: T,
  fields: Array<keyof T>,
  transform: (value: string) => string
): T {
  const result = transformSecretFields(entry, fields, transform);
  if (result.proxy && typeof result.proxy.password === 'string' && result.proxy.password) {
    result.proxy = {
      ...result.proxy,
      password: transform(result.proxy.password),
    };
  }
  return result;
}

export class ProfileStore {
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
        baseDir = path.join(os.homedir(), '.multissh');
      }
      this.filePath = path.join(baseDir, 'profiles.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async getProfiles(): Promise<ProfilesData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      const ssh: SSHConnectionConfig[] = Array.isArray(data.ssh) ? data.ssh : [];
      const s3: S3Config[] = Array.isArray(data.s3) ? data.s3 : [];
      return {
        ssh: ssh.map((p) => transformEntrySecrets(p, SSH_SECRET_FIELDS, decryptValue)),
        s3: s3.map((p) => transformEntrySecrets(p, S3_SECRET_FIELDS, decryptValue)),
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { ssh: [], s3: [] };
      }
      // If file is corrupted or cannot be parsed, default to empty
      return { ssh: [], s3: [] };
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

  public async saveSSH(config: SSHConnectionConfig): Promise<void> {
    if (!config || !config.id || typeof config.id !== 'string' || !config.id.trim()) {
      throw new Error('Profile ID is required');
    }

    return this.queueMutation(async () => {
      const profiles = await this.getProfiles();
      const index = profiles.ssh.findIndex((p) => p.id === config.id);
      if (index >= 0) {
        profiles.ssh[index] = config;
      } else {
        profiles.ssh.push(config);
      }
      await this.persist(profiles);
    });
  }

  public async deleteSSH(id: string): Promise<void> {
    if (!id) return;
    return this.queueMutation(async () => {
      const profiles = await this.getProfiles();
      const initialLen = profiles.ssh.length;
      profiles.ssh = profiles.ssh.filter((p) => p.id !== id);
      if (profiles.ssh.length !== initialLen) {
        await this.persist(profiles);
      }
    });
  }

  public async saveS3(config: S3Config): Promise<void> {
    if (!config || !config.id || typeof config.id !== 'string' || !config.id.trim()) {
      throw new Error('Profile ID is required');
    }

    return this.queueMutation(async () => {
      const profiles = await this.getProfiles();
      const index = profiles.s3.findIndex((p) => p.id === config.id);
      if (index >= 0) {
        profiles.s3[index] = config;
      } else {
        profiles.s3.push(config);
      }
      await this.persist(profiles);
    });
  }

  public async deleteS3(id: string): Promise<void> {
    if (!id) return;
    return this.queueMutation(async () => {
      const profiles = await this.getProfiles();
      const initialLen = profiles.s3.length;
      profiles.s3 = profiles.s3.filter((p) => p.id !== id);
      if (profiles.s3.length !== initialLen) {
        await this.persist(profiles);
      }
    });
  }

  private async persist(data: ProfilesData): Promise<void> {
    const onDisk: ProfilesData = {
      ssh: data.ssh.map((p) => transformEntrySecrets(p, SSH_SECRET_FIELDS, encryptValue)),
      s3: data.s3.map((p) => transformEntrySecrets(p, S3_SECRET_FIELDS, encryptValue)),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(onDisk, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    try {
      await fs.chmod(this.filePath, 0o600);
    } catch {
      // Ignore chmod failures (e.g. on certain filesystems or platforms)
    }
  }
}
