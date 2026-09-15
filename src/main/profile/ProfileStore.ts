import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { S3Config } from '../../shared/types/storage';

export interface ProfilesData {
  ssh: SSHConnectionConfig[];
  s3: S3Config[];
}

export class ProfileStore {
  private filePath: string;

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
      return {
        ssh: Array.isArray(data.ssh) ? data.ssh : [],
        s3: Array.isArray(data.s3) ? data.s3 : [],
      };
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { ssh: [], s3: [] };
      }
      // If file is corrupted or cannot be parsed, default to empty
      return { ssh: [], s3: [] };
    }
  }

  public async saveSSH(config: SSHConnectionConfig): Promise<void> {
    if (!config || !config.id || typeof config.id !== 'string' || !config.id.trim()) {
      throw new Error('Profile ID is required');
    }

    const profiles = await this.getProfiles();
    const index = profiles.ssh.findIndex((p) => p.id === config.id);
    if (index >= 0) {
      profiles.ssh[index] = config;
    } else {
      profiles.ssh.push(config);
    }

    await this.persist(profiles);
  }

  public async deleteSSH(id: string): Promise<void> {
    if (!id) return;
    const profiles = await this.getProfiles();
    const initialLen = profiles.ssh.length;
    profiles.ssh = profiles.ssh.filter((p) => p.id !== id);
    if (profiles.ssh.length !== initialLen) {
      await this.persist(profiles);
    }
  }

  public async saveS3(config: S3Config): Promise<void> {
    if (!config || !config.id || typeof config.id !== 'string' || !config.id.trim()) {
      throw new Error('Profile ID is required');
    }

    const profiles = await this.getProfiles();
    const index = profiles.s3.findIndex((p) => p.id === config.id);
    if (index >= 0) {
      profiles.s3[index] = config;
    } else {
      profiles.s3.push(config);
    }

    await this.persist(profiles);
  }

  public async deleteS3(id: string): Promise<void> {
    if (!id) return;
    const profiles = await this.getProfiles();
    const initialLen = profiles.s3.length;
    profiles.s3 = profiles.s3.filter((p) => p.id !== id);
    if (profiles.s3.length !== initialLen) {
      await this.persist(profiles);
    }
  }

  private async persist(data: ProfilesData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }
}
