import { describe, it, expect, vi } from 'vitest';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { SftpWriteStream } from '../../src/main/storage/sftp/SftpStreams';

function makeProtocol() {
  const handle = Buffer.from('h1');
  return {
    open: vi.fn().mockResolvedValue(handle),
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
