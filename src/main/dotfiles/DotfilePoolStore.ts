import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { DotfilePool } from '../../shared/types/dotfiles';

export class DotfilePoolStore {
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
      this.filePath = path.join(baseDir, 'dotfile-pools.json');
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async getPools(): Promise<DotfilePool[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data.pools) ? data.pools : [];
    } catch {
      return [];
    }
  }

  public async getPool(id: string): Promise<DotfilePool | undefined> {
    const pools = await this.getPools();
    return pools.find((p) => p.id === id);
  }

  public async savePool(pool: DotfilePool): Promise<void> {
    if (!pool || !pool.id || typeof pool.id !== 'string' || !pool.id.trim()) {
      throw new Error('Pool ID is required');
    }

    return this.queueMutation(async () => {
      const pools = await this.getPools();
      const index = pools.findIndex((p) => p.id === pool.id);
      if (index >= 0) {
        pools[index] = pool;
      } else {
        pools.push(pool);
      }
      await this.persist(pools);
    });
  }

  public async deletePool(id: string): Promise<void> {
    if (!id) return;
    return this.queueMutation(async () => {
      const pools = await this.getPools();
      const filtered = pools.filter((p) => p.id !== id);
      if (filtered.length !== pools.length) {
        await this.persist(filtered);
      }
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

  private async persist(pools: DotfilePool[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify({ pools }, null, 2), {
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
