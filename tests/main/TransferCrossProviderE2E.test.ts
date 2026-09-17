import { describe, it, expect, beforeEach } from 'vitest';
import { Readable, Writable } from 'node:stream';
import {
  transferFile,
  transferDirectory,
  PauseController,
} from '../../src/main/transfer/TransferPipeline';
import type {
  FileEntry,
  IStorageProvider,
  StorageType,
  TransferProgress,
  WriteStreamOptions,
} from '../../src/shared/types/storage';

/**
 * Mock provider simulating SFTP or S3 semantics in-memory.
 */
class MockStorageProvider implements IStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType;
  public files = new Map<string, Buffer>();
  public folders = new Set<string>();
  public disconnected = false;

  constructor(id: string, name: string, type: StorageType) {
    this.id = id;
    this.name = name;
    this.type = type;
  }

  async connect(): Promise<void> {
    this.disconnected = false;
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }

  isConnected(): boolean {
    return !this.disconnected;
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
        name: remotePath.split('/').pop() || '',
        path: remotePath,
        size: 0,
        isDirectory: true,
      };
    }
    const content = this.files.get(remotePath);
    if (content !== undefined) {
      return {
        name: remotePath.split('/').pop() || '',
        path: remotePath,
        size: content.length,
        isDirectory: false,
      };
    }
    throw new Error(`Path not found: ${remotePath}`);
  }

  async createReadStream(remotePath: string): Promise<Readable> {
    const content = this.files.get(remotePath);
    if (!content) {
      throw new Error(`File not found: ${remotePath}`);
    }

    // Emit in small chunks to simulate network streaming
    let offset = 0;
    const chunkSize = 1024;
    return new Readable({
      read() {
        if (offset >= content.length) {
          this.push(null);
        } else {
          const end = Math.min(offset + chunkSize, content.length);
          const chunk = content.subarray(offset, end);
          offset = end;
          this.push(chunk);
        }
      },
    });
  }

  async createWriteStream(remotePath: string, _options?: WriteStreamOptions): Promise<Writable> {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });

    writable.on('finish', () => {
      this.files.set(remotePath, Buffer.concat(chunks));
    });

    return writable;
  }

  async createFolder(remotePath: string): Promise<void> {
    this.folders.add(remotePath);
  }

  async delete(remotePath: string): Promise<void> {
    this.files.delete(remotePath);
    this.folders.delete(remotePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = this.files.get(oldPath);
    if (content !== undefined) {
      this.files.set(newPath, content);
      this.files.delete(oldPath);
    }
  }
}

describe('End-to-End Cross-Provider Transfer Pipeline (SFTP <-> S3)', () => {
  let sftpProvider: MockStorageProvider;
  let s3Provider: MockStorageProvider;

  beforeEach(() => {
    sftpProvider = new MockStorageProvider('sftp-1', 'Prod SFTP', 'sftp');
    s3Provider = new MockStorageProvider('s3-1', 'Data Lake S3', 's3');
  });

  it('streams file from SFTP to S3 with byte accuracy and progress updates', async () => {
    const payload = Buffer.alloc(64 * 1024, 'A'); // 64 KB
    sftpProvider.files.set('/remote/uploads/archive.bin', payload);

    const progressReports: TransferProgress[] = [];
    await transferFile({
      sourceProvider: sftpProvider,
      sourcePath: '/remote/uploads/archive.bin',
      targetProvider: s3Provider,
      targetPath: 's3://data-lake/backups/archive.bin',
      onProgress: (progress) => progressReports.push({ ...progress }),
    });

    expect(s3Provider.files.has('s3://data-lake/backups/archive.bin')).toBe(true);
    expect(s3Provider.files.get('s3://data-lake/backups/archive.bin')!).toEqual(payload);
    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[progressReports.length - 1].transferredBytes).toBe(payload.length);
  });

  it('supports pause and resume mid-stream during cross-provider transfer', async () => {
    const payload = Buffer.alloc(128 * 1024, 'X'); // 128 KB
    sftpProvider.files.set('/large-file.dat', payload);

    const pauseController = new PauseController();
    let pauseTriggered = false;
    let pauseObserved = false;

    await transferFile({
      sourceProvider: sftpProvider,
      sourcePath: '/large-file.dat',
      targetProvider: s3Provider,
      targetPath: 's3://bucket/large-file.dat',
      pauseController,
      onProgress: (progress) => {
        if (!pauseTriggered && progress.transferredBytes >= 32 * 1024) {
          pauseTriggered = true;
          pauseController.pause();
          pauseObserved = pauseController.isPaused;
          // Resume after a short delay
          setTimeout(() => {
            pauseController.resume();
          }, 30);
        }
      },
    });

    expect(pauseObserved).toBe(true);
    expect(s3Provider.files.get('s3://bucket/large-file.dat')).toEqual(payload);
  });

  it('recursively transfers directory hierarchies between SFTP and S3', async () => {
    // Populate nested SFTP directory structure
    sftpProvider.folders.add('/var/log/app');
    sftpProvider.folders.add('/var/log/app/archived');
    sftpProvider.files.set('/var/log/app/current.log', Buffer.from('current-log-data'));
    sftpProvider.files.set('/var/log/app/archived/2026-01.log', Buffer.from('archive-jan-data'));
    sftpProvider.files.set('/var/log/app/archived/2026-02.log', Buffer.from('archive-feb-data'));

    const progressReports: TransferProgress[] = [];
    await transferDirectory({
      sourceProvider: sftpProvider,
      sourcePath: '/var/log/app',
      targetProvider: s3Provider,
      targetPath: 's3://logs-archive/var/log/app',
      onProgress: (p) => progressReports.push({ ...p }),
    });

    expect(s3Provider.files.has('s3://logs-archive/var/log/app/current.log')).toBe(true);
    expect(s3Provider.files.has('s3://logs-archive/var/log/app/archived/2026-01.log')).toBe(true);
    expect(s3Provider.files.has('s3://logs-archive/var/log/app/archived/2026-02.log')).toBe(true);
  });

  it('aborts transfer cleanly when signal is aborted', async () => {
    const payload = Buffer.alloc(100 * 1024, 'Z');
    sftpProvider.files.set('/abort-me.bin', payload);

    const controller = new AbortController();
    await expect(
      transferFile({
        sourceProvider: sftpProvider,
        sourcePath: '/abort-me.bin',
        targetProvider: s3Provider,
        targetPath: 's3://bucket/abort-me.bin',
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.transferredBytes > 1024) {
            controller.abort();
          }
        },
      })
    ).rejects.toThrow();
  });
});
