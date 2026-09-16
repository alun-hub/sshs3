import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import type { SFTPConfig } from '../../src/shared/types/storage';
import { formatDate } from '../../src/main/storage/StorageProvider';
import { SFTPStorageProvider } from '../../src/main/storage/SFTPStorageProvider';

// Mock state for ssh2-sftp-client using vi.hoisted
const {
  mockConnect,
  mockList,
  mockStat,
  mockMkdir,
  mockRmdir,
  mockDelete,
  mockRename,
  mockCreateReadStream,
  mockCreateWriteStream,
  mockEnd,
  getEventHandlers,
  resetEventHandlers,
} = vi.hoisted(() => {
  let handlers: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    mockConnect: vi.fn(),
    mockList: vi.fn(),
    mockStat: vi.fn(),
    mockMkdir: vi.fn(),
    mockRmdir: vi.fn(),
    mockDelete: vi.fn(),
    mockRename: vi.fn(),
    mockCreateReadStream: vi.fn(),
    mockCreateWriteStream: vi.fn(),
    mockEnd: vi.fn(),
    getEventHandlers: () => handlers,
    resetEventHandlers: () => {
      handlers = {};
    },
  };
});

function emitClientEvent(event: string, ...args: any[]) {
  const handlers = getEventHandlers()[event] || [];
  for (const handler of handlers) {
    handler(...args);
  }
}

vi.mock('ssh2-sftp-client', () => {
  class MockSftpClient {
    public connect = mockConnect;
    public list = mockList;
    public stat = mockStat;
    public mkdir = mockMkdir;
    public rmdir = mockRmdir;
    public delete = mockDelete;
    public rename = mockRename;
    public createReadStream = mockCreateReadStream;
    public createWriteStream = mockCreateWriteStream;
    public end = mockEnd;
    public on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      const handlers = getEventHandlers();
      if (!handlers[event]) {
        handlers[event] = [];
      }
      handlers[event].push(handler);
      return this;
    });
    public removeListener = vi.fn((event: string, handler: (...args: any[]) => void) => {
      const handlers = getEventHandlers();
      if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      }
      return this;
    });
  }

  return {
    default: MockSftpClient,
  };
});

describe('SFTPStorageProvider', () => {
  let tempDir: string;
  let testKeyPath: string;

  const baseConfig: SFTPConfig = {
    host: 'sftp.example.com',
    port: 2222,
    username: 'testuser',
    authType: 'password',
    password: 'secretpassword',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    resetEventHandlers();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(true);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sftp-test-'));
    testKeyPath = path.join(tempDir, 'id_rsa');
    await fs.writeFile(testKeyPath, 'FAKE_RSA_PRIVATE_KEY', 'utf8');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('initialization and metadata', () => {
    it('should initialize with default id and name when omitted', () => {
      const provider = new SFTPStorageProvider(baseConfig);
      expect(provider.type).toBe('sftp');
      expect(provider.id).toBe('testuser@sftp.example.com:2222');
      expect(provider.name).toBe('testuser@sftp.example.com');
    });

    it('should initialize with custom id and name when provided', () => {
      const provider = new SFTPStorageProvider({
        ...baseConfig,
        id: 'custom-sftp-id',
        name: 'My Remote SFTP',
      });
      expect(provider.type).toBe('sftp');
      expect(provider.id).toBe('custom-sftp-id');
      expect(provider.name).toBe('My Remote SFTP');
    });
  });

  describe('authentication types', () => {
    it('should connect with password authentication', async () => {
      const provider = new SFTPStorageProvider({
        ...baseConfig,
        authType: 'password',
        password: 'mypassword123',
      });

      await provider.ensureConnected();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'sftp.example.com',
          port: 2222,
          username: 'testuser',
          password: 'mypassword123',
        }),
      );
    });

    it('should connect with privateKey authentication reading key file', async () => {
      const provider = new SFTPStorageProvider({
        ...baseConfig,
        authType: 'privateKey',
        privateKeyPath: testKeyPath,
        passphrase: 'key-passphrase',
      });

      await provider.ensureConnected();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      const callArg = mockConnect.mock.calls[0][0];
      expect(callArg.host).toBe('sftp.example.com');
      expect(callArg.port).toBe(2222);
      expect(callArg.username).toBe('testuser');
      expect(callArg.privateKey).toBeDefined();
      expect(callArg.privateKey.toString()).toBe('FAKE_RSA_PRIVATE_KEY');
      expect(callArg.passphrase).toBe('key-passphrase');
    });

    it('should connect with agent authentication on Linux using process.env.SSH_AUTH_SOCK', async () => {
      const origPlatform = process.platform;
      const origSock = process.env.SSH_AUTH_SOCK;

      try {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        process.env.SSH_AUTH_SOCK = '/run/user/1000/keyring/ssh';

        const provider = new SFTPStorageProvider({
          ...baseConfig,
          authType: 'agent',
        });

        await provider.ensureConnected();

        expect(mockConnect).toHaveBeenCalledTimes(1);
        expect(mockConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'sftp.example.com',
            port: 2222,
            username: 'testuser',
            agent: '/run/user/1000/keyring/ssh',
          }),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        if (origSock !== undefined) {
          process.env.SSH_AUTH_SOCK = origSock;
        } else {
          delete process.env.SSH_AUTH_SOCK;
        }
      }
    });

    it('should connect with agent authentication on Windows using Pageant pipe when no path given', async () => {
      const origPlatform = process.platform;
      const origSock = process.env.SSH_AUTH_SOCK;

      try {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        delete process.env.SSH_AUTH_SOCK;

        const provider = new SFTPStorageProvider({
          ...baseConfig,
          authType: 'agent',
        });

        await provider.ensureConnected();

        expect(mockConnect).toHaveBeenCalledTimes(1);
        expect(mockConnect).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'sftp.example.com',
            port: 2222,
            username: 'testuser',
            agent: '\\\\.\\pipe\\pageant',
          }),
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform });
        if (origSock !== undefined) {
          process.env.SSH_AUTH_SOCK = origSock;
        } else {
          delete process.env.SSH_AUTH_SOCK;
        }
      }
    });

    it('should use custom agentPath if specified in config', async () => {
      const provider = new SFTPStorageProvider({
        ...baseConfig,
        authType: 'agent',
        agentPath: '/custom/ssh/agent.sock',
      });

      await provider.ensureConnected();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: '/custom/ssh/agent.sock',
        }),
      );
    });

    it('falls back to ssh-agent when authType is password but no password was configured', async () => {
      // e.g. a saved profile where the user relies on their own ssh-agent /
      // ~/.ssh/config for the real terminal session and just never filled in
      // a password - matches what the terminal's OpenSSH client already does.
      const origSock = process.env.SSH_AUTH_SOCK;
      process.env.SSH_AUTH_SOCK = '/run/user/1000/keyring/ssh';

      try {
        const provider = new SFTPStorageProvider({
          ...baseConfig,
          authType: 'password',
          password: undefined,
        });

        await provider.ensureConnected();

        expect(mockConnect).toHaveBeenCalledTimes(1);
        expect(mockConnect).toHaveBeenCalledWith(
          expect.objectContaining({ agent: '/run/user/1000/keyring/ssh' }),
        );
      } finally {
        if (origSock !== undefined) {
          process.env.SSH_AUTH_SOCK = origSock;
        } else {
          delete process.env.SSH_AUTH_SOCK;
        }
      }
    });

    it('falls back to a default identity file when no agent socket is available', async () => {
      const origSock = process.env.SSH_AUTH_SOCK;
      delete process.env.SSH_AUTH_SOCK;
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

      try {
        await fs.mkdir(path.join(tempDir, '.ssh'), { recursive: true });
        await fs.writeFile(path.join(tempDir, '.ssh', 'id_ed25519'), 'DEFAULT_ED25519_KEY', 'utf8');

        const provider = new SFTPStorageProvider({ ...baseConfig, authType: 'agent' });
        await provider.ensureConnected();

        expect(mockConnect).toHaveBeenCalledTimes(1);
        const callArg = mockConnect.mock.calls[0][0];
        expect(callArg.privateKey.toString()).toBe('DEFAULT_ED25519_KEY');
      } finally {
        homedirSpy.mockRestore();
        if (origSock !== undefined) {
          process.env.SSH_AUTH_SOCK = origSock;
        } else {
          delete process.env.SSH_AUTH_SOCK;
        }
      }
    });

    it('tries the next fallback candidate when the first one fails to authenticate', async () => {
      const origSock = process.env.SSH_AUTH_SOCK;
      process.env.SSH_AUTH_SOCK = '/run/user/1000/keyring/ssh';
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempDir);

      try {
        await fs.mkdir(path.join(tempDir, '.ssh'), { recursive: true });
        await fs.writeFile(path.join(tempDir, '.ssh', 'id_ed25519'), 'DEFAULT_ED25519_KEY', 'utf8');

        mockConnect
          .mockRejectedValueOnce(new Error('agent auth rejected'))
          .mockResolvedValueOnce(undefined);

        const provider = new SFTPStorageProvider({ ...baseConfig, authType: 'agent' });
        await provider.ensureConnected();

        expect(mockConnect).toHaveBeenCalledTimes(2);
        expect(mockConnect.mock.calls[0][0]).toEqual(
          expect.objectContaining({ agent: '/run/user/1000/keyring/ssh' }),
        );
        expect(mockConnect.mock.calls[1][0].privateKey.toString()).toBe('DEFAULT_ED25519_KEY');
      } finally {
        homedirSpy.mockRestore();
        if (origSock !== undefined) {
          process.env.SSH_AUTH_SOCK = origSock;
        } else {
          delete process.env.SSH_AUTH_SOCK;
        }
      }
    });

    it('should default port to 22 if not specified', async () => {
      const configWithoutPort = { ...baseConfig };
      delete (configWithoutPort as any).port;

      const provider = new SFTPStorageProvider(configWithoutPort);
      await provider.ensureConnected();

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 22,
        }),
      );
    });

    it('passes the provided hostVerifier through to the ssh2 connect options', async () => {
      const hostVerifier = vi.fn();
      const provider = new SFTPStorageProvider(baseConfig, undefined, hostVerifier);

      await provider.ensureConnected();

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ hostVerifier }),
      );
    });

    it('omits hostVerifier from connect options when none is provided', async () => {
      const provider = new SFTPStorageProvider(baseConfig);
      await provider.ensureConnected();

      const callArg = mockConnect.mock.calls[0][0];
      expect(callArg.hostVerifier).toBeUndefined();
    });
  });

  describe('automatic connection lifecycle', () => {
    it('should automatically connect on first operation if not already connected', async () => {
      mockList.mockResolvedValue([]);
      const provider = new SFTPStorageProvider(baseConfig);

      expect(mockConnect).not.toHaveBeenCalled();

      await provider.list('/home/testuser');

      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockList).toHaveBeenCalledTimes(1);
    });

    it('should reuse existing connection for subsequent operations without reconnecting', async () => {
      mockList.mockResolvedValue([]);
      mockStat.mockResolvedValue({
        mode: 0o644,
        size: 100,
        modifyTime: Date.now(),
        isDirectory: false,
      });

      const provider = new SFTPStorageProvider(baseConfig);

      await provider.list('/home/testuser');
      await provider.stat('/home/testuser/file.txt');

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('should deduplicate concurrent connection attempts', async () => {
      mockList.mockResolvedValue([]);
      const provider = new SFTPStorageProvider(baseConfig);

      await Promise.all([
        provider.list('/dir1'),
        provider.list('/dir2'),
        provider.ensureConnected(),
      ]);

      expect(mockConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('list(remotePath)', () => {
    it('should map directories (isDirectory: true) and files (isDirectory: false)', async () => {
      const date1 = new Date(2026, 8, 14, 10, 30);
      const date2 = new Date(2026, 8, 14, 11, 45);

      mockList.mockResolvedValue([
        {
          name: 'docs',
          type: 'd',
          size: 4096,
          modifyTime: date1.getTime(),
          rights: { user: 'rwx', group: 'rx', other: 'rx' },
        },
        {
          name: 'report.pdf',
          type: '-',
          size: 1048576,
          modifyTime: date2.getTime(),
          rights: { user: 'rw', group: 'r', other: 'r' },
        },
      ]);

      const provider = new SFTPStorageProvider(baseConfig);
      const entries = await provider.list('/remote/data');

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        name: 'docs',
        path: '/remote/data/docs',
        size: 4096,
        isDirectory: true,
        mtime: formatDate(date1),
        mimeType: undefined,
        permissions: '755',
      });
      expect(entries[1]).toEqual({
        name: 'report.pdf',
        path: '/remote/data/report.pdf',
        size: 1048576,
        isDirectory: false,
        mtime: formatDate(date2),
        mimeType: 'application/pdf',
        permissions: '644',
      });
    });

    it('should sort directories first, then files alphabetically', async () => {
      const now = Date.now();
      mockList.mockResolvedValue([
        { name: 'zebra.txt', type: '-', size: 10, modifyTime: now },
        { name: 'alpha.txt', type: '-', size: 20, modifyTime: now },
        { name: 'zoo', type: 'd', size: 4096, modifyTime: now },
        { name: 'admin', type: 'd', size: 4096, modifyTime: now },
        { name: 'middle.txt', type: '-', size: 30, modifyTime: now },
      ]);

      const provider = new SFTPStorageProvider(baseConfig);
      const entries = await provider.list('/folder');

      expect(entries.map((e) => e.name)).toEqual([
        'admin',
        'zoo',
        'alpha.txt',
        'middle.txt',
        'zebra.txt',
      ]);
      expect(entries.map((e) => e.isDirectory)).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
    });

    it('should format date with formatDate as yyyy-mm-dd HH:mm (24h)', async () => {
      const testDate = new Date('2026-09-14T20:45:00');
      mockList.mockResolvedValue([
        {
          name: 'notes.txt',
          type: '-',
          size: 500,
          modifyTime: testDate.getTime(),
        },
      ]);

      const provider = new SFTPStorageProvider(baseConfig);
      const [entry] = await provider.list('/notes');

      expect(entry.mtime).toBe(formatDate(testDate));
      expect(entry.mtime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('should extract permissions from octal mode, attrs.mode, or rights object', async () => {
      mockList.mockResolvedValue([
        {
          name: 'file1.txt',
          type: '-',
          size: 10,
          modifyTime: Date.now(),
          mode: 0o755,
        },
        {
          name: 'file2.txt',
          type: '-',
          size: 10,
          modifyTime: Date.now(),
          attrs: { mode: 0o600 },
        },
        {
          name: 'file3.txt',
          type: '-',
          size: 10,
          modifyTime: Date.now(),
          rights: { user: 'rw', group: 'r', other: '' },
        },
      ]);

      const provider = new SFTPStorageProvider(baseConfig);
      const entries = await provider.list('/files');

      expect(entries[0].permissions).toBe('755');
      expect(entries[1].permissions).toBe('600');
      expect(entries[2].permissions).toBe('640');
    });

    it('should correctly build root relative paths without double slashes', async () => {
      mockList.mockResolvedValue([
        {
          name: 'var',
          type: 'd',
          size: 4096,
          modifyTime: Date.now(),
        },
      ]);

      const provider = new SFTPStorageProvider(baseConfig);
      const entries = await provider.list('/');

      expect(entries[0].path).toBe('/var');
    });

    it('should extract mime type using getMimeType and omit mimeType for directories', async () => {
      mockList.mockResolvedValue([
        { name: 'photo.jpg', type: '-', size: 100, modifyTime: Date.now() },
        { name: 'script.sh', type: '-', size: 100, modifyTime: Date.now() },
        { name: 'subfolder', type: 'd', size: 4096, modifyTime: Date.now() },
        { name: 'unknown.xyz123', type: '-', size: 100, modifyTime: Date.now() },
      ]);

      const provider = new SFTPStorageProvider(baseConfig);
      const entries = await provider.list('/items');

      const photo = entries.find((e) => e.name === 'photo.jpg')!;
      const script = entries.find((e) => e.name === 'script.sh')!;
      const folder = entries.find((e) => e.name === 'subfolder')!;
      const unknown = entries.find((e) => e.name === 'unknown.xyz123')!;

      expect(photo.mimeType).toBe('image/jpeg');
      expect(script.mimeType).toBe('application/x-sh');
      expect(folder.mimeType).toBeUndefined();
      expect(unknown.mimeType).toBeUndefined();
    });
  });

  describe('stat(remotePath)', () => {
    it('should return FileEntry for a file with correct metadata and yyyy-mm-dd HH:mm date', async () => {
      const mtimeDate = new Date(2026, 8, 14, 18, 15);
      mockStat.mockResolvedValue({
        size: 54321,
        isDirectory: false,
        modifyTime: mtimeDate.getTime(),
        mode: 0o644,
      });

      const provider = new SFTPStorageProvider(baseConfig);
      const entry = await provider.stat('/data/file.txt');

      expect(mockStat).toHaveBeenCalledWith('/data/file.txt');
      expect(entry).toEqual({
        name: 'file.txt',
        path: '/data/file.txt',
        size: 54321,
        isDirectory: false,
        mtime: formatDate(mtimeDate),
        mimeType: 'text/plain',
        permissions: '644',
      });
      expect(entry.mtime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('should return FileEntry for a directory with mimeType undefined', async () => {
      const mtimeDate = new Date(2026, 8, 14, 12, 0);
      mockStat.mockResolvedValue({
        size: 4096,
        isDirectory: true,
        modifyTime: mtimeDate.getTime(),
        mode: 0o755,
      });

      const provider = new SFTPStorageProvider(baseConfig);
      const entry = await provider.stat('/var/log');

      expect(mockStat).toHaveBeenCalledWith('/var/log');
      expect(entry).toEqual({
        name: 'log',
        path: '/var/log',
        size: 4096,
        isDirectory: true,
        mtime: formatDate(mtimeDate),
        mimeType: undefined,
        permissions: '755',
      });
    });
  });

  describe('createFolder(remotePath)', () => {
    it('should call client.mkdir(remotePath, true) for recursive creation', async () => {
      mockMkdir.mockResolvedValue('/remote/path/newfolder');
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.createFolder('/remote/path/newfolder');

      expect(mockMkdir).toHaveBeenCalledTimes(1);
      expect(mockMkdir).toHaveBeenCalledWith('/remote/path/newfolder', true);
    });
  });

  describe('delete(remotePath, isDirectory)', () => {
    it('should call rmdir(remotePath, true) when isDirectory is true', async () => {
      mockRmdir.mockResolvedValue('Successfully removed directory');
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.delete('/remote/some-dir', true);

      expect(mockRmdir).toHaveBeenCalledTimes(1);
      expect(mockRmdir).toHaveBeenCalledWith('/remote/some-dir', true);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should call delete(remotePath) when isDirectory is false', async () => {
      mockDelete.mockResolvedValue('Successfully deleted file');
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.delete('/remote/some-file.txt', false);

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledWith('/remote/some-file.txt');
      expect(mockRmdir).not.toHaveBeenCalled();
    });

    it('should protect against deleting root directory /', async () => {
      const provider = new SFTPStorageProvider(baseConfig);

      await expect(provider.delete('/', true)).rejects.toThrow(
        /cannot delete root/i,
      );
      await expect(provider.delete('/', false)).rejects.toThrow(
        /cannot delete root/i,
      );
      await expect(provider.delete('//', true)).rejects.toThrow(
        /cannot delete root/i,
      );

      expect(mockRmdir).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should protect against deleting parent directory ..', async () => {
      const provider = new SFTPStorageProvider(baseConfig);

      await expect(provider.delete('..', true)).rejects.toThrow(
        /cannot delete root/i,
      );
      await expect(provider.delete('..', false)).rejects.toThrow(
        /cannot delete root/i,
      );

      expect(mockRmdir).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('rename(oldPath, newPath)', () => {
    it('should call client.rename(oldPath, newPath)', async () => {
      mockRename.mockResolvedValue('Successfully renamed');
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.rename('/remote/old.txt', '/remote/new.txt');

      expect(mockRename).toHaveBeenCalledTimes(1);
      expect(mockRename).toHaveBeenCalledWith('/remote/old.txt', '/remote/new.txt');
    });
  });

  describe('createReadStream(remotePath, start?, end?)', () => {
    it('should return a readable stream without range options', async () => {
      const mockStream = new Readable({ read() {} });
      mockCreateReadStream.mockReturnValue(mockStream);

      const provider = new SFTPStorageProvider(baseConfig);
      const stream = await provider.createReadStream('/remote/large.dat');

      expect(mockCreateReadStream).toHaveBeenCalledWith('/remote/large.dat');
      expect(stream).toBe(mockStream);
    });

    it('should pass start and end range options when specified', async () => {
      const mockStream = new Readable({ read() {} });
      mockCreateReadStream.mockReturnValue(mockStream);

      const provider = new SFTPStorageProvider(baseConfig);
      const stream = await provider.createReadStream('/remote/large.dat', 100, 500);

      expect(mockCreateReadStream).toHaveBeenCalledWith('/remote/large.dat', {
        start: 100,
        end: 500,
      });
      expect(stream).toBe(mockStream);
    });
  });

  describe('createWriteStream(remotePath, options?)', () => {
    it('should return a writable stream without options', async () => {
      const mockStream = new Writable({ write() {} });
      mockCreateWriteStream.mockReturnValue(mockStream);

      const provider = new SFTPStorageProvider(baseConfig);
      const stream = await provider.createWriteStream('/remote/upload.bin');

      expect(mockCreateWriteStream).toHaveBeenCalledWith('/remote/upload.bin');
      expect(stream).toBe(mockStream);
    });

    it('should pass options when provided', async () => {
      const mockStream = new Writable({ write() {} });
      mockCreateWriteStream.mockReturnValue(mockStream);

      const provider = new SFTPStorageProvider(baseConfig);
      const stream = await provider.createWriteStream('/remote/upload.bin', {
        size: 1024,
      });

      expect(mockCreateWriteStream).toHaveBeenCalledWith('/remote/upload.bin', {
        size: 1024,
      });
      expect(stream).toBe(mockStream);
    });
  });

  describe('disconnect()', () => {
    it('should close the SFTP client using end()', async () => {
      const provider = new SFTPStorageProvider(baseConfig);
      await provider.ensureConnected();

      await provider.disconnect();

      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it('should reconnect on next operation after disconnect', async () => {
      mockList.mockResolvedValue([]);
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.list('/first');
      expect(mockConnect).toHaveBeenCalledTimes(1);

      await provider.disconnect();
      expect(mockEnd).toHaveBeenCalledTimes(1);

      await provider.list('/second');
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('should await in-flight connection before closing client during disconnect', async () => {
      let resolveConnect: () => void;
      mockConnect.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
      );

      const provider = new SFTPStorageProvider(baseConfig);
      const connectPromise = provider.ensureConnected();

      const disconnectPromise = provider.disconnect();

      // Resolve in-flight connection
      resolveConnect!();

      await Promise.all([connectPromise, disconnectPromise]);

      expect(mockEnd).toHaveBeenCalledTimes(1);

      // Subsequent operation should reconnect
      mockList.mockResolvedValue([]);
      await provider.list('/after-disconnect');
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling and reconnection', () => {
    it('should reject when connect fails and allow subsequent connection attempt', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'));
      mockConnect.mockResolvedValueOnce(undefined);
      mockList.mockResolvedValue([]);

      const provider = new SFTPStorageProvider(baseConfig);

      await expect(provider.list('/test')).rejects.toThrow('Connection refused');
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Next call should retry connecting and succeed
      const entries = await provider.list('/test');
      expect(mockConnect).toHaveBeenCalledTimes(2);
      expect(entries).toEqual([]);
    });

    it('should reconnect if connection is closed via client close event', async () => {
      mockList.mockResolvedValue([]);
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.list('/dir1');
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Simulate connection close event from server
      emitClientEvent('close');

      await provider.list('/dir2');
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('should reconnect if connection is closed via client end event', async () => {
      mockList.mockResolvedValue([]);
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.list('/dir1');
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Simulate connection end event
      emitClientEvent('end');

      await provider.list('/dir2');
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('should mark disconnected on client error event', async () => {
      mockList.mockResolvedValue([]);
      const provider = new SFTPStorageProvider(baseConfig);

      await provider.list('/dir1');
      expect(mockConnect).toHaveBeenCalledTimes(1);

      // Simulate error event
      emitClientEvent('error', new Error('Network timeout'));

      await provider.list('/dir2');
      expect(mockConnect).toHaveBeenCalledTimes(2);
    });

    it('should retry connecting and succeed after synchronous privateKey read failure', async () => {
      const missingKeyPath = path.join(tempDir, 'non-existent-key');
      const keyConfig: SFTPConfig = {
        ...baseConfig,
        authType: 'privateKey',
        privateKeyPath: missingKeyPath,
      };
      mockList.mockResolvedValue([]);

      const provider = new SFTPStorageProvider(keyConfig);

      // First call: synchronous readFileSync throws ENOENT
      await expect(provider.list('/test')).rejects.toThrow(/ENOENT/);

      // Fix key path for retry
      await fs.writeFile(missingKeyPath, 'VALID_KEY', 'utf8');

      // Second call should retry connection without promise lockup
      const entries = await provider.list('/test');
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(entries).toEqual([]);
    });
  });
});
