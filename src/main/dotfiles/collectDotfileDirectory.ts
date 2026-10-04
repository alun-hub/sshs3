import path from 'node:path';
import type { IStorageProvider } from '../storage/StorageProvider';

export const DOTFILE_DIR_MAX_FILES = 200;
export const DOTFILE_DIR_MAX_FILE_BYTES = 1024 * 1024;
const MAX_DEPTH = 8;

export interface CollectedDotfile {
  /** POSIX path relative to the walked root, e.g. "nvim/init.vim". */
  relPath: string;
  content: string;
  mode?: string;
}

async function readText(provider: IStorageProvider, filePath: string): Promise<string | null> {
  const stream = await provider.createReadStream(filePath);
  const chunks: Buffer[] = [];
  let size = 0;
  return new Promise((resolve, reject) => {
    stream.on('data', (c: Buffer) => {
      size += c.length;
      if (size > DOTFILE_DIR_MAX_FILE_BYTES) {
        (stream as { destroy?: () => void }).destroy?.();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    stream.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve(buf.includes(0) ? null : buf.toString('utf-8'));
    });
    stream.on('error', reject);
  });
}

/**
 * Walks a directory on any storage provider and returns its regular text
 * files. Symlinks, binary files and files over 1 MiB are skipped; the walk
 * stops at DOTFILE_DIR_MAX_FILES files or MAX_DEPTH levels.
 */
export async function collectDotfileDirectory(
  provider: IStorageProvider,
  rootPath: string
): Promise<CollectedDotfile[]> {
  const out: CollectedDotfile[] = [];
  const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: rootPath, rel: '', depth: 0 }];

  while (queue.length > 0 && out.length < DOTFILE_DIR_MAX_FILES) {
    const { dir, rel, depth } = queue.shift()!;
    const entries = await provider.list(dir);
    for (const e of entries) {
      if (out.length >= DOTFILE_DIR_MAX_FILES) break;
      if (e.isSymlink || e.name === '.' || e.name === '..') continue;
      const entryRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) {
        if (depth + 1 < MAX_DEPTH) {
          queue.push({ dir: e.path || path.posix.join(dir, e.name), rel: entryRel, depth: depth + 1 });
        }
        continue;
      }
      if (e.size > DOTFILE_DIR_MAX_FILE_BYTES) continue;
      const content = await readText(provider, e.path || path.posix.join(dir, e.name));
      if (content === null) continue;
      out.push({ relPath: entryRel, content, mode: e.permissions || undefined });
    }
  }
  return out;
}
