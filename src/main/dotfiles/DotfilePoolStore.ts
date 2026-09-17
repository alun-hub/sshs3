import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { app } from 'electron';
import type { DotfileImportedFile, DotfilePool } from '../../shared/types/dotfiles';

function formatTimestamp(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export class DotfilePoolStore {
  private filePath: string;
  private baseDir: string;
  private masterDir: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
      this.baseDir = path.dirname(customPath);
    } else {
      let baseDir: string;
      try {
        baseDir = app.getPath('userData');
      } catch {
        baseDir = path.join(os.homedir(), '.sshs3');
      }
      this.baseDir = baseDir;
      this.filePath = path.join(baseDir, 'dotfile-pools.json');
    }
    this.masterDir = path.join(this.baseDir, 'dotfiles');
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getMasterDir(): string {
    return this.masterDir;
  }

  public getPoolDirectory(poolId: string): string {
    return path.join(this.masterDir, poolId);
  }

  public getMasterFilePath(poolId: string, remotePath: string): string {
    const rel = remotePath.replace(/^~[/\\]?/, '').replace(/^[/\\]+/, '');
    const poolDir = this.getPoolDirectory(poolId);
    const resolved = path.resolve(poolDir, rel || 'unnamed-file');
    if (!resolved.startsWith(poolDir)) {
      return path.join(poolDir, path.basename(remotePath) || 'unnamed-file');
    }
    return resolved;
  }

  private async readRawPools(): Promise<DotfilePool[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw);
      return Array.isArray(data.pools) ? data.pools : [];
    } catch {
      return [];
    }
  }

  public async getPools(): Promise<DotfilePool[]> {
    const pools = await this.readRawPools();
    for (const pool of pools) {
      pool.masterDirectory = this.getPoolDirectory(pool.id);
      for (const file of pool.files) {
        const masterPath = this.getMasterFilePath(pool.id, file.remotePath);
        file.masterFilePath = masterPath;
        file.masterFileName = path.basename(masterPath);
        try {
          const diskContent = await fs.readFile(masterPath, 'utf-8');
          file.content = diskContent;
        } catch {
          // If file does not exist on disk yet, keep pool file content
        }
      }
    }
    return pools;
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
      const poolDir = this.getPoolDirectory(pool.id);
      await fs.mkdir(poolDir, { recursive: true });

      const now = formatTimestamp();
      pool.masterDirectory = poolDir;
      pool.updatedAt = now;

      // Write master files to disk
      for (const file of pool.files) {
        if (!file.id) {
          file.id = crypto.randomUUID();
        }
        const masterPath = this.getMasterFilePath(pool.id, file.remotePath);
        await fs.mkdir(path.dirname(masterPath), { recursive: true });
        await fs.writeFile(masterPath, file.content, 'utf-8');

        if (file.mode) {
          try {
            const modeNum = parseInt(file.mode, 8);
            if (!isNaN(modeNum)) {
              await fs.chmod(masterPath, modeNum);
            }
          } catch {
            // Ignore chmod failures on non-POSIX filesystems
          }
        }

        file.masterFilePath = masterPath;
        file.masterFileName = path.basename(masterPath);
        file.updatedAt = file.updatedAt || now;
      }

      const pools = await this.readRawPools();
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
      const pools = await this.readRawPools();
      const filtered = pools.filter((p) => p.id !== id);
      if (filtered.length !== pools.length) {
        await this.persist(filtered);
      }
      try {
        await fs.rm(this.getPoolDirectory(id), { recursive: true, force: true });
      } catch {
        // Ignore folder deletion failure
      }
    });
  }

  public async openPoolFolder(poolId: string): Promise<string> {
    const poolDir = this.getPoolDirectory(poolId);
    await fs.mkdir(poolDir, { recursive: true });
    try {
      const { shell } = await import('electron');
      if (shell?.openPath) {
        return await shell.openPath(poolDir);
      }
    } catch {
      // Ignore in non-electron environments
    }
    return '';
  }

  public async importLocalFiles(filePaths: string[]): Promise<DotfileImportedFile[]> {
    const results: DotfileImportedFile[] = [];
    for (const p of filePaths) {
      try {
        const content = await fs.readFile(p, 'utf-8');
        const stat = await fs.stat(p);
        const mode = (stat.mode & 0o777).toString(8);
        results.push({
          name: path.basename(p),
          path: p,
          content,
          mode,
        });
      } catch {
        // Skip files that cannot be read
      }
    }
    return results;
  }

  public async addFileToPool(
    poolId: string,
    fileData: { remotePath: string; content: string; mode?: string }
  ): Promise<DotfilePool> {
    const pools = await this.getPools();
    let pool = pools.find((p) => p.id === poolId);
    if (!pool) {
      pool = {
        id: poolId,
        name: 'Default Pool',
        files: [],
      };
    }

    const existingFile = pool.files.find((f) => f.remotePath === fileData.remotePath);
    if (existingFile) {
      existingFile.content = fileData.content;
      if (fileData.mode) existingFile.mode = fileData.mode;
      existingFile.updatedAt = formatTimestamp();
    } else {
      pool.files.push({
        id: crypto.randomUUID(),
        remotePath: fileData.remotePath,
        content: fileData.content,
        mode: fileData.mode,
        updatedAt: formatTimestamp(),
      });
    }

    await this.savePool(pool);
    return (await this.getPool(poolId))!;
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
