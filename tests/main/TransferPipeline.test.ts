import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { Readable, Writable, PassThrough } from 'node:stream';
import { LocalStorageProvider } from '../../src/main/storage/LocalStorageProvider';
import {
  TransferPipeline,
  transferFile,
  transferDirectory,
  ByteMeter,
  PauseController,
} from '../../src/main/transfer/TransferPipeline';
import {
  TransferQueue,
  type TransferJob,
} from '../../src/main/transfer/TransferQueue';
import type {
  FileEntry,
  IStorageProvider,
  StorageType,
  TransferProgress,
  WriteStreamOptions,
} from '../../src/shared/types/storage';

/**
 * Helper to create an in-memory mock storage provider.
 */
class MemoryStorageProvider implements IStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType = 'local';
  public files = new Map<string, Buffer>();
  public folders = new Set<string>();
  public readStreamError?: Error;
  public writeStreamError?: Error;

  constructor(id: string = 'memory', name: string = 'Memory Storage') {
    this.id = id;
    this.name = name;
  }

  async list(remotePath: string): Promise<FileEntry[]> {
    const norm = remotePath.replace(/\/+$/, '');
    const entries: FileEntry[] = [];
    for (const folder of this.folders) {
      if (folder !== norm && folder.startsWith(norm ? `${norm}/` : '')) {
        const rel = norm ? folder.slice(norm.length + 1) : folder;
        if (!rel.includes('/')) {
          entries.push({
            name: rel,
            path: folder,
            size: 0,
            isDirectory: true,
          });
        }
      }
    }
    for (const [filePath, content] of this.files) {
      if (filePath.startsWith(norm ? `${norm}/` : '')) {
        const rel = norm ? filePath.slice(norm.length + 1) : filePath;
        if (!rel.includes('/')) {
          entries.push({
            name: rel,
            path: filePath,
            size: content.length,
            isDirectory: false,
          });
        }
      }
    }
    return entries;
  }

  async stat(remotePath: string): Promise<FileEntry> {
    if (this.folders.has(remotePath)) {
      return {
        name: path.basename(remotePath),
        path: remotePath,
        size: 0,
        isDirectory: true,
      };
    }
    const content = this.files.get(remotePath);
    if (content !== undefined) {
      return {
        name: path.basename(remotePath),
        path: remotePath,
        size: content.length,
        isDirectory: false,
      };
    }
    throw new Error(`File not found: ${remotePath}`);
  }

  async createFolder(remotePath: string): Promise<void> {
    this.folders.add(remotePath);
  }

  async delete(remotePath: string, isDirectory: boolean): Promise<void> {
    if (isDirectory) {
      this.folders.delete(remotePath);
      for (const key of this.files.keys()) {
        if (key.startsWith(`${remotePath}/`)) this.files.delete(key);
      }
    } else {
      this.files.delete(remotePath);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content !== undefined) {
      this.files.delete(oldPath);
      this.files.set(newPath, content);
    }
  }

  async createReadStream(remotePath: string): Promise<NodeJS.ReadableStream> {
    if (this.readStreamError) {
      const readErr = this.readStreamError;
      const errStream = new Readable({
        read() {
          this.destroy(readErr);
        },
      });
      return errStream;
    }
    const content = this.files.get(remotePath);
    if (content === undefined) {
      throw new Error(`File not found: ${remotePath}`);
    }
    return Readable.from([content]);
  }

  async createWriteStream(remotePath: string, _options?: WriteStreamOptions): Promise<NodeJS.WritableStream> {
    if (this.writeStreamError) {
      const writeErr = this.writeStreamError;
      const errStream = new Writable({
        write(_chunk, _encoding, callback) {
          callback(writeErr);
        },
      });
      return errStream;
    }
    const chunks: Buffer[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
    });
    stream.on('finish', () => {
      this.files.set(remotePath, Buffer.concat(chunks));
    });
    return stream;
  }
}

describe('TransferPipeline', () => {
  let sourceDir: string;
  let targetDir: string;
  let sourceLocal: LocalStorageProvider;
  let targetLocal: LocalStorageProvider;

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-transfer-test-'));
    sourceDir = path.join(base, 'source');
    targetDir = path.join(base, 'target');
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
    sourceLocal = new LocalStorageProvider({ basePath: sourceDir });
    targetLocal = new LocalStorageProvider({ basePath: targetDir });
  });

  afterEach(async () => {
    if (sourceDir) {
      const base = path.dirname(sourceDir);
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  describe('Single file transfer', () => {
    it('should transfer a file directly from source to target using memory streams', async () => {
      const fileName = 'hello.txt';
      const fileContent = 'MultiSSH streaming transfer test data 12345';
      await fs.writeFile(path.join(sourceDir, fileName), fileContent, 'utf-8');

      const progressUpdates: TransferProgress[] = [];

      await transferFile({
        sourceProvider: sourceLocal,
        sourcePath: fileName,
        targetProvider: targetLocal,
        targetPath: fileName,
        onProgress: (p) => progressUpdates.push({ ...p }),
      });

      const written = await fs.readFile(path.join(targetDir, fileName), 'utf-8');
      expect(written).toBe(fileContent);

      expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
      const lastProgress = progressUpdates[progressUpdates.length - 1];
      expect(lastProgress.status).toBe('completed');
      expect(lastProgress.transferredBytes).toBe(Buffer.byteLength(fileContent));
      expect(lastProgress.totalBytes).toBe(Buffer.byteLength(fileContent));
      expect(lastProgress.percentage).toBe(100);
    });

    it('should transfer empty file (0 bytes) successfully', async () => {
      const fileName = 'empty.txt';
      await fs.writeFile(path.join(sourceDir, fileName), '', 'utf-8');

      const progressUpdates: TransferProgress[] = [];
      await transferFile({
        sourceProvider: sourceLocal,
        sourcePath: fileName,
        targetProvider: targetLocal,
        targetPath: fileName,
        onProgress: (p) => progressUpdates.push({ ...p }),
      });

      const written = await fs.readFile(path.join(targetDir, fileName), 'utf-8');
      expect(written).toBe('');
      const last = progressUpdates[progressUpdates.length - 1];
      expect(last.transferredBytes).toBe(0);
      expect(last.totalBytes).toBe(0);
      expect(last.percentage).toBe(100);
      expect(last.status).toBe('completed');
    });

    it('should transfer between different provider instances', async () => {
      const memProvider = new MemoryStorageProvider();
      const content = Buffer.from('Cross-provider streaming transfer content');
      memProvider.files.set('remote-file.bin', content);

      await transferFile({
        sourceProvider: memProvider,
        sourcePath: 'remote-file.bin',
        targetProvider: targetLocal,
        targetPath: 'local-file.bin',
      });

      const written = await fs.readFile(path.join(targetDir, 'local-file.bin'));
      expect(written.equals(content)).toBe(true);
    });

    it('should support TransferPipeline class static and instance methods', async () => {
      const fileName = 'class-method.txt';
      const fileContent = 'testing TransferPipeline class methods';
      await fs.writeFile(path.join(sourceDir, fileName), fileContent, 'utf-8');

      // Static method test
      await TransferPipeline.transferFile({
        sourceProvider: sourceLocal,
        sourcePath: fileName,
        targetProvider: targetLocal,
        targetPath: 'static-copy.txt',
      });
      const staticRead = await fs.readFile(path.join(targetDir, 'static-copy.txt'), 'utf-8');
      expect(staticRead).toBe(fileContent);

      // Instance method test
      const pipelineInstance = new TransferPipeline();
      await pipelineInstance.transferFile({
        sourceProvider: sourceLocal,
        sourcePath: fileName,
        targetProvider: targetLocal,
        targetPath: 'instance-copy.txt',
      });
      const instanceRead = await fs.readFile(path.join(targetDir, 'instance-copy.txt'), 'utf-8');
      expect(instanceRead).toBe(fileContent);
    });
  });

  describe('ByteMeter and progress reporting', () => {
    it('should accurately report transferred bytes, percentage, bytesPerSecond, and status', async () => {
      const totalSize = 1000;
      const chunks = [
        Buffer.alloc(250, 'a'),
        Buffer.alloc(250, 'b'),
        Buffer.alloc(250, 'c'),
        Buffer.alloc(250, 'd'),
      ];

      const progressHistory: TransferProgress[] = [];
      const meter = new ByteMeter({
        jobId: 'test-meter-job',
        fileName: 'data.bin',
        totalBytes: totalSize,
        throttleIntervalMs: 0, // no throttle for exact chunk verification
        onProgress: (p) => progressHistory.push({ ...p }),
      });

      const input = Readable.from(chunks);
      const output = new Writable({
        write(_chunk, _encoding, cb) {
          cb();
        },
      });

      await new Promise<void>((resolve, reject) => {
        input.pipe(meter).pipe(output);
        output.on('finish', () => resolve());
        output.on('error', reject);
      });

      expect(progressHistory.length).toBeGreaterThanOrEqual(4);
      const finalProgress = progressHistory[progressHistory.length - 1];
      expect(finalProgress.jobId).toBe('test-meter-job');
      expect(finalProgress.fileName).toBe('data.bin');
      expect(finalProgress.transferredBytes).toBe(totalSize);
      expect(finalProgress.totalBytes).toBe(totalSize);
      expect(finalProgress.percentage).toBe(100);
      expect(finalProgress.status).toBe('completed');
      expect(finalProgress.bytesPerSecond).toBeGreaterThanOrEqual(0);
    });

    it('should throttle progress updates when throttleIntervalMs is set', async () => {
      const chunks: Buffer[] = [];
      for (let i = 0; i < 50; i++) {
        chunks.push(Buffer.alloc(100, i));
      }

      const progressHistory: TransferProgress[] = [];
      const meter = new ByteMeter({
        jobId: 'throttle-job',
        fileName: 'throttle.bin',
        totalBytes: 5000,
        throttleIntervalMs: 150,
        onProgress: (p) => progressHistory.push({ ...p }),
      });

      const input = Readable.from(chunks);
      const output = new Writable({
        write(_chunk, _encoding, cb) {
          cb();
        },
      });

      await new Promise<void>((resolve, reject) => {
        input.pipe(meter).pipe(output);
        output.on('finish', () => resolve());
        output.on('error', reject);
      });

      // 50 chunks without throttle would be 50 calls; with 150ms throttle it should be significantly fewer (typically 1-5 calls)
      expect(progressHistory.length).toBeLessThan(20);
      expect(progressHistory[progressHistory.length - 1].status).toBe('completed');
    });
  });

  describe('Cancellation via AbortSignal', () => {
    it('should abort transfer when AbortSignal is triggered', async () => {
      const abortController = new AbortController();

      // Create a slow readable stream that yields asynchronously
      const slowReadable = new Readable({
        read() {
          setTimeout(() => {
            this.push(Buffer.alloc(1024, 'x'));
          }, 10);
        },
      });

      const memSource = new MemoryStorageProvider();
      memSource.createReadStream = vi.fn().mockResolvedValue(slowReadable);

      const memTarget = new MemoryStorageProvider();

      // Abort after a short tick
      setTimeout(() => {
        abortController.abort();
      }, 30);

      await expect(
        transferFile({
          sourceProvider: memSource,
          sourcePath: 'slow.bin',
          targetProvider: memTarget,
          targetPath: 'slow.bin',
          signal: abortController.signal,
        })
      ).rejects.toThrow();
    });

    it('should unblock and abort ByteMeter when aborted while paused', async () => {
      const pauseController = new PauseController();
      pauseController.pause();
      const abortController = new AbortController();

      const meter = new ByteMeter({
        pauseController,
        signal: abortController.signal,
      });

      const source = new PassThrough();
      const dest = new PassThrough();

      const pipelinePromise = new Promise<void>((resolve, reject) => {
        source.pipe(meter).pipe(dest);
        dest.on('finish', () => resolve());
        meter.on('error', reject);
      });

      source.write('chunk-while-paused');

      // Abort after a tick
      setTimeout(() => {
        abortController.abort();
      }, 20);

      await expect(pipelinePromise).rejects.toThrow();
    });
  });

  describe('Recursive directory transfer', () => {
    it('should recursively copy directory hierarchy and all nested files', async () => {
      // Setup source structure:
      // source/
      // ├── root.txt
      // ├── sub1/
      // │   └── file1.txt
      // └── sub2/
      //     ├── sub3/
      //     │   └── deep.txt
      //     └── file2.txt
      await fs.writeFile(path.join(sourceDir, 'root.txt'), 'root-content', 'utf-8');
      await fs.mkdir(path.join(sourceDir, 'sub1'), { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'sub1', 'file1.txt'), 'file1-content', 'utf-8');
      await fs.mkdir(path.join(sourceDir, 'sub2', 'sub3'), { recursive: true });
      await fs.writeFile(path.join(sourceDir, 'sub2', 'sub3', 'deep.txt'), 'deep-content', 'utf-8');
      await fs.writeFile(path.join(sourceDir, 'sub2', 'file2.txt'), 'file2-content', 'utf-8');

      const progressList: TransferProgress[] = [];

      await transferDirectory({
        sourceProvider: sourceLocal,
        sourcePath: '',
        targetProvider: targetLocal,
        targetPath: '',
        onProgress: (p) => progressList.push({ ...p }),
      });

      // Verify files in targetDir
      const rootText = await fs.readFile(path.join(targetDir, 'root.txt'), 'utf-8');
      const file1Text = await fs.readFile(path.join(targetDir, 'sub1', 'file1.txt'), 'utf-8');
      const deepText = await fs.readFile(path.join(targetDir, 'sub2', 'sub3', 'deep.txt'), 'utf-8');
      const file2Text = await fs.readFile(path.join(targetDir, 'sub2', 'file2.txt'), 'utf-8');

      expect(rootText).toBe('root-content');
      expect(file1Text).toBe('file1-content');
      expect(deepText).toBe('deep-content');
      expect(file2Text).toBe('file2-content');

      expect(progressList.length).toBeGreaterThan(0);
      const last = progressList[progressList.length - 1];
      expect(last.status).toBe('completed');
    });

    it('should create empty subdirectories in target', async () => {
      await fs.mkdir(path.join(sourceDir, 'empty-sub'), { recursive: true });

      await transferDirectory({
        sourceProvider: sourceLocal,
        sourcePath: '',
        targetProvider: targetLocal,
        targetPath: '',
      });

      const stat = await fs.stat(path.join(targetDir, 'empty-sub'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('should ignore . and .. entries preventing infinite recursion', async () => {
      const mockSource = new MemoryStorageProvider();
      mockSource.list = vi.fn().mockResolvedValue([
        { name: '.', path: '.', size: 0, isDirectory: true },
        { name: '..', path: '..', size: 0, isDirectory: true },
        { name: 'valid.txt', path: 'valid.txt', size: 4, isDirectory: false },
      ]);
      mockSource.files.set('valid.txt', Buffer.from('test'));

      const mockTarget = new MemoryStorageProvider();
      await transferDirectory({
        sourceProvider: mockSource,
        sourcePath: '',
        targetProvider: mockTarget,
        targetPath: '',
      });

      expect(mockTarget.files.has('valid.txt')).toBe(true);
      expect(mockTarget.folders.has('.')).toBe(false);
      expect(mockTarget.folders.has('..')).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should reject when source read stream fails', async () => {
      const memSource = new MemoryStorageProvider();
      memSource.readStreamError = new Error('Disk read fault');

      const memTarget = new MemoryStorageProvider();

      await expect(
        transferFile({
          sourceProvider: memSource,
          sourcePath: 'broken.txt',
          targetProvider: memTarget,
          targetPath: 'broken.txt',
        })
      ).rejects.toThrow('Disk read fault');
    });

    it('should reject when target write stream fails', async () => {
      const memSource = new MemoryStorageProvider();
      memSource.files.set('data.txt', Buffer.from('data'));

      const memTarget = new MemoryStorageProvider();
      memTarget.writeStreamError = new Error('Disk full write error');

      await expect(
        transferFile({
          sourceProvider: memSource,
          sourcePath: 'data.txt',
          targetProvider: memTarget,
          targetPath: 'data.txt',
        })
      ).rejects.toThrow('Disk full write error');
    });

    it('should destroy readStream when target createWriteStream throws', async () => {
      const memSource = new MemoryStorageProvider();
      memSource.files.set('data.txt', Buffer.from('data'));
      const readStream = await memSource.createReadStream('data.txt');
      const destroySpy = vi.spyOn(readStream as any, 'destroy');
      memSource.createReadStream = vi.fn().mockResolvedValue(readStream);

      const memTarget = new MemoryStorageProvider();
      memTarget.createWriteStream = vi.fn().mockRejectedValue(new Error('Target init failure'));

      await expect(
        transferFile({
          sourceProvider: memSource,
          sourcePath: 'data.txt',
          targetProvider: memTarget,
          targetPath: 'data.txt',
        })
      ).rejects.toThrow('Target init failure');

      expect(destroySpy).toHaveBeenCalled();
    });
  });
});

describe('TransferQueue', () => {
  let sourceProvider: MemoryStorageProvider;
  let targetProvider: MemoryStorageProvider;

  beforeEach(() => {
    sourceProvider = new MemoryStorageProvider('src-provider');
    targetProvider = new MemoryStorageProvider('dst-provider');
  });

  it('should initialize with default concurrency 3 and empty job list', () => {
    const queue = new TransferQueue();
    expect(queue.concurrency).toBe(3);
    expect(queue.getJobs()).toEqual([]);
  });

  it('should allow setting custom concurrency', () => {
    const queue = new TransferQueue({ concurrency: 5 });
    expect(queue.concurrency).toBe(5);

    queue.concurrency = 2;
    expect(queue.concurrency).toBe(2);
  });

  it('should add a job in pending status and run it to completion', async () => {
    sourceProvider.files.set('file1.txt', Buffer.from('content 1'));
    const queue = new TransferQueue();

    const job = queue.addJob({
      sourceProvider,
      sourcePath: 'file1.txt',
      targetProvider,
      targetPath: 'file1.txt',
    });

    expect(job.id).toBeDefined();
    expect(job.sourcePath).toBe('file1.txt');
    expect(queue.getJob(job.id)).toBe(job);

    await queue.waitForJob(job.id);

    expect(job.progress.status).toBe('completed');
    expect(targetProvider.files.get('file1.txt')?.toString()).toBe('content 1');
  });

  it('should reject duplicate job IDs in addJob', () => {
    const queue = new TransferQueue();
    queue.addJob({
      id: 'dup-1',
      sourceProvider,
      sourcePath: 'f.txt',
      targetProvider,
      targetPath: 'f.txt',
    });

    expect(() => {
      queue.addJob({
        id: 'dup-1',
        sourceProvider,
        sourcePath: 'f.txt',
        targetProvider,
        targetPath: 'f.txt',
      });
    }).toThrow('already exists');
  });

  it('should respect concurrency limit (run at most N concurrent jobs)', async () => {
    // Set concurrency to 2 and add 4 slow jobs
    const queue = new TransferQueue({ concurrency: 2 });
    let maxRunningAtOnce = 0;
    let currentlyRunning = 0;

    const createSlowStreamProvider = () => {
      const p = new MemoryStorageProvider();
      p.createReadStream = async () => {
        currentlyRunning++;
        if (currentlyRunning > maxRunningAtOnce) {
          maxRunningAtOnce = currentlyRunning;
        }
        const stream = new PassThrough();
        setTimeout(() => {
          stream.write('chunk');
          setTimeout(() => {
            currentlyRunning--;
            stream.end();
          }, 40);
        }, 10);
        return stream;
      };
      return p;
    };

    const slowSource = createSlowStreamProvider();

    const jobs: TransferJob[] = [];
    for (let i = 0; i < 4; i++) {
      jobs.push(
        queue.addJob({
          sourceProvider: slowSource,
          sourcePath: `slow${i}.txt`,
          targetProvider,
          targetPath: `slow${i}.txt`,
        })
      );
    }

    await queue.waitForAll();

    expect(maxRunningAtOnce).toBeLessThanOrEqual(2);
    for (const job of jobs) {
      expect(job.progress.status).toBe('completed');
    }
  });

  it('should pause and resume a pending job', async () => {
    sourceProvider.files.set('job-a.txt', Buffer.from('data-a'));
    sourceProvider.files.set('job-b.txt', Buffer.from('data-b'));

    // Concurrency 1 so job 2 is pending
    const queue = new TransferQueue({ concurrency: 1 });

    const job1 = queue.addJob({
      sourceProvider,
      sourcePath: 'job-a.txt',
      targetProvider,
      targetPath: 'job-a.txt',
    });

    const job2 = queue.addJob({
      sourceProvider,
      sourcePath: 'job-b.txt',
      targetProvider,
      targetPath: 'job-b.txt',
    });

    // Pause job2 while still pending
    queue.pauseJob(job2.id);
    expect(job2.progress.status).toBe('paused');

    await queue.waitForJob(job1.id);
    expect(job1.progress.status).toBe('completed');

    // job2 should still be paused, not running or completed
    expect(job2.progress.status).toBe('paused');

    // Resume job2
    queue.resumeJob(job2.id);
    expect(job2.progress.status).toBe('pending');

    await queue.waitForJob(job2.id);
    expect(job2.progress.status).toBe('completed');
  });

  it('should keep waitForAll waiting while jobs are paused', async () => {
    sourceProvider.files.set('pause-wait.txt', Buffer.from('data'));
    const queue = new TransferQueue({ concurrency: 1 });
    const job = queue.addJob({
      sourceProvider,
      sourcePath: 'pause-wait.txt',
      targetProvider,
      targetPath: 'pause-wait.txt',
    });
    queue.pauseJob(job.id);

    let finished = false;
    const waitPromise = queue.waitForAll().then(() => {
      finished = true;
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(finished).toBe(false);

    queue.resumeJob(job.id);
    await waitPromise;
    expect(finished).toBe(true);
    expect(job.progress.status).toBe('completed');
  });

  it('should pause and resume a running job', async () => {
    // Readable that emits 2 chunks with pause in between
    const pSource = new MemoryStorageProvider();
    pSource.createReadStream = async () => {
      const stream = new PassThrough();
      stream.write('chunk-1');
      return stream;
    };

    const queue = new TransferQueue({ concurrency: 1 });
    const job = queue.addJob({
      sourceProvider: pSource,
      sourcePath: 'streaming.bin',
      targetProvider,
      targetPath: 'streaming.bin',
    });

    // Let job start
    await new Promise((r) => setTimeout(r, 20));
    expect(job.progress.status).toBe('running');

    queue.pauseJob(job.id);
    expect(job.progress.status).toBe('paused');

    // Wait a bit to ensure it stays paused
    await new Promise((r) => setTimeout(r, 40));
    expect(job.progress.status).toBe('paused');

    queue.resumeJob(job.id);
    expect(job.progress.status).toBe('running');
  });

  it('should cancel a running job via cancelJob()', async () => {
    const slowSource = new MemoryStorageProvider();
    slowSource.createReadStream = async () => {
      const stream = new PassThrough();
      // never ends unless destroyed
      stream.write('chunk-data');
      return stream;
    };

    const queue = new TransferQueue();
    const job = queue.addJob({
      sourceProvider: slowSource,
      sourcePath: 'infinite.bin',
      targetProvider,
      targetPath: 'infinite.bin',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(job.progress.status).toBe('running');

    const cancelled = queue.cancelJob(job.id);
    expect(cancelled).toBe(true);
    expect(job.progress.status).toBe('cancelled');
  });

  it('should cancel a pending job before it starts', async () => {
    const queue = new TransferQueue({ concurrency: 0 }); // won't process anything

    const job = queue.addJob({
      sourceProvider,
      sourcePath: 'queued.txt',
      targetProvider,
      targetPath: 'queued.txt',
    });

    expect(job.progress.status).toBe('pending');
    queue.cancelJob(job.id);
    expect(job.progress.status).toBe('cancelled');
  });

  it('should clear completed jobs with clearCompleted()', async () => {
    sourceProvider.files.set('comp1.txt', Buffer.from('1'));
    sourceProvider.files.set('comp2.txt', Buffer.from('2'));

    const queue = new TransferQueue({ concurrency: 2 });
    queue.addJob({
      sourceProvider,
      sourcePath: 'comp1.txt',
      targetProvider,
      targetPath: 'comp1.txt',
    });
    queue.addJob({
      sourceProvider,
      sourcePath: 'comp2.txt',
      targetProvider,
      targetPath: 'comp2.txt',
    });

    await queue.waitForAll();
    expect(queue.getJobs().length).toBe(2);

    const cleared = queue.clearCompleted();
    expect(cleared.length).toBe(2);
    expect(queue.getJobs().length).toBe(0);
  });

  it('should emit progress and completed events on EventEmitter', async () => {
    sourceProvider.files.set('event.txt', Buffer.from('events testing'));
    const queue = new TransferQueue();

    const progressEvents: TransferProgress[] = [];
    const completedJobs: TransferJob[] = [];

    queue.on('progress', (p) => progressEvents.push({ ...p }));
    queue.on('completed', (j) => completedJobs.push(j));

    const job = queue.addJob({
      sourceProvider,
      sourcePath: 'event.txt',
      targetProvider,
      targetPath: 'event.txt',
    });

    await queue.waitForJob(job.id);

    expect(progressEvents.length).toBeGreaterThan(0);
    expect(completedJobs.length).toBe(1);
    expect(completedJobs[0].id).toBe(job.id);
  });

  it('should handle errors gracefully and mark job as failed without breaking the queue', async () => {
    const brokenSource = new MemoryStorageProvider();
    brokenSource.readStreamError = new Error('Disk unreadable');

    sourceProvider.files.set('valid.txt', Buffer.from('healthy'));

    const queue = new TransferQueue({ concurrency: 1 });
    const failedEvents: TransferJob[] = [];
    queue.on('failed', (job) => failedEvents.push(job));

    const failJob = queue.addJob({
      sourceProvider: brokenSource,
      sourcePath: 'bad.txt',
      targetProvider,
      targetPath: 'bad.txt',
    });

    const goodJob = queue.addJob({
      sourceProvider,
      sourcePath: 'valid.txt',
      targetProvider,
      targetPath: 'valid.txt',
    });

    await queue.waitForAll();

    expect(failJob.progress.status).toBe('failed');
    expect(failJob.error).toContain('Disk unreadable');
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].id).toBe(failJob.id);

    // Verify subsequent job still ran and succeeded!
    expect(goodJob.progress.status).toBe('completed');
    expect(targetProvider.files.get('valid.txt')?.toString()).toBe('healthy');
  });
});
