import fs from 'node:fs';
import path from 'node:path';
import type { LogSink } from './Logger';

export interface FileSinkOptions {
  dir: string;
  fileName?: string;
  maxBytes?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;

/**
 * Appends lines to `<dir>/sshs3.log` (dir 0700, files 0600) and rotates to
 * `.1` … `.N` once the size limit is reached. Writes are chained so lines
 * stay ordered; `flush()` lets quit wait for the queue to drain.
 */
export class FileSink implements LogSink {
  private readonly file: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly dir: string;
  private size = 0;
  private queue: Promise<void> = Promise.resolve();
  private ready = false;

  constructor(options: FileSinkOptions) {
    this.dir = options.dir;
    this.file = path.join(options.dir, options.fileName ?? 'sshs3.log');
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
  }

  public get directory(): string {
    return this.dir;
  }

  public write(line: string): void {
    const data = `${line}\n`;
    this.queue = this.queue.then(() => this.append(data)).catch(() => {});
  }

  public flush(): Promise<void> {
    return this.queue;
  }

  private async append(data: string): Promise<void> {
    if (!this.ready) {
      await fs.promises.mkdir(this.dir, { recursive: true, mode: 0o700 });
      await fs.promises.chmod(this.dir, 0o700).catch(() => {});
      this.size = await fs.promises.stat(this.file).then((s) => s.size, () => 0);
      this.ready = true;
    }
    if (this.size + data.length > this.maxBytes) await this.rotate();
    await fs.promises.appendFile(this.file, data, { mode: 0o600 });
    this.size += data.length;
  }

  private async rotate(): Promise<void> {
    await fs.promises.rm(`${this.file}.${this.maxFiles - 1}`, { force: true });
    for (let i = this.maxFiles - 2; i >= 1; i--) {
      await fs.promises.rename(`${this.file}.${i}`, `${this.file}.${i + 1}`).catch(() => {});
    }
    if (this.maxFiles > 1) await fs.promises.rename(this.file, `${this.file}.1`).catch(() => {});
    else await fs.promises.rm(this.file, { force: true });
    this.size = 0;
  }

  /** The most recent `maxLines` lines of the current log file (already masked when written). */
  public async tail(maxLines: number): Promise<string[]> {
    await this.flush();
    try {
      const text = await fs.promises.readFile(this.file, 'utf8');
      return text.split('\n').filter(Boolean).slice(-maxLines);
    } catch {
      return [];
    }
  }
}
