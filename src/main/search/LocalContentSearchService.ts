import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { StorageRegistry } from '../storage/StorageRegistry';
import { LocalStorageProvider } from '../storage/LocalStorageProvider';
import { buildLineMatcher } from './lineMatcher';
import { matchesAnyGlob, isLikelyBinary } from './globMatch';
import type {
  SearchDoneEvent,
  SearchErrorEvent,
  SearchMatch,
  SearchPreviewResult,
  SearchProgressEvent,
  SearchResultEvent,
  SearchStartOptions,
} from '../../shared/types/search';

const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const CONCURRENCY = 8;
const BATCH_MAX_MATCHES = 25;
const BATCH_MAX_DELAY_MS = 150;
const SEARCH_TIMEOUT_MS = 120_000;
const PROGRESS_INTERVAL_MS = 300;

interface ActiveSearchSession {
  cancel: () => void;
}

interface Candidate {
  path: string;
  displayPath: string;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Searches inside local files by walking the directory tree with plain Node `fs` and
 * scanning matching files in memory — deliberately the same shape as
 * S3ContentSearchService (list candidates, worker pool, line matcher) rather than
 * shelling out to `find`/`grep`. That keeps this backend working identically on Linux,
 * macOS, and Windows without depending on WSL, Git Bash, or PowerShell being installed.
 */
export class LocalContentSearchService {
  private sessions = new Map<string, ActiveSearchSession>();

  public async startSearch(
    storageRegistry: StorageRegistry,
    options: SearchStartOptions,
    onResult: (event: SearchResultEvent) => void,
    onError: (event: SearchErrorEvent) => void,
    onDone: (event: SearchDoneEvent) => void,
    onProgress?: (event: SearchProgressEvent) => void
  ): Promise<{ searchId: string }> {
    const provider = storageRegistry.get(options.providerId);
    if (!provider || !(provider instanceof LocalStorageProvider)) {
      throw new Error(`Local storage provider not found: ${options.providerId}`);
    }

    const rootDir = provider.resolvePath(options.rootPath);
    const searchId = crypto.randomUUID();
    const maxResults = options.maxResults ?? 500;
    const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const matcher = buildLineMatcher(options.query, options.mode, options.caseSensitive);

    const abortController = new AbortController();
    let cancelled = false;
    let timedOut = false;
    let finished = false;
    let scannedCount = 0;
    let matchCount = 0;
    let matchIdCounter = 0;
    let currentPath: string | undefined;
    let pendingBatch: SearchMatch[] = [];
    let batchTimer: NodeJS.Timeout | null = null;

    const flushBatch = () => {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      if (pendingBatch.length === 0) return;
      onResult({ searchId, matches: pendingBatch });
      pendingBatch = [];
    };
    const scheduleFlush = () => {
      if (batchTimer) return;
      batchTimer = setTimeout(flushBatch, BATCH_MAX_DELAY_MS);
    };

    const hasHitCap = () => matchCount >= maxResults;
    const shouldStop = () => cancelled || timedOut || hasHitCap();

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      onError({ searchId, message: 'Search timed out after 120 seconds', fatal: false });
    }, SEARCH_TIMEOUT_MS);

    const progressInterval = onProgress
      ? setInterval(() => onProgress({ searchId, scannedCount, matchCount, currentPath }), PROGRESS_INTERVAL_MS)
      : null;

    const finish = () => {
      if (finished) return;
      finished = true;
      flushBatch();
      clearTimeout(timeoutHandle);
      if (progressInterval) clearInterval(progressInterval);
      this.sessions.delete(searchId);
      onDone({ searchId, matchCount, scannedCount, cancelled, truncated: hasHitCap() || timedOut });
    };

    this.sessions.set(searchId, {
      cancel: () => {
        cancelled = true;
        abortController.abort();
      },
    });

    const collectCandidates = async (dir: string, depth: number, out: Candidate[]): Promise<void> => {
      if (shouldStop()) return;
      let entries;
      try {
        // `signal` is supported by Node's fs.promises.readdir at runtime (verified against the
        // bundled Node 22) but missing from @types/node's overloads for it. Assigning through a
        // typed variable (rather than casting the call's own literal) avoids losing the
        // `withFileTypes: true` overload resolution that an `as any` on the literal would erase.
        const readdirOptions: { withFileTypes: true; signal?: AbortSignal } = {
          withFileTypes: true,
          signal: abortController.signal,
        };
        entries = await fsp.readdir(dir, readdirOptions);
      } catch (err) {
        if (!isAbortError(err)) {
          onError({
            searchId,
            path: dir,
            message: err instanceof Error ? err.message : String(err),
            fatal: false,
          });
        }
        return;
      }

      for (const entry of entries) {
        if (shouldStop()) return;
        // Skip symlinks to avoid following cycles back up the tree, same as SFTP's `! -type l`.
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (options.maxDepth === undefined || depth < options.maxDepth) {
            await collectCandidates(fullPath, depth + 1, out);
          }
          continue;
        }
        if (!entry.isFile()) continue;

        if (options.includeGlobs?.length && !matchesAnyGlob(entry.name, options.includeGlobs)) continue;
        if (options.excludeGlobs?.length && matchesAnyGlob(entry.name, options.excludeGlobs)) continue;

        let size: number;
        try {
          // Same @types/node gap as above: fsp.stat supports `signal` at runtime.
          size = (await fsp.stat(fullPath, { signal: abortController.signal } as any)).size;
        } catch {
          continue; // Gone/inaccessible between readdir and stat, or aborted — skip quietly.
        }
        if (size > maxFileSizeBytes) {
          onError({
            searchId,
            path: fullPath,
            message: `Skipped: exceeds size cap (${size} bytes > ${maxFileSizeBytes} bytes)`,
            fatal: false,
          });
          continue;
        }

        out.push({ path: fullPath, displayPath: path.relative(rootDir, fullPath) || entry.name });
      }
    };

    const runPool = async (items: Candidate[]): Promise<void> => {
      let index = 0;
      const next = async (): Promise<void> => {
        while (index < items.length) {
          if (shouldStop()) return;
          const candidate = items[index++];
          scannedCount += 1;
          currentPath = candidate.displayPath;
          try {
            const buf = await fsp.readFile(candidate.path, { signal: abortController.signal });
            if (isLikelyBinary(buf)) continue;
            const lines = buf.toString('utf-8').split('\n');
            for (let i = 0; i < lines.length; i++) {
              // Checked every line (not just per file) so cancelling mid-scan of one very
              // large file takes effect immediately instead of waiting for it to finish.
              if (shouldStop()) break;
              const offsets = matcher(lines[i]);
              if (!offsets) continue;
              matchIdCounter += 1;
              matchCount += 1;
              pendingBatch.push({
                id: `${searchId}-${matchIdCounter}`,
                path: candidate.path,
                displayPath: candidate.displayPath,
                lineNumber: i + 1,
                snippet: lines[i].trim(),
                matchStart: offsets.start,
                matchEnd: offsets.end,
                source: 'local-fs',
              });
              if (pendingBatch.length >= BATCH_MAX_MATCHES) flushBatch();
              else scheduleFlush();
            }
          } catch (err) {
            if (!isAbortError(err)) {
              onError({
                searchId,
                path: candidate.path,
                message: err instanceof Error ? err.message : String(err),
                fatal: false,
              });
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
    };

    void (async () => {
      try {
        const candidates: Candidate[] = [];
        await collectCandidates(rootDir, 0, candidates);
        await runPool(candidates);
      } catch (err) {
        onError({ searchId, message: err instanceof Error ? err.message : String(err), fatal: true });
      } finally {
        finish();
      }
    })();

    return { searchId };
  }

  public cancelSearch(searchId: string): void {
    const session = this.sessions.get(searchId);
    if (session) {
      session.cancel();
      this.sessions.delete(searchId);
    }
  }

  /** Slices out the lines around a match for click-to-preview, reading only the file's
   * own lines — bounded by the same size cap every searched file already respected. */
  public async previewLines(
    storageRegistry: StorageRegistry,
    providerId: string,
    remotePath: string,
    lineNumber: number,
    contextLines: number
  ): Promise<SearchPreviewResult> {
    const provider = storageRegistry.get(providerId);
    if (!provider || !(provider instanceof LocalStorageProvider)) {
      throw new Error(`Local storage provider not found: ${providerId}`);
    }

    const safeLine = Number.isInteger(lineNumber) && lineNumber >= 1 ? lineNumber : 1;
    const safeContext = Number.isInteger(contextLines) && contextLines >= 0 ? contextLines : 0;
    const startLine = Math.max(1, safeLine - safeContext);
    const endLine = safeLine + safeContext;

    const fullPath = provider.resolvePath(remotePath);
    const buf = await fsp.readFile(fullPath);
    const lines = buf.toString('utf-8').split('\n');
    const slice = lines.slice(startLine - 1, endLine).join('\n');

    return { content: slice, startLine };
  }

  public dispose(): void {
    for (const session of this.sessions.values()) {
      session.cancel();
    }
    this.sessions.clear();
  }
}
