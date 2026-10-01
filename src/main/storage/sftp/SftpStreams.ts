import { Readable, Writable } from 'node:stream';
import { FXF } from './SftpConstants';
import type { SftpPacketProtocol } from './SftpPacketProtocol';

export interface SftpReadStreamOptions {
  start?: number;
  end?: number;
  chunkSize?: number;
  autoClose?: boolean;
}

export class SftpReadStream extends Readable {
  private handle: Buffer | null = null;
  private currentOffset = 0;
  private endOffset: number | null = null;
  private chunkSize: number;
  private isOpening = false;
  private isClosed = false;

  constructor(
    private protocol: SftpPacketProtocol,
    private remotePath: string,
    options?: SftpReadStreamOptions
  ) {
    super();
    this.currentOffset = options?.start ?? 0;
    this.endOffset = typeof options?.end === 'number' ? options.end : null;
    this.chunkSize = options?.chunkSize ?? 64 * 1024;
  }

  public override _read(size: number): void {
    if (this.isClosed) return;

    void (async () => {
      try {
        if (!this.handle) {
          if (this.isOpening) return;
          this.isOpening = true;
          this.handle = await this.protocol.open(this.remotePath, FXF.READ);
          this.isOpening = false;
          if (this.isClosed) {
            await this.closeHandle();
            return;
          }
        }

        let bytesToRead = Math.max(size, this.chunkSize);
        if (this.endOffset !== null) {
          const remaining = this.endOffset - this.currentOffset + 1;
          if (remaining <= 0) {
            this.push(null);
            return;
          }
          bytesToRead = Math.min(bytesToRead, remaining);
        }

        const data = await this.protocol.read(this.handle, this.currentOffset, bytesToRead);
        if (data === null || data.length === 0) {
          this.push(null);
          return;
        }

        this.currentOffset += data.length;
        if (!this.push(data)) {
          // Downstream backpressure - pause reading until next _read
          return;
        }
      } catch (err: any) {
        this.destroy(err);
      }
    })();
  }

  private async closeHandle(): Promise<void> {
    if (this.handle) {
      const h = this.handle;
      this.handle = null;
      try {
        await this.protocol.close(h);
      } catch {
        // Ignore errors on close during teardown
      }
    }
  }

  public override _destroy(err: Error | null, callback: (err?: Error | null) => void): void {
    this.isClosed = true;
    void this.closeHandle().then(() => callback(err));
  }
}

export interface SftpWriteStreamOptions {
  mode?: number;
  flags?: string; // 'w', 'a', etc.
  autoClose?: boolean;
}

export class SftpWriteStream extends Writable {
  private handle: Buffer | null = null;
  private currentOffset = 0;
  private isOpening = false;
  private isClosed = false;
  private openFlags: number;

  constructor(
    private protocol: SftpPacketProtocol,
    private remotePath: string,
    private options?: SftpWriteStreamOptions
  ) {
    super();
    const isAppend = options?.flags === 'a' || options?.flags === 'a+';
    this.openFlags = isAppend
      ? FXF.WRITE | FXF.CREAT | FXF.APPEND
      : FXF.WRITE | FXF.CREAT | FXF.TRUNC;
  }

  public override _write(
    chunk: any,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    if (this.isClosed) {
      callback(new Error('Stream is closed'));
      return;
    }

    void (async () => {
      try {
        if (!this.handle) {
          if (this.isOpening) {
            callback(new Error('Concurrent write during open'));
            return;
          }
          this.isOpening = true;
          this.handle = await this.protocol.open(this.remotePath, this.openFlags, {
            mode: this.options?.mode,
          });
          this.isOpening = false;
        }

        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        await this.protocol.write(this.handle, this.currentOffset, buf);
        this.currentOffset += buf.length;
        callback();
      } catch (err: any) {
        callback(err);
      }
    })();
  }

  private async closeHandle(): Promise<void> {
    if (this.handle) {
      const h = this.handle;
      this.handle = null;
      try {
        await this.protocol.close(h);
      } catch {
        // Ignore close errors
      }
    }
  }

  public override _final(callback: (error?: Error | null) => void): void {
    void this.closeHandle().then(() => callback());
  }

  public override _destroy(err: Error | null, callback: (err?: Error | null) => void): void {
    this.isClosed = true;
    void this.closeHandle().then(() => callback(err));
  }
}
