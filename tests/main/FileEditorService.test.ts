import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable, Writable, PassThrough } from 'node:stream';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileEditorService } from '../../src/main/editor/FileEditorService';
import { StorageRegistry } from '../../src/main/storage/StorageRegistry';
import { LocalStorageProvider } from '../../src/main/storage/LocalStorageProvider';

describe('FileEditorService', () => {
  let tempBaseDir: string;
  let mockShell: any;
  let service: FileEditorService;
  let storageRegistry: StorageRegistry;

  beforeEach(async () => {
    tempBaseDir = path.join(os.tmpdir(), `fe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fsp.mkdir(tempBaseDir, { recursive: true });

    mockShell = {
      openPath: vi.fn().mockResolvedValue(''),
    };

    service = new FileEditorService({
      shell: mockShell,
      baseTempDir: tempBaseDir,
    });

    storageRegistry = new StorageRegistry();
  });

  afterEach(async () => {
    await service.dispose();
    try {
      await fsp.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('readFile', () => {
    it('throws if provider is not found', async () => {
      await expect(
        service.readFile(storageRegistry, 'non-existent', '/some/file.txt')
      ).rejects.toThrow('Storage provider not found: non-existent');
    });

    it('reads a text file successfully', async () => {
      const mockProvider = {
        id: 'mock-p1',
        name: 'Mock',
        type: 'local' as const,
        createReadStream: vi.fn().mockImplementation(() => {
          return Readable.from([Buffer.from('Hello world\nSecond line', 'utf-8')]);
        }),
      };
      storageRegistry.register(mockProvider as any);

      const res = await service.readFile(storageRegistry, 'mock-p1', '/test.txt');
      expect(res.content).toBe('Hello world\nSecond line');
      expect(res.size).toBe(Buffer.byteLength('Hello world\nSecond line'));
      expect(res.isBinary).toBe(false);
      expect(res.truncated).toBe(false);
    });

    it('detects binary file with null bytes and returns isBinary: true', async () => {
      const binaryData = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x01, 0x00]);
      const mockProvider = {
        id: 'mock-bin',
        name: 'Mock Bin',
        type: 'sftp' as const,
        createReadStream: vi.fn().mockImplementation(() => {
          return Readable.from([binaryData]);
        }),
      };
      storageRegistry.register(mockProvider as any);

      const res = await service.readFile(storageRegistry, 'mock-bin', '/app.bin');
      expect(res.isBinary).toBe(true);
      expect(res.content).toBe('');
      expect(res.size).toBe(binaryData.length);
      expect(res.truncated).toBe(false);
    });

    it('truncates content when exceeding maxBytes', async () => {
      const largeData = Buffer.from('a'.repeat(200), 'utf-8');
      const mockProvider = {
        id: 'mock-large',
        name: 'Mock Large',
        type: 's3' as const,
        createReadStream: vi.fn().mockImplementation(() => {
          return Readable.from([largeData]);
        }),
      };
      storageRegistry.register(mockProvider as any);

      const res = await service.readFile(storageRegistry, 'mock-large', '/large.log', 50);
      expect(res.truncated).toBe(true);
      expect(res.size).toBe(50);
      expect(res.content).toBe('a'.repeat(50));
    });
  });

  describe('saveFile', () => {
    it('throws if provider is not found', async () => {
      await expect(
        service.saveFile(storageRegistry, 'non-existent', '/test.txt', 'new data')
      ).rejects.toThrow('Storage provider not found: non-existent');
    });

    it('writes utf-8 buffer to provider write stream', async () => {
      const chunks: Buffer[] = [];
      const mockWriteStream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });

      const mockProvider = {
        id: 'mock-write',
        name: 'Mock Write',
        type: 'sftp' as const,
        createWriteStream: vi.fn().mockResolvedValue(mockWriteStream),
      };
      storageRegistry.register(mockProvider as any);

      await service.saveFile(storageRegistry, 'mock-write', '/path/to/save.txt', 'Updated content!');

      const written = Buffer.concat(chunks).toString('utf-8');
      expect(written).toBe('Updated content!');
      expect(mockProvider.createWriteStream).toHaveBeenCalledWith('/path/to/save.txt');
    });
  });

  describe('openInExternalEditor', () => {
    it('opens local file directly with shell.openPath', async () => {
      const localProvider = new LocalStorageProvider({
        id: 'local-test',
        basePath: tempBaseDir,
      });
      storageRegistry.register(localProvider);

      const testFile = path.join(tempBaseDir, 'local.txt');
      await fsp.writeFile(testFile, 'local content');

      const result = await service.openInExternalEditor(storageRegistry, 'local-test', 'local.txt');

      expect(mockShell.openPath).toHaveBeenCalledWith(testFile);
      expect(result.localPath).toBe(testFile);
      expect(typeof result.sessionToken).toBe('string');
    });

    it('throws if shell.openPath returns an error string', async () => {
      mockShell.openPath.mockResolvedValue('No default application');
      const localProvider = new LocalStorageProvider({
        id: 'local-err',
        basePath: tempBaseDir,
      });
      storageRegistry.register(localProvider);

      await expect(
        service.openInExternalEditor(storageRegistry, 'local-err', 'local.txt')
      ).rejects.toThrow('No default application');
    });

    it('downloads remote file to temp folder, opens it, and tracks session', async () => {
      const fileData = 'Remote config content\nport=8080\n';
      const mockProvider = {
        id: 'sftp-test',
        name: 'SFTP Test',
        type: 'sftp' as const,
        createReadStream: vi.fn().mockImplementation(() => {
          return Readable.from([Buffer.from(fileData, 'utf-8')]);
        }),
        createWriteStream: vi.fn().mockImplementation(() => {
          return new PassThrough();
        }),
      };
      storageRegistry.register(mockProvider as any);

      const result = await service.openInExternalEditor(storageRegistry, 'sftp-test', '/etc/config.ini');

      expect(result.sessionToken).toBeDefined();
      expect(result.localPath).toContain('config.ini');
      expect(mockShell.openPath).toHaveBeenCalledWith(result.localPath);

      // Verify temp file was downloaded
      const downloaded = await fsp.readFile(result.localPath, 'utf-8');
      expect(downloaded).toBe(fileData);

      const session = service.getSession(result.sessionToken);
      expect(session).toBeDefined();
      expect(session?.remotePath).toBe('/etc/config.ini');

      // Close session
      await service.closeExternalEditor(result.sessionToken);
      expect(service.getSession(result.sessionToken)).toBeUndefined();
    });
  });

  describe('dispose', () => {
    it('cleans up all active sessions without errors', async () => {
      const mockProvider = {
        id: 's3-test',
        name: 'S3 Test',
        type: 's3' as const,
        createReadStream: vi.fn().mockImplementation(() => {
          return Readable.from([Buffer.from('s3 data')]);
        }),
        createWriteStream: vi.fn().mockImplementation(() => new PassThrough()),
      };
      storageRegistry.register(mockProvider as any);

      await service.openInExternalEditor(storageRegistry, 's3-test', '/bucket/file.json');
      expect(service.getActiveSessions().length).toBe(1);

      await service.dispose();
      expect(service.getActiveSessions().length).toBe(0);
    });
  });
});
