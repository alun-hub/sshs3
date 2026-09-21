import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { DirectorySyncProfile } from '../../shared/types/dirsync';

export class DirectorySyncProfileStore {
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
      this.filePath = path.join(baseDir, 'directory-sync-profiles.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async list(): Promise<DirectorySyncProfile[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data.profiles) ? data.profiles : [];
    } catch {
      return [];
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

  public async save(profile: DirectorySyncProfile): Promise<DirectorySyncProfile> {
    if (!profile || !profile.id || typeof profile.id !== 'string' || !profile.id.trim()) {
      throw new Error('Profile ID is required');
    }

    return this.queueMutation(async () => {
      const profiles = await this.list();
      const now = new Date().toISOString();
      const index = profiles.findIndex((p) => p.id === profile.id);
      const stamped: DirectorySyncProfile = {
        ...profile,
        createdAt: index >= 0 ? profiles[index].createdAt : (profile.createdAt ?? now),
        updatedAt: now,
      };
      if (index >= 0) {
        profiles[index] = stamped;
      } else {
        profiles.push(stamped);
      }
      await this.persist(profiles);
      return stamped;
    });
  }

  public async delete(id: string): Promise<void> {
    if (!id) return;
    return this.queueMutation(async () => {
      const profiles = await this.list();
      const filtered = profiles.filter((p) => p.id !== id);
      if (filtered.length !== profiles.length) {
        await this.persist(filtered);
      }
    });
  }

  private async persist(profiles: DirectorySyncProfile[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ profiles }, null, 2), {
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
