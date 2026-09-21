import { transferFile, joinPaths, getBaseName } from '../transfer/TransferPipeline';
import type { IStorageProvider, FileEntry, TransferProgress } from '../../shared/types/storage';
import type { DirectoryDiffEntry, DirectoryDiffResult, DirectorySyncApplyResult } from '../../shared/types/dirsync';

/** Tolerance for mtime comparisons (filesystem/SFTP clock drift, sub-second truncation). */
const MTIME_TOLERANCE_MS = 2000;

export type ScanSide = 'source' | 'target';
export type ScanProgressCallback = (side: ScanSide, filesCount: number, currentItem: string) => void;

/**
 * Recursively walks a directory tree via provider.list(), building a flat
 * Map<relativePath, FileEntry> keyed by POSIX-style relative path (relative
 * to rootPath). Mirrors the traversal/path-handling style of the internal
 * scanDirectory() in TransferPipeline.ts.
 */
export async function buildTree(
  provider: IStorageProvider,
  rootPath: string,
  onScanProgress?: (filesCount: number, currentItem: string) => void,
  state: { count: number } = { count: 0 },
  skipped: string[] = []
): Promise<Map<string, FileEntry>> {
  const result = new Map<string, FileEntry>();

  async function walk(currentPath: string, relPrefix: string, isRoot: boolean): Promise<void> {
    let entries: FileEntry[];
    try {
      entries = await provider.list(currentPath);
    } catch {
      // The root not existing yet is normal (e.g. a brand-new nested sync
      // target) and shouldn't be reported as a problem — it's simply empty.
      // A subdirectory that *was* listed a moment ago failing to read
      // (permission denied, transient disappearance, etc.) is a real
      // anomaly, so only those get surfaced to the user as skipped.
      if (!isRoot) {
        skipped.push(relPrefix || currentPath);
      }
      return;
    }

    for (const entry of entries) {
      const baseName = getBaseName(entry.name.replace(/\\/g, '/')) || entry.name;
      if (!baseName || baseName === '.' || baseName === '..') {
        continue;
      }
      const relativePath = relPrefix ? `${relPrefix}/${baseName}` : baseName;
      const childPath = entry.path || joinPaths(provider.type, currentPath, baseName);

      result.set(relativePath, entry);
      state.count++;
      onScanProgress?.(state.count, relativePath);

      if (entry.isDirectory) {
        await walk(childPath, relativePath, false);
      }
    }
  }

  await walk(rootPath, '', true);
  return result;
}

/**
 * Compares a source and target directory tree (both walked in parallel) and
 * classifies each relative path as 'new' (source only), 'changed' (both
 * present but size/mtime differ beyond tolerance), 'only-target' (target
 * only), or 'same' (excluded from `entries`, counted only).
 */
export async function computeDiff(
  sourceProvider: IStorageProvider,
  sourcePath: string,
  targetProvider: IStorageProvider,
  targetPath: string,
  onScanProgress?: ScanProgressCallback
): Promise<DirectoryDiffResult> {
  const skippedSource: string[] = [];
  const skippedTarget: string[] = [];
  const [sourceMap, targetMap] = await Promise.all([
    buildTree(sourceProvider, sourcePath, (count, item) => onScanProgress?.('source', count, item), { count: 0 }, skippedSource),
    buildTree(targetProvider, targetPath, (count, item) => onScanProgress?.('target', count, item), { count: 0 }, skippedTarget),
  ]);

  const entries: DirectoryDiffEntry[] = [];
  const counts = { new: 0, changed: 0, onlyTarget: 0, same: 0 };

  const allKeys = new Set<string>([...sourceMap.keys(), ...targetMap.keys()]);
  const sortedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));

  for (const relativePath of sortedKeys) {
    const sourceEntry = sourceMap.get(relativePath);
    const targetEntry = targetMap.get(relativePath);

    if (sourceEntry && !targetEntry) {
      entries.push({ relativePath, isDirectory: sourceEntry.isDirectory, status: 'new', sourceEntry });
      counts.new++;
      continue;
    }

    if (!sourceEntry && targetEntry) {
      entries.push({ relativePath, isDirectory: targetEntry.isDirectory, status: 'only-target', targetEntry });
      counts.onlyTarget++;
      continue;
    }

    if (sourceEntry && targetEntry) {
      // Directories match on presence alone; there's no meaningful size/mtime to diff.
      if (sourceEntry.isDirectory || targetEntry.isDirectory) {
        counts.same++;
        continue;
      }

      const sizeDiffers = sourceEntry.size !== targetEntry.size;
      let mtimeDiffers = false;
      if (sourceEntry.mtimeMs !== undefined && targetEntry.mtimeMs !== undefined) {
        mtimeDiffers = Math.abs(sourceEntry.mtimeMs - targetEntry.mtimeMs) > MTIME_TOLERANCE_MS;
      }

      if (sizeDiffers || mtimeDiffers) {
        entries.push({ relativePath, isDirectory: false, status: 'changed', sourceEntry, targetEntry });
        counts.changed++;
      } else {
        counts.same++;
      }
    }
  }

  return {
    entries,
    counts,
    scannedAt: new Date().toISOString(),
    skippedPaths: { source: skippedSource, target: skippedTarget },
  };
}

export interface ApplyOptions {
  deleteExtraneous: boolean;
}

/**
 * Applies a (possibly filtered) set of diff entries: copies included
 * new/changed entries from source to target (creating target folders first),
 * and — when deleteExtraneous is set — deletes included only-target entries.
 */
export async function apply(
  entries: DirectoryDiffEntry[],
  sourceProvider: IStorageProvider,
  targetProvider: IStorageProvider,
  targetPath: string,
  options: ApplyOptions,
  onProgress?: (progress: TransferProgress) => void
): Promise<DirectorySyncApplyResult> {
  const result: DirectorySyncApplyResult = { copied: 0, deleted: 0, failed: 0, errors: [] };
  const jobId = 'dirsync-apply';

  // The sync root itself (e.g. the source folder nested under the chosen
  // target parent) may not exist yet — create it before copying into it.
  try {
    await targetProvider.createFolder(targetPath);
  } catch {
    // Already exists (or provider doesn't need explicit creation) — fine.
  }

  const toCopy = entries.filter((e) => e.status === 'new' || e.status === 'changed');
  const dirsToCreate = toCopy
    .filter((e) => e.isDirectory)
    .sort((a, b) => a.relativePath.split('/').length - b.relativePath.split('/').length);
  const filesToCopy = toCopy.filter((e) => !e.isDirectory);

  for (const dirEntry of dirsToCreate) {
    try {
      const targetFull = joinPaths(targetProvider.type, targetPath, dirEntry.relativePath);
      await targetProvider.createFolder(targetFull);
    } catch (err) {
      result.failed++;
      result.errors.push({ path: dirEntry.relativePath, error: (err as Error)?.message ?? String(err) });
    }
  }

  for (const fileEntry of filesToCopy) {
    const sourceFull = fileEntry.sourceEntry?.path ?? joinPaths(sourceProvider.type, '', fileEntry.relativePath);
    const targetFull = joinPaths(targetProvider.type, targetPath, fileEntry.relativePath);
    try {
      await transferFile({
        jobId,
        sourceProvider,
        sourcePath: sourceFull,
        targetProvider,
        targetPath: targetFull,
        totalBytes: fileEntry.sourceEntry?.size,
        onProgress,
      });
      // Preserve the source's mtime on the target so the *next* diff compares
      // against the original modification time, not "when it was copied" —
      // otherwise every synced file would look "changed" on every re-run.
      if (fileEntry.sourceEntry?.mtimeMs !== undefined) {
        try {
          await targetProvider.setModifiedTime?.(targetFull, fileEntry.sourceEntry.mtimeMs);
        } catch {
          // Not fatal — the copy itself succeeded, and not every provider
          // combination can preserve mtime (e.g. an S3 target).
        }
      }
      result.copied++;
    } catch (err) {
      result.failed++;
      result.errors.push({ path: fileEntry.relativePath, error: (err as Error)?.message ?? String(err) });
    }
  }

  if (options.deleteExtraneous) {
    const toDelete = entries.filter((e) => e.status === 'only-target');
    // Deepest paths first so a directory is emptied before it is removed.
    const sortedForDelete = [...toDelete].sort(
      (a, b) => b.relativePath.split('/').length - a.relativePath.split('/').length
    );
    for (const delEntry of sortedForDelete) {
      const targetFull = delEntry.targetEntry?.path ?? joinPaths(targetProvider.type, targetPath, delEntry.relativePath);
      try {
        await targetProvider.delete(targetFull, delEntry.isDirectory);
        result.deleted++;
      } catch (err) {
        result.failed++;
        result.errors.push({ path: delEntry.relativePath, error: (err as Error)?.message ?? String(err) });
      }
    }
  }

  return result;
}

export class DirectorySyncService {
  buildTree = buildTree;
  computeDiff = computeDiff;
  apply = apply;
}
