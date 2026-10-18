import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IStorageProvider } from '../storage/StorageProvider';
import type { TransferQueue } from '../transfer/TransferQueue';

/** Largest single file that may be staged for a drag-out (folders are not capped up front). */
export const MAX_STAGED_FILE_BYTES = 500 * 1024 * 1024;
/** Staging roots of earlier runs older than this are removed (long enough not to touch another running instance). */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_PREPARE_PATHS = 100;
const ROOT_PREFIX = 'sshs3-dragout-';

export interface DragOutStageDeps {
  getSource(providerId: string): IStorageProvider | undefined;
  getLocal(): Promise<IStorageProvider>;
  queue: Pick<TransferQueue, 'addJob' | 'waitForJob'>;
}

/** True for a plain entry name that cannot escape the staging directory. */
export function isSafeStageName(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
}

function baseName(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? '';
}

/**
 * Downloads remote files/folders into a private temp directory so they can be handed to the OS
 * as a native drag source (which needs real files on disk). Results are cached per
 * provider/path/mtime/size and removed when the app quits or on the next start.
 */
export class DragOutService {
  private rootPromise: Promise<string> | null = null;
  private swept = false;
  /** Latest staged copy of each directory, replaced (and the old one deleted) when it is staged again. */
  private readonly stagedDirs = new Map<string, string>();
  private readonly staged = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();

  /** `parentDir` is where the private staging root is created (the OS temp dir by default). */
  constructor(private readonly deps: DragOutStageDeps, private readonly parentDir: string = os.tmpdir()) {}

  /** Creates the staging root on first use. mkdtemp gives an unpredictable name and mode 0700, so no other user can pre-create or read it. */
  private ensureRoot(): Promise<string> {
    // Memoized as a promise so concurrent first calls share one root
    this.rootPromise ??= fsp.mkdtemp(path.join(this.parentDir, ROOT_PREFIX));
    return this.rootPromise;
  }

  /** Stages every path and resolves to the local paths, in the same order. */
  public async prepare(providerId: unknown, remotePaths: unknown): Promise<string[]> {
    if (typeof providerId !== 'string' || !providerId) throw new Error('providerId is required');
    if (!Array.isArray(remotePaths) || remotePaths.length === 0 || remotePaths.length > MAX_PREPARE_PATHS) {
      throw new Error('Select between 1 and 100 items to drag');
    }
    const source = this.deps.getSource(providerId);
    if (!source) throw new Error(`Storage provider not found: ${providerId}`);
    if (!this.swept) {
      this.swept = true;
      await this.removeStale();
    }

    const result: string[] = [];
    for (const remote of remotePaths) {
      if (typeof remote !== 'string' || !remote || remote.includes('\0')) throw new Error('Invalid path');
      result.push(await this.stageOne(source, providerId, remote));
    }
    return result;
  }

  private async stageOne(source: IStorageProvider, providerId: string, remotePath: string): Promise<string> {
    const name = baseName(remotePath);
    if (!isSafeStageName(name)) throw new Error('Cannot drag an item with this name');
    const stats = await source.stat(remotePath);
    if (!stats.isDirectory && stats.isSpecial) throw new Error('Not a regular file');
    if (!stats.isDirectory && (stats.size ?? 0) > MAX_STAGED_FILE_BYTES) {
      throw new Error('File is too large to drag out (limit 500 MB); download it with the file manager instead');
    }

    // A directory's own mtime/size do not change when files inside it do, so directories are never
    // served from cache; they are downloaded again each time.
    const isDir = Boolean(stats.isDirectory);
    const key = isDir
      ? [providerId, remotePath, 'dir'].join('\0')
      : [providerId, remotePath, String(stats.mtimeMs ?? stats.mtime ?? ''), String(stats.size ?? '')].join('\0');
    const cached = isDir ? undefined : this.staged.get(key);
    if (cached && (await fsp.stat(cached).then(() => true, () => false))) return cached;
    const running = this.inFlight.get(key);
    if (running) return running;

    const job = (async () => {
      const dir = path.join(await this.ensureRoot(), crypto.randomUUID());
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      const target = path.join(dir, name);
      const local = await this.deps.getLocal();
      const queued = this.deps.queue.addJob({
        sourceProvider: source,
        sourcePath: remotePath,
        targetProvider: local,
        targetPath: target,
        isDirectory: Boolean(stats.isDirectory),
        totalBytes: stats.size,
        verifyIntegrity: false,
      });
      const finished = await this.deps.queue.waitForJob(queued.id);
      if (finished.progress.status !== 'completed') {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        throw new Error(finished.error || `Could not download ${name}`);
      }
      if (isDir) {
        const previous = this.stagedDirs.get(key);
        this.stagedDirs.set(key, target);
        if (previous) await fsp.rm(path.dirname(previous), { recursive: true, force: true }).catch(() => {});
      } else {
        this.staged.set(key, target);
      }
      return target;
    })();
    this.inFlight.set(key, job);
    try {
      return await job;
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Removes roots left behind by earlier runs (crash, kill): ours by prefix, owned by this user and old enough. */
  private async removeStale(): Promise<void> {
    let names: string[];
    try {
      names = await fsp.readdir(this.parentDir);
    } catch {
      return;
    }
    const uid = process.getuid?.();
    for (const entry of names) {
      if (!entry.startsWith(ROOT_PREFIX)) continue;
      const full = path.join(this.parentDir, entry);
      const stat = await fsp.lstat(full).catch(() => null);
      if (!stat || !stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) continue;
      if (Date.now() - stat.mtimeMs > STALE_AFTER_MS) {
        await fsp.rm(full, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /** Removes every staged copy. */
  public async dispose(): Promise<void> {
    this.staged.clear();
    this.stagedDirs.clear();
    const rootPromise = this.rootPromise;
    this.rootPromise = null;
    if (!rootPromise) return;
    const root = await rootPromise.catch(() => null);
    if (root) await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
