import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DotfileSyncService,
  resolveRemotePath,
  type IDotfileTransport,
} from '../../src/main/dotfiles/DotfileSyncService';
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

    const config: SSHConnectionConfig = {
      id: 'c1',
      name: 'gnarg',
      host: 'gnarg',
      username: 'alun',
      authType: 'agent',
    };

    beforeEach(() => {
      service = new DotfileSyncService();
    });

    it('identifies identical files, changed files, and missing files with tilde resolution', async () => {
      const remoteFiles: Record<string, string> = {
        '/home/alun/.bashrc': 'export FOO=MATCH',
        '/home/alun/.zshrc': 'export OLD=DIFF',
        // .vimrc is missing on remote
      };
      const transport: IDotfileTransport = {
        getHomeDir: vi.fn().mockResolvedValue('/home/alun'),
        readRemoteFile: vi.fn(async (remotePath: string) => {
          if (remoteFiles[remotePath] === undefined) throw new Error('No such file');
          return Buffer.from(remoteFiles[remotePath], 'utf-8');
        }),
        writeRemoteFile: vi.fn(),
      };

      const pool: DotfilePool = {
        id: 'pool-1',
        name: 'My Pool',
        files: [
          { id: 'f1', remotePath: '~/.bashrc', content: 'export FOO=MATCH' }, // identical
          { id: 'f2', remotePath: '~/.zshrc', content: 'export NEW=DIFF' }, // changed
          { id: 'f3', remotePath: '~/.vimrc', content: 'set number' }, // missing on remote
        ],
      };

      const diff = await service.computeDiff(config, pool, { transport });

      // f1 is identical so it should NOT be in diff.entries
      expect(diff.entries).toHaveLength(2);
      expect(diff.entries.find((e) => e.fileId === 'f2')?.reason).toBe('different');
      expect(diff.entries.find((e) => e.fileId === 'f3')?.reason).toBe('missing');
      expect(diff.provider).toBe(transport);
    });

    it('applies files by writing each one to its resolved path with its mode', async () => {
      const writeRemoteFile = vi.fn().mockResolvedValue(undefined);
      const transport: IDotfileTransport = {
        getHomeDir: vi.fn().mockResolvedValue('/home/alun'),
        readRemoteFile: vi.fn(),
        writeRemoteFile,
      };
      const files: DotfilePoolFile[] = [
        { id: 'f1', remotePath: '~/.bashrc', content: 'export FOO=BAR', mode: '644' },
        { id: 'f2', remotePath: '../../../etc/cron.d/pwned', content: 'x' },
      ];

      await service.applyFiles(transport, files);

      expect(writeRemoteFile).toHaveBeenNthCalledWith(1, '/home/alun/.bashrc', 'export FOO=BAR', '644');
      // A pool entry that tries to escape the home directory is clamped inside it.
      expect(writeRemoteFile).toHaveBeenNthCalledWith(2, '/home/alun/pwned', 'x', undefined);
    });
  });
});
