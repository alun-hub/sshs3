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

  public async getPools(options?: { includeDeleted?: boolean }): Promise<DotfilePool[]> {
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
    if (options?.includeDeleted) {
      return pools;
    }
    // Hide soft-deleted (tombstoned) pools/files from normal callers. Only
    // remote profile sync (via includeDeleted: true) needs to see these, so
    // it can propagate the deletion to other machines.
    return pools
      .filter((pool) => !pool.deletedAt)
      .map((pool) => ({ ...pool, files: pool.files.filter((file) => !file.deletedAt) }));
  }

  public async getPool(id: string, options?: { includeDeleted?: boolean }): Promise<DotfilePool | undefined> {
    const pools = await this.getPools(options);
    return pools.find((p) => p.id === id);
  }

  /**
   * @param options.preserveTimestamps When true, skip auto-stamping
   *   pool/file `updatedAt`. Used exclusively by remote profile sync when
   *   writing back an already-merged pool, so the timestamps that the merge
   *   decision was based on aren't overwritten with "now".
   */
  public async savePool(pool: DotfilePool, options?: { preserveTimestamps?: boolean }): Promise<void> {
    if (!pool || !pool.id || typeof pool.id !== 'string' || !pool.id.trim()) {
      throw new Error('Pool ID is required');
    }

    return this.queueMutation(async () => {
      const poolDir = this.getPoolDirectory(pool.id);
      if (pool.deletedAt) {
        try {
          await fs.rm(poolDir, { recursive: true, force: true });
        } catch {
          // Ignore folder deletion failure
        }
      } else {
        await fs.mkdir(poolDir, { recursive: true });
      }

      const existingPools = await this.readRawPools();
      const existingFilesById = new Map(
        (existingPools.find((p) => p.id === pool.id)?.files ?? []).map((f) => [f.id, f])
      );

      const now = formatTimestamp();
      pool.masterDirectory = poolDir;
      if (!options?.preserveTimestamps) {
        pool.updatedAt = now;
      }

      // Write master files to disk (for non-deleted files and pools)
      if (!pool.deletedAt) {
        for (const file of pool.files) {
          if (!file.id) {
            file.id = crypto.randomUUID();
          }
          const masterPath = this.getMasterFilePath(pool.id, file.remotePath);
          file.masterFilePath = masterPath;
          file.masterFileName = path.basename(masterPath);

          if (file.deletedAt) {
            try {
              await fs.rm(masterPath, { force: true });
            } catch {
              // Ignore file deletion failure
            }
          } else {
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
          }

          if (!options?.preserveTimestamps) {
            const existingFile = existingFilesById.get(file.id);
            const contentChanged =
              !existingFile ||
              existingFile.content !== file.content ||
              existingFile.mode !== file.mode ||
              existingFile.remotePath !== file.remotePath;
            file.updatedAt = contentChanged ? now : (file.updatedAt ?? existingFile?.updatedAt ?? now);
          }
        }
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
      const pool = pools.find((p) => p.id === id && !p.deletedAt);
      if (pool) {
        const now = formatTimestamp();
        // Soft-delete: keep a lightweight tombstone (no file contents, they're
        // gone from disk below) so remote profile sync can propagate the
        // deletion instead of the pool silently reappearing on the next pull.
        pool.deletedAt = now;
        pool.updatedAt = now;
        pool.files = [];
        await this.persist(pools);
      }
      try {
        await fs.rm(this.getPoolDirectory(id), { recursive: true, force: true });
      } catch {
        // Ignore folder deletion failure
      }
    });
  }

  /**
   * Same as getPools({ includeDeleted: true }), provided as a clearer entry
   * point for remote profile sync.
   */
  public async getPoolsIncludingTombstones(): Promise<DotfilePool[]> {
    return this.getPools({ includeDeleted: true });
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
