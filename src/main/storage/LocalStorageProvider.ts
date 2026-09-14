import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  BaseStorageProvider,
  formatDate,
  getMimeType,
} from './StorageProvider';
import type {
  FileEntry,
  StorageType,
  WriteStreamOptions,
} from '../../shared/types/storage';

export interface LocalStorageProviderOptions {
  id?: string;
  name?: string;
  basePath?: string;
}

export class LocalStorageProvider extends BaseStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType = 'local';
  readonly basePath?: string;

  constructor(options?: LocalStorageProviderOptions | string, name?: string) {
    super();
    if (typeof options === 'object' && options !== null) {
      this.id = options.id ?? 'local';
      this.name = options.name ?? 'Local Storage';
      this.basePath = options.basePath ? path.resolve(options.basePath) : undefined;
    } else {
      this.id = options ?? 'local';
      this.name = name ?? 'Local Storage';
      this.basePath = undefined;
    }
  }

  /**
   * Resolves a path against basePath if relative, or normalizes it if absolute.
   * Supports Linux (/) and Windows (C:\) paths.
   */
  public resolvePath(remotePath: string): string {
    if (!remotePath) {
      return this.basePath ?? process.cwd();
    }
    // Detect Windows drive root like C:\ or C:/ even on non-Windows environments
    if (/^[a-zA-Z]:[/\\]/.test(remotePath)) {
      return path.normalize(remotePath);
    }
    if (path.isAbsolute(remotePath)) {
      return path.normalize(remotePath);
    }
    if (this.basePath) {
      return path.resolve(this.basePath, remotePath);
    }
    return path.resolve(remotePath);
  }

  async list(remotePath: string): Promise<FileEntry[]> {
    const fullPath = this.resolvePath(remotePath);
    const stats = await fsp.stat(fullPath);

    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${remotePath}`);
    }

    const entries = await fsp.readdir(fullPath, { withFileTypes: true });
    const results: FileEntry[] = [];

    for (const entry of entries) {
      const entryFullPath = path.join(fullPath, entry.name);
      const entryRelativePath = path.join(remotePath, entry.name);

      try {
        const itemStats = await fsp.stat(entryFullPath);
        const isDir = itemStats.isDirectory();
        results.push({
          name: entry.name,
          path: entryRelativePath,
          size: itemStats.size,
          isDirectory: isDir,
          mtime: formatDate(itemStats.mtime),
          mimeType: isDir ? undefined : getMimeType(entry.name),
          permissions: (itemStats.mode & 0o777).toString(8).padStart(3, '0'),
        });
      } catch {
        // Fallback for unreadable items / broken symlinks
        const isDir = entry.isDirectory();
        results.push({
          name: entry.name,
          path: entryRelativePath,
          size: 0,
          isDirectory: isDir,
          mimeType: isDir ? undefined : getMimeType(entry.name),
        });
      }
    }

    // Sort directories first, then alphabetical by name
    results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  async stat(remotePath: string): Promise<FileEntry> {
    const fullPath = this.resolvePath(remotePath);
    const stats = await fsp.stat(fullPath);
    const isDir = stats.isDirectory();
    const name = path.basename(fullPath) || fullPath;

    return {
      name,
      path: remotePath,
      size: stats.size,
      isDirectory: isDir,
      mtime: formatDate(stats.mtime),
      mimeType: isDir ? undefined : getMimeType(name),
      permissions: (stats.mode & 0o777).toString(8).padStart(3, '0'),
    };
  }

  async createFolder(remotePath: string): Promise<void> {
    const fullPath = this.resolvePath(remotePath);
    await fsp.mkdir(fullPath, { recursive: true });
  }

  async delete(remotePath: string, isDirectory: boolean): Promise<void> {
    const fullPath = this.resolvePath(remotePath);
    const stats = await fsp.stat(fullPath);

    if (isDirectory) {
      if (!stats.isDirectory()) {
        throw new Error(`Expected directory but found file: ${remotePath}`);
      }
      await fsp.rm(fullPath, { recursive: true });
    } else {
      if (stats.isDirectory()) {
        throw new Error(`Expected file but found directory: ${remotePath}`);
      }
      await fsp.unlink(fullPath);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fullOld = this.resolvePath(oldPath);
    const fullNew = this.resolvePath(newPath);
    await fsp.rename(fullOld, fullNew);
  }

  async createReadStream(
    remotePath: string,
    start?: number,
    end?: number,
  ): Promise<NodeJS.ReadableStream> {
    const fullPath = this.resolvePath(remotePath);
    const stats = await fsp.stat(fullPath);

    if (stats.isDirectory()) {
      throw new Error(`Cannot read directory as stream: ${remotePath}`);
    }

    const options: { start?: number; end?: number } = {};
    if (typeof start === 'number') options.start = start;
    if (typeof end === 'number') options.end = end;

    return fs.createReadStream(fullPath, options);
  }

  async createWriteStream(
    remotePath: string,
    _options?: WriteStreamOptions,
  ): Promise<NodeJS.WritableStream> {
    const fullPath = this.resolvePath(remotePath);
    const parentDir = path.dirname(fullPath);
    await fsp.mkdir(parentDir, { recursive: true });
    return fs.createWriteStream(fullPath);
  }

  async disconnect(): Promise<void> {
    // No persistent connection to close for local filesystem
  }
}
