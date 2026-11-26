import os from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A real `git pull` cannot run here (GIT_ALLOW_PROTOCOL has no `file`), so the git calls are captured instead.
const state = vi.hoisted(() => ({
  calls: [] as { args: string[]; env: NodeJS.ProcessEnv }[],
  listingError: undefined as unknown,
}));

vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (
    _file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv }
  ) => {
    state.calls.push({ args, env: options.env });
    if (args.includes('--show-scope')) {
      if (state.listingError) throw state.listingError;
      // `git config --list --show-scope --name-only -z`: a harmless repository
      return { stdout: 'local\0core.bare\0local\0remote.origin.url\0', stderr: '' };
    }
    return { stdout: 'Already up to date.\n', stderr: '' };
  };
  return { execFile };
});
vi.mock('../../src/main/ssh/KeyInstallService', () => ({ runSshCommand: vi.fn() }));

import { RemoteGitService } from '../../src/main/git/RemoteGitService';

describe('RemoteGitService.pull', () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.listingError = undefined;
  });

  it('runs git pull with the hardened arguments and an environment that keeps an interactive rebase from opening an editor', async () => {
    const result = await RemoteGitService.pull('/some/repo');

    expect(result).toEqual({ success: true, output: 'Already up to date.' });
    const pull = state.calls.find((c) => c.args.includes('pull'));
    expect(pull).toBeDefined();
    expect(pull!.args).toEqual(expect.arrayContaining(['submodule.recurse=false', 'fetch.recurseSubmodules=false', `core.hooksPath=${os.devNull}`]));
    expect(pull!.env.GIT_SEQUENCE_EDITOR).toBe('true');
    expect(pull!.env.GIT_ALLOW_PROTOCOL).toBe('https:http:ssh:git');
  });

  it('says the installed git is too old when it does not know --show-scope, and does not pull', async () => {
    state.listingError = Object.assign(new Error('Command failed'), { code: 129, stderr: "error: unknown option `show-scope'" });

    const result = await RemoteGitService.pull('/some/repo');

    expect(result.success).toBe(false);
    expect(result.error).toContain('git 2.26 or newer is needed');
    expect(state.calls.some((c) => c.args.includes('pull'))).toBe(false);
  });
});
