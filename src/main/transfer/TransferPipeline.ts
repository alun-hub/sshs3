import path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  IStorageProvider,
  StorageType,
  TransferProgress,
} from '../../shared/types/storage';

/**
 * Controller to pause and resume streaming in TransferPipeline.
 */
export class PauseController {
  private _isPaused = false;
  private _resumeResolvers: Array<() => void> = [];

  get isPaused(): boolean {
    return this._isPaused;
  }

  pause(): void {
    this._isPaused = true;
  }

  resume(): void {
    if (this._isPaused) {
      this._isPaused = false;
      const resolvers = this._resumeResolvers;
      this._resumeResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  async waitIfPaused(): Promise<void> {
    if (!this._isPaused) return;
    await new Promise<void>((resolve) => {
      this._resumeResolvers.push(resolve);
    });
  }

  abort(): void {
    if (this._isPaused) {
      this.resume();
    }
  }
}

export interface ByteMeterOptions {
  jobId?: string;
  fileName?: string;
  totalBytes?: number;
  throttleIntervalMs?: number;
  signal?: AbortSignal;
  pauseController?: PauseController;
  onProgress?: (progress: TransferProgress) => void;
  emitCompletedOnFlush?: boolean;
}

/**
 * Transform stream that counts bytes, computes transfer speed (bytes/s),
 * throttles progress updates to avoid flooding event loops, and coordinates pausing.
 */
export class ByteMeter extends Transform {
  public transferredBytes = 0;
  public totalBytes: number;
  public readonly jobId: string;
  public readonly fileName: string;
  private readonly throttleIntervalMs: number;
  private readonly signal?: AbortSignal;
  private readonly pauseController?: PauseController;
  private readonly onProgress?: (progress: TransferProgress) => void;
  private readonly emitCompletedOnFlush: boolean;
  private startTime = 0;
  private lastEmitTime = 0;
  private lastEmittedBytes = 0;

  constructor(options: ByteMeterOptions = {}) {
    super();
    this.jobId = options.jobId ?? 'transfer-job';
    this.fileName = options.fileName ?? 'unknown';
    this.totalBytes = options.totalBytes ?? 0;
    this.throttleIntervalMs = options.throttleIntervalMs ?? 100;
    this.signal = options.signal;
    this.pauseController = options.pauseController;
    this.onProgress = options.onProgress;
    this.emitCompletedOnFlush = options.emitCompletedOnFlush ?? true;
  }

  private calculateSpeed(now: number): number {
    if (this.lastEmitTime > 0 && now > this.lastEmitTime) {
      const deltaBytes = this.transferredBytes - this.lastEmittedBytes;
      const deltaTime = (now - this.lastEmitTime) / 1000;
      if (deltaTime > 0) {
        return Math.round(deltaBytes / deltaTime);
      }
    }
    if (this.startTime === 0) return 0;
    const elapsedSec = (now - this.startTime) / 1000;
    return elapsedSec > 0 ? Math.round(this.transferredBytes / elapsedSec) : 0;
  }

  private emitProgress(status: TransferProgress['status']): void {
    if (!this.onProgress) return;
    const now = Date.now();
    const bytesPerSecond = this.calculateSpeed(now);
    const total = this.totalBytes > 0 ? this.totalBytes : this.transferredBytes;
    const percentage =
      total > 0
        ? Math.min(100, Math.round((this.transferredBytes / total) * 100))
        : status === 'completed'
          ? 100
          : 0;

    this.onProgress({
      jobId: this.jobId,
      fileName: this.fileName,
      transferredBytes: this.transferredBytes,
      totalBytes: this.totalBytes,
      percentage,
      bytesPerSecond,
      status,
    });
  }

  override async _transform(
    chunk: any,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): Promise<void> {
    try {
      if (this.signal?.aborted) {
        const err = new Error('Transfer aborted');
        err.name = 'AbortError';
        callback(err);
        return;
      }

      if (this.pauseController?.isPaused) {
        await this.pauseController.waitIfPaused();
      }

      if (this.signal?.aborted) {
        const err = new Error('Transfer aborted');
        err.name = 'AbortError';
        callback(err);
        return;
      }

      const now = Date.now();
      if (this.startTime === 0) {
        this.startTime = now;
      }

      const chunkSize = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk);
      this.transferredBytes += chunkSize;

      if (this.throttleIntervalMs === 0) {
        this.emitProgress('running');
      } else if (
        this.lastEmitTime === 0 ||
        now - this.lastEmitTime >= this.throttleIntervalMs
      ) {
        this.emitProgress('running');
        this.lastEmitTime = now;
        this.lastEmittedBytes = this.transferredBytes;
      }

      callback(null, chunk);
    } catch (err) {
      callback(err as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    if (this.startTime === 0) {
      this.startTime = Date.now();
    }
    if (this.emitCompletedOnFlush) {
      this.emitProgress('completed');
    }
    callback();
  }
}

export interface TransferOptions {
  jobId?: string;
  sourceProvider: IStorageProvider;
  sourcePath: string;
  targetProvider: IStorageProvider;
  targetPath: string;
  totalBytes?: number;
  signal?: AbortSignal;
  pauseController?: PauseController;
  onProgress?: (progress: TransferProgress) => void;
  throttleIntervalMs?: number;
  emitCompleted?: boolean;
}

/**
 * Join paths according to target storage provider conventions.
 */
export function joinPaths(
  providerType: StorageType,
  parent: string,
  child: string
): string {
  if (providerType === 'local') {
    if (!parent) return child;
    return path.join(parent, child);
  }

  // SFTP and S3 paths use posix slashes
  if (!parent || parent === '.') return child;
  if (parent === '/') {
    return `/${child.replace(/^\/+/, '')}`;
  }
  const cleanParent = parent.replace(/\/+$/, '');
  const cleanChild = child.replace(/^\/+/, '');
  if (!cleanParent) return cleanChild;
  return `${cleanParent}/${cleanChild}`;
}

/**
 * Transfer a single file directly between storage providers via Node.js memory streams.
 */
export async function transferFile(options: TransferOptions): Promise<void> {
  if (options.signal?.aborted) {
    const err = new Error('Transfer aborted');
    err.name = 'AbortError';
    throw err;
  }

  const fileName =
    path.basename(options.sourcePath) || options.sourcePath || 'file';

  let totalBytes = options.totalBytes;
  if (totalBytes === undefined || totalBytes < 0) {
    try {
      const stat = await options.sourceProvider.stat(options.sourcePath);
      totalBytes = stat.size >= 0 ? stat.size : 0;
    } catch {
      totalBytes = 0;
    }
  }

  const readStream = await options.sourceProvider.createReadStream(
    options.sourcePath
  );
  const writeStream = await options.targetProvider.createWriteStream(
    options.targetPath,
    { size: totalBytes }
  );

  const meter = new ByteMeter({
    jobId: options.jobId,
    fileName,
    totalBytes,
    throttleIntervalMs: options.throttleIntervalMs,
    signal: options.signal,
    pauseController: options.pauseController,
    onProgress: options.onProgress,
    emitCompletedOnFlush: options.emitCompleted ?? true,
  });

  await pipeline(readStream, meter, writeStream, { signal: options.signal });
}

interface ScannedFile {
  sourcePath: string;
  targetPath: string;
  size: number;
}

interface ScanResult {
  folders: string[];
  files: ScannedFile[];
  totalBytes: number;
}

async function scanDirectory(
  sourceProvider: IStorageProvider,
  currentSourcePath: string,
  currentTargetPath: string,
  targetType: StorageType,
  signal?: AbortSignal
): Promise<ScanResult> {
  if (signal?.aborted) {
    const err = new Error('Transfer aborted');
    err.name = 'AbortError';
    throw err;
  }

  const result: ScanResult = {
    folders: [],
    files: [],
    totalBytes: 0,
  };

  const entries = await sourceProvider.list(currentSourcePath);

  for (const entry of entries) {
    if (signal?.aborted) {
      const err = new Error('Transfer aborted');
      err.name = 'AbortError';
      throw err;
    }

    const childTargetPath = joinPaths(targetType, currentTargetPath, entry.name);
    const childSourcePath =
      entry.path ||
      (currentSourcePath ? `${currentSourcePath}/${entry.name}` : entry.name);

    if (entry.isDirectory) {
      result.folders.push(childTargetPath);
      const subResult = await scanDirectory(
        sourceProvider,
        childSourcePath,
        childTargetPath,
        targetType,
        signal
      );
      result.folders.push(...subResult.folders);
      result.files.push(...subResult.files);
      result.totalBytes += subResult.totalBytes;
    } else {
      result.files.push({
        sourcePath: childSourcePath,
        targetPath: childTargetPath,
        size: entry.size || 0,
      });
      result.totalBytes += entry.size || 0;
    }
  }

  return result;
}

/**
 * Transfer an entire directory recursively between storage providers.
 */
export async function transferDirectory(
  options: TransferOptions
): Promise<void> {
  if (options.signal?.aborted) {
    const err = new Error('Transfer aborted');
    err.name = 'AbortError';
    throw err;
  }

  if (options.targetPath) {
    await options.targetProvider.createFolder(options.targetPath);
  }

  const scan = await scanDirectory(
    options.sourceProvider,
    options.sourcePath,
    options.targetPath,
    options.targetProvider.type,
    options.signal
  );

  for (const folder of scan.folders) {
    if (options.signal?.aborted) {
      const err = new Error('Transfer aborted');
      err.name = 'AbortError';
      throw err;
    }
    await options.targetProvider.createFolder(folder);
  }

  if (scan.files.length === 0) {
    options.onProgress?.({
      jobId: options.jobId ?? 'directory-transfer',
      fileName: options.sourcePath || 'directory',
      transferredBytes: 0,
      totalBytes: 0,
      percentage: 100,
      bytesPerSecond: 0,
      status: 'completed',
    });
    return;
  }

  let overallTransferredBytes = 0;
  const totalDirectoryBytes = scan.totalBytes;

  for (const file of scan.files) {
    if (options.signal?.aborted) {
      const err = new Error('Transfer aborted');
      err.name = 'AbortError';
      throw err;
    }

    let lastReportedFileBytes = 0;

    await transferFile({
      ...options,
      sourcePath: file.sourcePath,
      targetPath: file.targetPath,
      totalBytes: file.size,
      emitCompleted: false,
      onProgress: (fp) => {
        lastReportedFileBytes = fp.transferredBytes;
        const currentOverall =
          overallTransferredBytes + lastReportedFileBytes;
        const percentage =
          totalDirectoryBytes > 0
            ? Math.min(
                100,
                Math.round((currentOverall / totalDirectoryBytes) * 100)
              )
            : 100;

        options.onProgress?.({
          jobId: options.jobId ?? 'directory-transfer',
          fileName: path.basename(file.sourcePath),
          transferredBytes: currentOverall,
          totalBytes: totalDirectoryBytes,
          percentage,
          bytesPerSecond: fp.bytesPerSecond,
          status: 'running',
        });
      },
    });

    overallTransferredBytes += file.size;
  }

  options.onProgress?.({
    jobId: options.jobId ?? 'directory-transfer',
    fileName: options.sourcePath || 'directory',
    transferredBytes: totalDirectoryBytes,
    totalBytes: totalDirectoryBytes,
    percentage: 100,
    bytesPerSecond: 0,
    status: 'completed',
  });
}

/**
 * TransferPipeline class encapsulating streaming file and directory transfers.
 */
export class TransferPipeline {
  static async transferFile(options: TransferOptions): Promise<void> {
    return transferFile(options);
  }

  static async transferDirectory(options: TransferOptions): Promise<void> {
    return transferDirectory(options);
  }

  async transferFile(options: TransferOptions): Promise<void> {
    return transferFile(options);
  }

  async transferDirectory(options: TransferOptions): Promise<void> {
    return transferDirectory(options);
  }
}
