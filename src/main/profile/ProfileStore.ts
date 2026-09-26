import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { S3Config } from '../../shared/types/storage';
import { encryptSecretValue, decryptSecretValue, transformEntrySecrets } from '../crypto/SecretFieldCrypto';

export interface ProfilesData {
  ssh: SSHConnectionConfig[];
  s3: S3Config[];
  folders?: string[];
}

const SSH_SECRET_FIELDS: Array<keyof SSHConnectionConfig> = ['password', 'passphrase'];
const S3_SECRET_FIELDS: Array<keyof S3Config> = ['secretAccessKey', 'sessionToken'];

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
        baseDir = path.join(os.homedir(), '.sshs3');
      }
      this.filePath = path.join(baseDir, 'profiles.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private getLegacyFilePath(): string | null {
    try {
      const configDir = path.dirname(this.filePath);
      const parent = path.dirname(configDir);
      const legacyConfig = path.join(parent, 'multissh', 'profiles.json');
      const legacyHome = path.join(os.homedir(), '.multissh', 'profiles.json');
      return legacyConfig !== this.filePath ? legacyConfig : legacyHome;
    } catch {
      return null;
    }
  }

  public async getProfiles(): Promise<ProfilesData> {
    const profiles = await this.getProfilesIncludingTombstones();
    const result: ProfilesData = {
      ssh: profiles.ssh.filter((p) => !p.deletedAt),
      s3: profiles.s3.filter((p) => !p.deletedAt),
    };
    if (profiles.folders && profiles.folders.length > 0) {
      result.folders = profiles.folders;
    }
    return result;
  }

  /**
   * Same as getProfiles(), but also returns soft-deleted (tombstoned) entries.
   * Used by remote profile sync, which needs to see and propagate deletions;
   * every other caller should use getProfiles() so tombstones stay invisible
   * to the rest of the app.
   */
  public async getProfilesIncludingTombstones(): Promise<ProfilesData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      const ssh: SSHConnectionConfig[] = Array.isArray(data.ssh) ? data.ssh : [];
      const s3: S3Config[] = Array.isArray(data.s3) ? data.s3 : [];
      const folders: string[] = Array.isArray(data.folders) ? data.folders : [];
      return {
        ssh: ssh.map((p) => transformEntrySecrets(p, SSH_SECRET_FIELDS, decryptSecretValue)),
        s3: s3.map((p) => transformEntrySecrets(p, S3_SECRET_FIELDS, decryptSecretValue)),
        folders,
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        const legacyPath = this.getLegacyFilePath();
        if (legacyPath) {
          try {
            const raw = await fs.readFile(legacyPath, 'utf-8');
            const data = JSON.parse(raw);
            const ssh: SSHConnectionConfig[] = Array.isArray(data.ssh) ? data.ssh : [];
            const s3: S3Config[] = Array.isArray(data.s3) ? data.s3 : [];
            const folders: string[] = Array.isArray(data.folders) ? data.folders : [];
            const profiles: ProfilesData = {
              ssh: ssh.map((p) => transformEntrySecrets(p, SSH_SECRET_FIELDS, decryptSecretValue)),
              s3: s3.map((p) => transformEntrySecrets(p, S3_SECRET_FIELDS, decryptSecretValue)),
              folders,
            };
            if (ssh.length > 0 || s3.length > 0 || folders.length > 0) {
              void this.queueMutation(async () => {
                await fs.mkdir(path.dirname(this.filePath), { recursive: true });
                await fs.copyFile(legacyPath, this.filePath);
              }).catch(() => {});
            }
            return profiles;
          } catch {
            // Ignore legacy read errors
          }
        }
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
      const profiles = await this.getProfilesIncludingTombstones();
      const stamped: SSHConnectionConfig = { ...config, updatedAt: new Date().toISOString(), deletedAt: undefined };
      const index = profiles.ssh.findIndex((p) => p.id === config.id);
      if (index >= 0) {
        profiles.ssh[index] = stamped;
      } else {
        profiles.ssh.push(stamped);
      }
      await this.persist(profiles);
    });
  }

  public async deleteSSH(id: string): Promise<void> {
    if (!id) return;
    return this.queueMutation(async () => {
      const profiles = await this.getProfilesIncludingTombstones();
      const entry = profiles.ssh.find((p) => p.id === id && !p.deletedAt);
      if (entry) {
        const now = new Date().toISOString();
        entry.deletedAt = now;
        entry.updatedAt = now;
        await this.persist(profiles);
      }
    });
  }

  public async saveS3(config: S3Config): Promise<void> {
    if (!config || !config.id || typeof config.id !== 'string' || !config.id.trim()) {
      throw new Error('Profile ID is required');
    }

    return this.queueMutation(async () => {
      const profiles = await this.getProfilesIncludingTombstones();
      const stamped: S3Config = { ...config, updatedAt: new Date().toISOString(), deletedAt: undefined };
      const index = profiles.s3.findIndex((p) => p.id === config.id);
      if (index >= 0) {
        profiles.s3[index] = stamped;
      } else {
        profiles.s3.push(stamped);
      }
      await this.persist(profiles);
    });
  }

  public async deleteS3(id: string): Promise<void> {
    if (!id) return;
    return this.queueMutation(async () => {
      const profiles = await this.getProfilesIncludingTombstones();
      const entry = profiles.s3.find((p) => p.id === id && !p.deletedAt);
      if (entry) {
        const now = new Date().toISOString();
        entry.deletedAt = now;
        entry.updatedAt = now;
        await this.persist(profiles);
      }
    });
  }

  public async saveFolder(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Folder name is required');
    }
    return this.queueMutation(async () => {
      const profiles = await this.getProfilesIncludingTombstones();
      profiles.folders = profiles.folders || [];
      if (!profiles.folders.includes(trimmed)) {
        profiles.folders.push(trimmed);
        await this.persist(profiles);
      }
    });
  }

  public async deleteFolder(name: string, deleteProfiles = false): Promise<void> {
    if (!name) return;
    return this.queueMutation(async () => {
      const profiles = await this.getProfilesIncludingTombstones();
      profiles.folders = (profiles.folders || []).filter((f) => f !== name);
      const now = new Date().toISOString();
      if (deleteProfiles) {
        profiles.ssh.forEach((p) => {
          if (p.group === name && !p.deletedAt) {
            p.deletedAt = now;
            p.updatedAt = now;
          }
        });
        profiles.s3.forEach((p) => {
          if (p.group === name && !p.deletedAt) {
            p.deletedAt = now;
            p.updatedAt = now;
          }
        });
      } else {
        profiles.ssh.forEach((p) => {
          if (p.group === name) {
            p.group = undefined;
            p.updatedAt = now;
          }
        });
        profiles.s3.forEach((p) => {
          if (p.group === name) {
            p.group = undefined;
            p.updatedAt = now;
          }
        });
      }
      await this.persist(profiles);
    });
  }

  public async renameFolder(oldName: string, newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) {
      throw new Error('New folder name is required');
    }
    if (oldName === trimmed) return;
    return this.queueMutation(async () => {
      const profiles = await this.getProfilesIncludingTombstones();
      profiles.folders = (profiles.folders || []).map((f) => (f === oldName ? trimmed : f));
      if (!profiles.folders.includes(trimmed)) {
        profiles.folders.push(trimmed);
      }
      const now = new Date().toISOString();
      profiles.ssh.forEach((p) => {
        if (p.group === oldName) {
          p.group = trimmed;
          p.updatedAt = now;
        }
      });
      profiles.s3.forEach((p) => {
        if (p.group === oldName) {
          p.group = trimmed;
          p.updatedAt = now;
        }
      });
      await this.persist(profiles);
    });
  }

  /**
   * Replaces the entire profile set as-is (including tombstones), without
   * stamping updatedAt. Used exclusively by remote profile sync to write
   * back an already-merged result without disturbing the timestamps that
   * merge decisions were based on.
   */
  public async replaceAll(data: ProfilesData): Promise<void> {
    return this.queueMutation(async () => {
      await this.persist(data);
    });
  }

  private async persist(data: ProfilesData): Promise<void> {
    const onDisk: ProfilesData = {
      ssh: data.ssh.map((p) => transformEntrySecrets(p, SSH_SECRET_FIELDS, encryptSecretValue)),
      s3: data.s3.map((p) => transformEntrySecrets(p, S3_SECRET_FIELDS, encryptSecretValue)),
    };
    if (data.folders && data.folders.length > 0) {
      onDisk.folders = data.folders;
    }
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
