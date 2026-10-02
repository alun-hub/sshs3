import type { FileEntry } from '@shared/types/storage';
import { makeNameMatcher } from './nameFilter';

export const RECURSIVE_MAX_RESULTS = 1000;
export const RECURSIVE_MAX_DIRS = 3000;
const CONCURRENCY = 4;

export interface RecursiveFilterOptions {
  providerId: string;
  rootPath: string;
  query: string;
  showHidden: boolean;
  signal: AbortSignal;
  list: (providerId: string, path: string) => Promise<FileEntry[]>;
  /** Called with the full result list so far after each directory has been scanned. */
  onResults: (entries: FileEntry[]) => void;
}

export interface RecursiveFilterSummary {
  truncated: boolean;
  dirsScanned: number;
  skippedDirs: number;
}

/**
 * Walks `rootPath` breadth-first via storageList and collects every entry (file or
 * folder) whose own name contains `query` (case-insensitive). Results get `name` set to
 * the path relative to the root so the list shows where each hit lives; `path` stays
 * the real full path so open/navigate/transfer keep working. Symlinked folders are
 * listed but never descended into (cycle / escape protection, same as TransferPipeline).
 */
export async function recursiveFilterFiles(options: RecursiveFilterOptions): Promise<RecursiveFilterSummary> {
  const { providerId, rootPath, showHidden, signal, list, onResults } = options;
  const matches = makeNameMatcher(options.query);
  const results: FileEntry[] = [];
  const queue: Array<{ path: string; rel: string }> = [{ path: rootPath, rel: '' }];
  let dirsScanned = 0;
  let skippedDirs = 0;
  let truncated = false;
  let active = 0;

  const worker = async (): Promise<void> => {
    while (!signal.aborted && !truncated) {
      const dir = queue.shift();
      if (!dir) {
        // Another worker may still enqueue children; yield briefly while any are active.
        if (active === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
        continue;
      }
      if (dirsScanned >= RECURSIVE_MAX_DIRS) {
        truncated = true;
        return;
      }
      dirsScanned += 1;
      active += 1;
      try {
        const children = await list(providerId, dir.path);
        if (signal.aborted || truncated) return;
        let added = false;
        for (const child of children) {
          const name = child.name;
          if (!name || name === '.' || name === '..') continue;
          if (!showHidden && name.startsWith('.')) continue;
          const rel = dir.rel ? `${dir.rel}/${name}` : name;
          if (matches(name)) {
            results.push({ ...child, name: rel });
            added = true;
            if (results.length >= RECURSIVE_MAX_RESULTS) {
              truncated = true;
              break;
            }
          }
          if (child.isDirectory && !child.isSymlink) queue.push({ path: child.path, rel });
        }
        if (added) onResults([...results]);
      } catch {
        skippedDirs += 1;
      } finally {
        active -= 1;
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  if (!signal.aborted) onResults([...results]);
  return { truncated, dirsScanned, skippedDirs };
}
