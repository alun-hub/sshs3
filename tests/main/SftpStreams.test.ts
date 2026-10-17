import { describe, it, expect, vi } from 'vitest';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { SftpReadStream, SftpWriteStream } from '../../src/main/storage/sftp/SftpStreams';

function makeProtocol() {
  const handle = Buffer.from('h1');
  return {
    open: vi.fn().mockResolvedValue(handle),
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SftpWriteStream', () => {
  it('creates the target file for a zero-byte stream', async () => {
    const protocol = makeProtocol();
    await pipeline(Readable.from([]), new SftpWriteStream(protocol as any, '/remote/empty.txt'));

    expect(protocol.open).toHaveBeenCalledTimes(1);
    expect(protocol.open.mock.calls[0][0]).toBe('/remote/empty.txt');
    expect(protocol.write).not.toHaveBeenCalled();
    expect(protocol.close).toHaveBeenCalledTimes(1);
  });

  it('opens only once when data is written', async () => {
    const protocol = makeProtocol();
    await pipeline(Readable.from([Buffer.from('abc')]), new SftpWriteStream(protocol as any, '/remote/a.txt'));

    expect(protocol.open).toHaveBeenCalledTimes(1);
    expect(protocol.write).toHaveBeenCalledTimes(1);
    expect(protocol.close).toHaveBeenCalledTimes(1);
  });

  it('propagates an open failure for a zero-byte stream', async () => {
    const protocol = makeProtocol();
    protocol.open.mockRejectedValue(new Error('permission denied'));

    await expect(
      pipeline(Readable.from([]), new SftpWriteStream(protocol as any, '/remote/empty.txt'))
    ).rejects.toThrow('permission denied');
  });
});

describe('SftpReadStream', () => {
  it('reads multi-chunk binary data until EOF without stalling', async () => {
    const protocol = makeProtocol();
    const chunk1 = Buffer.alloc(64 * 1024, 0xaa);
    const chunk2 = Buffer.alloc(64 * 1024, 0xbb);
    const chunk3 = Buffer.alloc(10 * 1024, 0xcc);

    protocol.read
      .mockResolvedValueOnce(chunk1)
      .mockResolvedValueOnce(chunk2)
      .mockResolvedValueOnce(chunk3)
      .mockResolvedValueOnce(Buffer.alloc(0)); // EOF

    const readStream = new SftpReadStream(protocol as any, '/remote/large.png', { chunkSize: 64 * 1024 });
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      readStream.on('data', (c) => chunks.push(c));
      readStream.on('end', () => resolve());
      readStream.on('error', (e) => reject(e));
    });

    const full = Buffer.concat(chunks);
    expect(full.length).toBe(chunk1.length + chunk2.length + chunk3.length);
    expect(protocol.open).toHaveBeenCalledTimes(1);
    expect(protocol.read).toHaveBeenCalledTimes(4);
    expect(protocol.close).toHaveBeenCalledTimes(1);
  });

  it('handles consumer pause and resume backpressure without stalling', async () => {
    const protocol = makeProtocol();
    const chunk1 = Buffer.alloc(64 * 1024, 0x11);
    const chunk2 = Buffer.alloc(64 * 1024, 0x22);

    protocol.read
      .mockResolvedValueOnce(chunk1)
      .mockResolvedValueOnce(chunk2)
      .mockResolvedValueOnce(Buffer.alloc(0)); // EOF

    const readStream = new SftpReadStream(protocol as any, '/remote/img.png', { chunkSize: 64 * 1024 });
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      readStream.on('data', (c) => {
        chunks.push(c);
        readStream.pause();
        setTimeout(() => readStream.resume(), 5);
      });
      readStream.on('end', () => resolve());
      readStream.on('error', (e) => reject(e));
    });

    const full = Buffer.concat(chunks);
    expect(full.length).toBe(chunk1.length + chunk2.length);
  });
});
