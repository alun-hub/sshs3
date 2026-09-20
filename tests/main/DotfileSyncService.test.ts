import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { DotfileSyncService, resolveRemotePath } from '../../src/main/dotfiles/DotfileSyncService';
import type { SFTPStorageProvider } from '../../src/main/storage/SFTPStorageProvider';
import type { DotfilePool, DotfilePoolFile } from '../../src/shared/types/dotfiles';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

describe('DotfileSyncService', () => {
  describe('resolveRemotePath', () => {
    it('resolves ~ and ~/ paths against home directory', () => {
      expect(resolveRemotePath('~/.bashrc', '/home/alun')).toBe('/home/alun/.bashrc');
      expect(resolveRemotePath('~', '/home/alun')).toBe('/home/alun');
      expect(resolveRemotePath('', '/home/alun')).toBe('/home/alun');
      expect(resolveRemotePath('.', '/home/alun')).toBe('/home/alun');
      expect(resolveRemotePath('~/.config/nvim/init.vim', '/home/alun')).toBe(
        '/home/alun/.config/nvim/init.vim'
      );
    });

    it('resolves relative paths without leading ~/ against home directory', () => {
      expect(resolveRemotePath('.bashrc', '/home/alun')).toBe('/home/alun/.bashrc');
      expect(resolveRemotePath('.config/fish/config.fish', '/home/alun')).toBe(
        '/home/alun/.config/fish/config.fish'
      );
    });

    it('preserves absolute paths', () => {
      expect(resolveRemotePath('/etc/motd', '/home/alun')).toBe('/etc/motd');
      expect(resolveRemotePath('/var/log/syslog', '/home/alun')).toBe('/var/log/syslog');
    });

    it('clamps a home-relative path that traverses outside the home directory', () => {
      // A dotfile pool entry can arrive from remote profile sync, so "../"
      // segments in a nominally home-relative remotePath must never be able
      // to escape homeDir (e.g. onto /etc via path normalization).
      expect(resolveRemotePath('../../../etc/cron.d/pwned', '/home/alun')).toBe('/home/alun/pwned');
      expect(resolveRemotePath('~/../../etc/passwd', '/home/alun')).toBe('/home/alun/passwd');
      expect(resolveRemotePath('../../../root/.ssh/authorized_keys', '/home/alun')).toBe(
        '/home/alun/authorized_keys'
      );
    });
  });

  describe('computeDiff and applyFiles', () => {
    let service: DotfileSyncService;
    let mockProvider: Partial<SFTPStorageProvider>;

    beforeEach(() => {
      service = new DotfileSyncService();
    });

    it('identifies identical files, changed files, and missing files with tilde resolution', async () => {
      const remoteFiles: Record<string, string> = {
        '/home/alun/.bashrc': 'export FOO=MATCH',
        '/home/alun/.zshrc': 'export OLD=DIFF',
        // .vimrc is missing on remote
      };

      mockProvider = {
        ensureConnected: vi.fn().mockResolvedValue(undefined),
        getHomeDir: vi.fn().mockResolvedValue('/home/alun'),
        createReadStream: vi.fn((remotePath: string) => {
          if (remoteFiles[remotePath] !== undefined) {
            return Readable.from([Buffer.from(remoteFiles[remotePath], 'utf-8')]);
          }
          const errStream = new Readable({
            read() {
              this.destroy(new Error('No such file'));
            },
          });
          return errStream;
        }) as any,
      };

      (service as any).createProvider = vi.fn().mockReturnValue(mockProvider);

      const pool: DotfilePool = {
        id: 'pool-1',
        name: 'My Pool',
        files: [
          {
            id: 'f1',
            remotePath: '~/.bashrc',
            content: 'export FOO=MATCH', // identical
          },
          {
            id: 'f2',
            remotePath: '~/.zshrc',
            content: 'export NEW=DIFF', // changed
          },
          {
            id: 'f3',
            remotePath: '~/.vimrc',
            content: 'set number', // missing on remote
          },
        ],
      };

      const config: SSHConnectionConfig = {
        id: 'c1',
        name: 'gnarg',
        host: 'gnarg',
        username: 'alun',
        authType: 'agent',
      };

      const diff = await service.computeDiff(config, pool);

      // f1 is identical so it should NOT be in diff.entries
      expect(diff.entries).toHaveLength(2);

      const zshEntry = diff.entries.find((e) => e.fileId === 'f2');
      expect(zshEntry).toBeDefined();
      expect(zshEntry?.reason).toBe('different');

      const vimEntry = diff.entries.find((e) => e.fileId === 'f3');
      expect(vimEntry).toBeDefined();
      expect(vimEntry?.reason).toBe('missing');
    });

    it('applies files by writing to resolved path and atomically renaming', async () => {
      const writtenData: Record<string, string> = {};
      const renamed: { oldPath: string; newPath: string }[] = [];
      const chmodded: { path: string; mode: string }[] = [];

      mockProvider = {
        getHomeDir: vi.fn().mockResolvedValue('/home/alun'),
        createFolder: vi.fn().mockResolvedValue(undefined),
        createWriteStream: vi.fn((targetPath: string) => {
          const chunks: Buffer[] = [];
          const ws = new Writable({
            write(chunk, _encoding, callback) {
              chunks.push(chunk);
              callback();
            },
          });
          ws.on('finish', () => {
            writtenData[targetPath] = Buffer.concat(chunks).toString('utf-8');
          });
          return ws;
        }) as any,
        rename: vi.fn(async (oldPath: string, newPath: string) => {
          renamed.push({ oldPath, newPath });
        }),
        chmod: vi.fn(async (targetPath: string, mode: string) => {
          chmodded.push({ path: targetPath, mode });
        }),
      };

      const files: DotfilePoolFile[] = [
        {
          id: 'f1',
          remotePath: '~/.bashrc',
          content: 'export FOO=BAR',
          mode: '644',
        },
      ];

      await service.applyFiles(mockProvider as SFTPStorageProvider, files);

      expect(renamed).toHaveLength(1);
      expect(renamed[0].oldPath).toBe('/home/alun/.bashrc.sshs3.tmp');
      expect(renamed[0].newPath).toBe('/home/alun/.bashrc');

      expect(chmodded).toHaveLength(1);
      expect(chmodded[0].path).toBe('/home/alun/.bashrc');
      expect(chmodded[0].mode).toBe('644');
    });
  });
});
