import { describe, it, expect, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { SftpPacketProtocol, SftpError } from '../../src/main/storage/sftp/SftpPacketProtocol';
import { SftpReadStream } from '../../src/main/storage/sftp/SftpStreams';
import { FXP, FX_STATUS, ATTR } from '../../src/main/storage/sftp/SftpConstants';

describe('SftpPacketProtocol', () => {
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let protocol: SftpPacketProtocol;

  beforeEach(() => {
    clientIn = new PassThrough();
    clientOut = new PassThrough();
    protocol = new SftpPacketProtocol(clientIn, clientOut);
  });

  it('closes and stops buffering after an oversized packet length', () => {
    const errors: Error[] = [];
    protocol.on('error', (e: Error) => errors.push(e));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(17 * 1024 * 1024, 0);
    clientIn.write(header);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/exceeds safe maximum/);
    expect(clientIn.destroyed).toBe(true);
    expect((protocol as unknown as { incomingBuffer: Buffer }).incomingBuffer.length).toBe(0);
    // Later data is ignored instead of re-triggering the error or growing the buffer.
    (protocol as unknown as { onData: (c: Buffer) => void }).onData(Buffer.alloc(1024));
    expect((protocol as unknown as { incomingBuffer: Buffer }).incomingBuffer.length).toBe(0);
    expect(errors).toHaveLength(1);
  });

  it('performs init handshake and receives version packet', async () => {
    // Listen for client init packet
    const clientPromise = protocol.init();

    clientOut.once('data', (data: Buffer) => {
      expect(data.readUInt32BE(0)).toBe(5); // len
      expect(data.readUInt8(4)).toBe(FXP.INIT); // type
      expect(data.readUInt32BE(5)).toBe(3); // version

      // Send mock server VERSION packet
      const resp = Buffer.alloc(9);
      resp.writeUInt32BE(5, 0);
      resp.writeUInt8(FXP.VERSION, 4);
      resp.writeUInt32BE(3, 5);
      clientIn.write(resp);
    });

    const version = await clientPromise;
    expect(version).toBe(3);
  });

  it('opens a file, reads data, and closes handle', async () => {
    // 1. OPEN
    const openPromise = protocol.open('/tmp/test.txt', 1);

    clientOut.once('data', (data: Buffer) => {
      const type = data.readUInt8(4);
      const reqId = data.readUInt32BE(5);
      expect(type).toBe(FXP.OPEN);

      // Respond with HANDLE
      const handle = Buffer.from('h123');
      const resp = Buffer.alloc(4 + 1 + 4 + 4 + handle.length);
      resp.writeUInt32BE(1 + 4 + 4 + handle.length, 0);
      resp.writeUInt8(FXP.HANDLE, 4);
      resp.writeUInt32BE(reqId, 5);
      resp.writeUInt32BE(handle.length, 9);
      handle.copy(resp, 13);
      clientIn.write(resp);
    });

    const handle = await openPromise;
    expect(handle.toString()).toBe('h123');

    // 2. READ
    const readPromise = protocol.read(handle, 0, 10);
    clientOut.once('data', (data: Buffer) => {
      const type = data.readUInt8(4);
      const reqId = data.readUInt32BE(5);
      expect(type).toBe(FXP.READ);

      // Respond with DATA
      const content = Buffer.from('hello world');
      const resp = Buffer.alloc(4 + 1 + 4 + 4 + content.length);
      resp.writeUInt32BE(1 + 4 + 4 + content.length, 0);
      resp.writeUInt8(FXP.DATA, 4);
      resp.writeUInt32BE(reqId, 5);
      resp.writeUInt32BE(content.length, 9);
      content.copy(resp, 13);
      clientIn.write(resp);
    });

    const data = await readPromise;
    expect(data?.toString()).toBe('hello world');

    // 3. READ returns null on EOF status
    const eofPromise = protocol.read(handle, 11, 10);
    clientOut.once('data', (buf: Buffer) => {
      const reqId = buf.readUInt32BE(5);
      const resp = Buffer.alloc(4 + 1 + 4 + 4 + 4);
      resp.writeUInt32BE(1 + 4 + 4 + 4, 0);
      resp.writeUInt8(FXP.STATUS, 4);
      resp.writeUInt32BE(reqId, 5);
      resp.writeUInt32BE(FX_STATUS.EOF, 9);
      resp.writeUInt32BE(0, 13);
      clientIn.write(resp);
    });

    const eofData = await eofPromise;
    expect(eofData).toBeNull();

    // 4. CLOSE
    const closePromise = protocol.close(handle);
    clientOut.once('data', (buf: Buffer) => {
      const reqId = buf.readUInt32BE(5);
      const resp = Buffer.alloc(4 + 1 + 4 + 4 + 4);
      resp.writeUInt32BE(1 + 4 + 4 + 4, 0);
      resp.writeUInt8(FXP.STATUS, 4);
      resp.writeUInt32BE(reqId, 5);
      resp.writeUInt32BE(FX_STATUS.OK, 9);
      resp.writeUInt32BE(0, 13);
      clientIn.write(resp);
    });

    await expect(closePromise).resolves.toBeUndefined();
  });

  it('rejects on SFTP error status with SftpError', async () => {
    const statPromise = protocol.stat('/nonexistent');

    clientOut.once('data', (buf: Buffer) => {
      const reqId = buf.readUInt32BE(5);
      const msg = Buffer.from('File not found');
      const resp = Buffer.alloc(4 + 1 + 4 + 4 + 4 + msg.length);
      resp.writeUInt32BE(1 + 4 + 4 + 4 + msg.length, 0);
      resp.writeUInt8(FXP.STATUS, 4);
      resp.writeUInt32BE(reqId, 5);
      resp.writeUInt32BE(FX_STATUS.NO_SUCH_FILE, 9);
      resp.writeUInt32BE(msg.length, 13);
      msg.copy(resp, 17);
      clientIn.write(resp);
    });

    await expect(statPromise).rejects.toThrow(SftpError);
    await expect(statPromise).rejects.toMatchObject({
      statusCode: FX_STATUS.NO_SUCH_FILE,
      message: 'File not found',
    });
  });

  it('correctly parses directory entries via opendir and readdir', async () => {
    const opendirPromise = protocol.opendir('/var/log');
    clientOut.once('data', (data: Buffer) => {
      const reqId = data.readUInt32BE(5);
      const handle = Buffer.from('dirhandle');
      const resp = Buffer.alloc(4 + 1 + 4 + 4 + handle.length);
      resp.writeUInt32BE(1 + 4 + 4 + handle.length, 0);
      resp.writeUInt8(FXP.HANDLE, 4);
      resp.writeUInt32BE(reqId, 5);
      resp.writeUInt32BE(handle.length, 9);
      handle.copy(resp, 13);
      clientIn.write(resp);
    });

    const handle = await opendirPromise;

    // READDIR returning entries
    const readdirPromise = protocol.readdir(handle);
    clientOut.once('data', (data: Buffer) => {
      const reqId = data.readUInt32BE(5);

      const fn = Buffer.from('syslog');
      const ln = Buffer.from('-rw-r--r-- 1 root root 1024 Jan 1 syslog');
      const attrFlags = ATTR.SIZE | ATTR.PERMISSIONS | ATTR.ACMODTIME;

      const entryLen = 4 + fn.length + 4 + ln.length + 4 + 8 + 4 + 8;
      const resp = Buffer.alloc(4 + 1 + 4 + 4 + entryLen);
      resp.writeUInt32BE(1 + 4 + 4 + entryLen, 0);
      resp.writeUInt8(FXP.NAME, 4);
      resp.writeUInt32BE(reqId, 5);
      resp.writeUInt32BE(1, 9); // count = 1

      let o = 13;
      resp.writeUInt32BE(fn.length, o);
      o += 4;
      fn.copy(resp, o);
      o += fn.length;

      resp.writeUInt32BE(ln.length, o);
      o += 4;
      ln.copy(resp, o);
      o += ln.length;

      resp.writeUInt32BE(attrFlags, o);
      o += 4;
      resp.writeBigUInt64BE(1024n, o);
      o += 8;
      resp.writeUInt32BE(0o100644, o); // regular file mode
      o += 4;
      resp.writeUInt32BE(1700000000, o); // atime
      o += 4;
      resp.writeUInt32BE(1700000000, o); // mtime

      clientIn.write(resp);
    });

    const entries = await readdirPromise;
    expect(entries).toHaveLength(1);
    expect(entries![0].filename).toBe('syslog');
    expect(entries![0].attrs.size).toBe(1024);
    expect(entries![0].attrs.isDirectory).toBe(false);
  });
});

describe('SftpStreams', () => {
  let clientIn: PassThrough;
  let clientOut: PassThrough;
  let protocol: SftpPacketProtocol;

  beforeEach(() => {
    clientIn = new PassThrough();
    clientOut = new PassThrough();
    protocol = new SftpPacketProtocol(clientIn, clientOut);
  });

  it('reads data chunk via SftpReadStream', async () => {
    const stream = new SftpReadStream(protocol, '/tmp/read.txt');

    // Auto-respond to OPEN
    clientOut.on('data', (buf: Buffer) => {
      const type = buf.readUInt8(4);
      const reqId = buf.readUInt32BE(5);
      if (type === FXP.OPEN) {
        const h = Buffer.from('h1');
        const resp = Buffer.alloc(4 + 1 + 4 + 4 + h.length);
        resp.writeUInt32BE(1 + 4 + 4 + h.length, 0);
        resp.writeUInt8(FXP.HANDLE, 4);
        resp.writeUInt32BE(reqId, 5);
        resp.writeUInt32BE(h.length, 9);
        h.copy(resp, 13);
        clientIn.write(resp);
      } else if (type === FXP.READ) {
        const offset = Number(buf.readBigUInt64BE(15));
        if (offset === 0) {
          const content = Buffer.from('StreamContent');
          const resp = Buffer.alloc(4 + 1 + 4 + 4 + content.length);
          resp.writeUInt32BE(1 + 4 + 4 + content.length, 0);
          resp.writeUInt8(FXP.DATA, 4);
          resp.writeUInt32BE(reqId, 5);
          resp.writeUInt32BE(content.length, 9);
          content.copy(resp, 13);
          clientIn.write(resp);
        } else {
          // EOF
          const resp = Buffer.alloc(4 + 1 + 4 + 4 + 4);
          resp.writeUInt32BE(1 + 4 + 4 + 4, 0);
          resp.writeUInt8(FXP.STATUS, 4);
          resp.writeUInt32BE(reqId, 5);
          resp.writeUInt32BE(FX_STATUS.EOF, 9);
          resp.writeUInt32BE(0, 13);
          clientIn.write(resp);
        }
      } else if (type === FXP.CLOSE) {
        const resp = Buffer.alloc(4 + 1 + 4 + 4 + 4);
        resp.writeUInt32BE(1 + 4 + 4 + 4, 0);
        resp.writeUInt8(FXP.STATUS, 4);
        resp.writeUInt32BE(reqId, 5);
        resp.writeUInt32BE(FX_STATUS.OK, 9);
        resp.writeUInt32BE(0, 13);
        clientIn.write(resp);
      }
    });

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(Buffer.concat(chunks).toString()).toBe('StreamContent');
  });
});
