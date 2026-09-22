import crypto from 'node:crypto';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { StorageRegistry } from '../storage/StorageRegistry';
import { S3StorageProvider, parseS3Path } from '../storage/S3StorageProvider';
import { buildLineMatcher } from './lineMatcher';
import type {
  SearchDoneEvent,
  SearchErrorEvent,
  SearchMatch,
  SearchPreviewResult,
  SearchProgressEvent,
  SearchResultEvent,
  SearchStartOptions,
} from '../../shared/types/search';

const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
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
  size: number;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesAnyGlob(name: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(name));
}

/** Reads a stream into a UTF-8 string, stopping (and destroying the stream) once `capBytes`
 * is exceeded so a single unexpectedly large or still-growing object can't blow up memory. */
function streamToString(stream: NodeJS.ReadableStream, capBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    stream.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > capBytes) {
        settled = true;
        (stream as any).destroy?.();
        resolve(Buffer.concat(chunks).toString('utf-8'));
        return;
      }
      chunks.push(buf);
    });
    stream.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    });
    stream.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

async function runPool<T>(items: T[], concurrency: number, shouldStop: () => boolean, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const next = async (): Promise<void> => {
    while (index < items.length) {
      if (shouldStop()) return;
      const item = items[index++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

/**
 * Searches inside S3 objects by downloading (or ranged-GETting) each candidate and
 * scanning it in memory — the same model as RemoteSearchService's SFTP grep, just over
 * GetObject instead of an SSH exec channel. S3 Select would let the server do this
 * filtering, but it's no longer available to new AWS accounts and is inconsistently
 * supported by S3-compatible providers (MinIO, NetApp), so download + scan is the only
 * approach that works identically everywhere this app connects.
 */
export class S3ContentSearchService {
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
    if (!provider || !(provider instanceof S3StorageProvider)) {
      throw new Error(`S3 storage provider not found: ${options.providerId}`);
    }

    const { bucket, key } = parseS3Path(options.rootPath);
    if (!bucket) {
      throw new Error('Select a bucket before searching inside files');
    }
    const prefix = key ? (key.endsWith('/') ? key : `${key}/`) : '';

    const searchId = crypto.randomUUID();
    const maxResults = options.maxResults ?? 500;
    const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const matcher = buildLineMatcher(options.query, options.mode, options.caseSensitive);

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
      },
    });

    void (async () => {
      try {
        const candidates: Candidate[] = [];
        let continuationToken: string | undefined;
        do {
          if (shouldStop()) break;
          const output = await provider.client.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken })
          );
          for (const item of output.Contents ?? []) {
            const itemKey = item.Key ?? '';
            if (!itemKey || itemKey.endsWith('/')) continue;
            const size = item.Size ?? 0;
            if (size > maxFileSizeBytes) continue;
            const name = itemKey.split('/').pop() ?? itemKey;
            if (options.includeGlobs?.length && !matchesAnyGlob(name, options.includeGlobs)) continue;
            if (options.excludeGlobs?.length && matchesAnyGlob(name, options.excludeGlobs)) continue;
            candidates.push({
              path: `/${bucket}/${itemKey}`,
              displayPath: itemKey.startsWith(prefix) ? itemKey.slice(prefix.length) : itemKey,
              size,
            });
          }
          continuationToken = output.NextContinuationToken;
        } while (continuationToken);

        await runPool(candidates, CONCURRENCY, shouldStop, async (candidate) => {
          if (shouldStop()) return;
          scannedCount += 1;
          currentPath = candidate.displayPath;
          try {
            const stream = await provider.createReadStream(candidate.path);
            const content = await streamToString(stream, maxFileSizeBytes);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (hasHitCap()) break;
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
                source: 's3-download',
              });
              if (pendingBatch.length >= BATCH_MAX_MATCHES) flushBatch();
              else scheduleFlush();
            }
          } catch (err) {
            onError({
              searchId,
              path: candidate.path,
              message: err instanceof Error ? err.message : String(err),
              fatal: false,
            });
          }
        });
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

  /**
   * Re-downloads the object and slices out the lines around a match for click-to-preview.
   * There's no server-side index to seek by line, but every object eligible for search was
   * already under maxFileSizeBytes, so re-fetching it here is bounded by the same cap.
   */
  public async previewLines(
    storageRegistry: StorageRegistry,
    providerId: string,
    remotePath: string,
    lineNumber: number,
    contextLines: number
  ): Promise<SearchPreviewResult> {
    const provider = storageRegistry.get(providerId);
    if (!provider || !(provider instanceof S3StorageProvider)) {
      throw new Error(`S3 storage provider not found: ${providerId}`);
    }

    const safeLine = Number.isInteger(lineNumber) && lineNumber >= 1 ? lineNumber : 1;
    const safeContext = Number.isInteger(contextLines) && contextLines >= 0 ? contextLines : 0;
    const startLine = Math.max(1, safeLine - safeContext);
    const endLine = safeLine + safeContext;

    const stream = await provider.createReadStream(remotePath);
    const content = await streamToString(stream, DEFAULT_MAX_FILE_SIZE_BYTES);
    const lines = content.split('\n');
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
