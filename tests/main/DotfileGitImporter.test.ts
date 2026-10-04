import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { DotfilePool } from '../../src/shared/types/dotfiles';
import type { DotfilePoolStore } from '../../src/main/dotfiles/DotfilePoolStore';

// `git clone` is replaced by a fake that writes a prepared repository layout into the destination
// directory the importer passes as the last argument.
const cloneState = vi.hoisted(() => ({
  layout: {} as Record<string, string | Buffer>,
  fail: null as Error | null,
  calls: [] as Array<{ bin: string; args: string[]; options: Record<string, unknown> }>,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const fakeExecFile = (
    bin: string,
    args: string[],
    options: Record<string, unknown>,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => {
    cloneState.calls.push({ bin, args, options });
    if (cloneState.fail) {
      callback(cloneState.fail);
      return;
    }
    const dest = args[args.length - 1];
    for (const [rel, content] of Object.entries(cloneState.layout)) {
      const full = path.join(dest, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    callback(null, { stdout: '', stderr: '' });
  };
  return { ...actual, default: { ...actual, execFile: fakeExecFile }, execFile: fakeExecFile };
});

import { DotfileGitImporter, parseGitUrl } from '../../src/main/dotfiles/DotfileGitImporter';

describe('DotfileGitImporter', () => {
  describe('parseGitUrl', () => {
    it('converts owner/repo shorthand to GitHub clone URL and default pool name', () => {
      const res = parseGitUrl('alun/dotfiles');
      expect(res.cloneUrl).toBe('https://github.com/alun/dotfiles.git');
      expect(res.defaultPoolName).toBe('dotfiles-dotfiles');
    });

    it('handles full https repository URLs', () => {
      const res = parseGitUrl('https://github.com/torvalds/my-configs.git');
      expect(res.cloneUrl).toBe('https://github.com/torvalds/my-configs.git');
      expect(res.defaultPoolName).toBe('my-configs-dotfiles');
    });

    it('handles git@ SSH URLs', () => {
      const res = parseGitUrl('git@gitlab.com:alice/work-dots.git');
      expect(res.cloneUrl).toBe('git@gitlab.com:alice/work-dots.git');
      expect(res.defaultPoolName).toBe('work-dots-dotfiles');
    });

    it('throws error for invalid Git URL', () => {
      expect(() => parseGitUrl('not a git url')).toThrow(/Invalid Git repository URL/);
      expect(() => parseGitUrl('https://github.com/evil/repo; rm -rf /')).toThrow(/Invalid Git repository URL/);
    });
  });

  describe('importFromGit', () => {
    const makeStore = () => {
      const saved: DotfilePool[] = [];
      const store = { savePool: vi.fn(async (pool: DotfilePool) => void saved.push(pool)) };
      return { store: store as unknown as DotfilePoolStore, saved, savePool: store.savePool };
    };

    beforeEach(() => {
      cloneState.layout = {};
      cloneState.fail = null;
      cloneState.calls = [];
    });

    it('requires a repository', async () => {
      const { store, savePool } = makeStore();
      expect(await DotfileGitImporter.importFromGit({ urlOrRepo: '   ' }, store)).toEqual({
        success: false,
        error: 'Repository URL or username/repo is required',
      });
      expect(cloneState.calls).toHaveLength(0);
      expect(savePool).not.toHaveBeenCalled();
    });

    it('rejects a malformed URL before touching git or the filesystem', async () => {
      const { store } = makeStore();
      const res = await DotfileGitImporter.importFromGit({ urlOrRepo: 'https://github.com/evil/repo; rm -rf /' }, store);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Invalid Git repository URL/);
      expect(cloneState.calls).toHaveLength(0);
    });

    it('clones shallowly with "--" before the URL, then imports only recognisable dotfiles', async () => {
      cloneState.layout = {
        '.bashrc': 'export A=1\n',
        'tmux.conf': 'set -g mouse on\n', // un-dotted repo name -> ~/.tmux.conf
        '.config/nvim/init.lua': '-- nvim\n',
        '.config/.ssh/config': 'Host *\n', // anything under .ssh is written 0600
        'README.md': 'ignored by name',
        'install.sh': 'ignored by name',
        '.github/workflows/ci.yml': 'ignored directory',
        'src/main.c': 'not a dotfile, and src/ is not scanned',
        'notes.txt': 'not a recognised dotfile',
      };
      const { store, saved } = makeStore();

      const res = await DotfileGitImporter.importFromGit({ urlOrRepo: 'alun/dotfiles' }, store);

      expect(res.success).toBe(true);
      expect(res.importedFilesCount).toBe(4);
      expect(res.poolId).toBe(saved[0].id);

      const clone = cloneState.calls[0];
      expect(clone.args).toContain('clone');
      const dashDash = clone.args.indexOf('--');
      expect(clone.args.slice(dashDash)).toEqual(['--', 'https://github.com/alun/dotfiles.git', clone.args[clone.args.length - 1]]);
      expect(clone.args.slice(clone.args.indexOf('clone'), dashDash)).toEqual(['clone', '--depth', '1']);
      expect(clone.options.timeout).toBe(60000);

      expect(saved[0].name).toBe('dotfiles-dotfiles');
      const byPath = Object.fromEntries(saved[0].files.map((f) => [f.remotePath, f]));
      expect(Object.keys(byPath).sort()).toEqual([
        '~/.bashrc',
        '~/.config/.ssh/config',
        '~/.config/nvim/init.lua',
        '~/.tmux.conf',
      ]);
      expect(byPath['~/.bashrc'].content).toBe('export A=1\n');
      expect(byPath['~/.bashrc'].mode).toBe('644');
      expect(byPath['~/.config/.ssh/config'].mode).toBe('600');
      expect(new Set(saved[0].files.map((f) => f.id)).size).toBe(4);
    });

    it('uses the requested pool name when given', async () => {
      cloneState.layout = { '.zshrc': 'x' };
      const { store, saved } = makeStore();
      await DotfileGitImporter.importFromGit({ urlOrRepo: 'alun/dotfiles', poolName: '  Work laptop ' }, store);
      expect(saved[0].name).toBe('Work laptop');
    });

    it('skips files larger than 512 KB', async () => {
      cloneState.layout = { '.bashrc': Buffer.alloc(512 * 1024 + 1, 'a'), '.zshrc': 'small' };
      const { store, saved } = makeStore();
      const res = await DotfileGitImporter.importFromGit({ urlOrRepo: 'alun/dotfiles' }, store);
      expect(res.importedFilesCount).toBe(1);
      expect(saved[0].files.map((f) => f.remotePath)).toEqual(['~/.zshrc']);
    });

    it('fails with a clear message and saves nothing when the repository has no dotfiles', async () => {
      cloneState.layout = { 'README.md': 'x', 'docs/guide.md': 'y' };
      const { store, savePool } = makeStore();
      const res = await DotfileGitImporter.importFromGit({ urlOrRepo: 'alun/dotfiles' }, store);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/No typical dotfiles/);
      expect(savePool).not.toHaveBeenCalled();
    });

    it('reports a clone failure and still removes the temporary directory', async () => {
      cloneState.fail = new Error('fatal: repository not found');
      const { store, savePool } = makeStore();
      const res = await DotfileGitImporter.importFromGit({ urlOrRepo: 'alun/missing' }, store);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Failed to import dotfiles from repository: fatal: repository not found');
      expect(savePool).not.toHaveBeenCalled();

      const tempDir = cloneState.calls[0].args.at(-1) as string;
      expect(tempDir.startsWith(path.join(os.tmpdir(), 'sshs3-git-dotfiles-'))).toBe(true);
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('removes the temporary clone after a successful import too', async () => {
      cloneState.layout = { '.bashrc': 'x' };
      const { store } = makeStore();
      await DotfileGitImporter.importFromGit({ urlOrRepo: 'alun/dotfiles' }, store);
      expect(fs.existsSync(cloneState.calls[0].args.at(-1) as string)).toBe(false);
    });

    it('surfaces a store failure as an import error', async () => {
      cloneState.layout = { '.bashrc': 'x' };
      const store = { savePool: vi.fn().mockRejectedValue(new Error('disk full')) } as unknown as DotfilePoolStore;
      const res = await DotfileGitImporter.importFromGit({ urlOrRepo: 'alun/dotfiles' }, store);
      expect(res).toEqual({ success: false, error: 'Failed to import dotfiles from repository: disk full' });
    });
  });
});
