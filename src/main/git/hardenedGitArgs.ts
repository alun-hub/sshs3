import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectGitConfigNames, safeGitConfigArgs, safeGitEnv } from './gitSafety';

const execFileAsync = promisify(execFile);

async function listConfigNames(cwd: string, scope: '--local' | '--worktree'): Promise<string[]> {
  const { stdout } = await execFileAsync(
    process.platform === 'win32' ? 'git.exe' : 'git',
    [...safeGitConfigArgs(), 'config', scope, '--list', '--name-only', '-z'],
    { cwd, timeout: 5000, env: safeGitEnv() }
  );
  return stdout.split('\0').filter(Boolean);
}

/**
 * Config arguments for running git in a directory we did not create (a folder downloaded from a server, say).
 * On top of `safeGitConfigArgs` it blanks every program-running key the repository's own config defines
 * (filter.<x>.clean, core.sshCommand, diff.external, ...), which `git status` and `git pull` would otherwise run,
 * and turns off submodule recursion so a pull never runs a submodule's `update = !command`.
 *
 * Both repository scopes are read: `--local` is `.git/config` only, and `--worktree` adds `.git/config.worktree`
 * when `extensions.worktreeConfig` is on (without the extension it is the same as `--local`). Git applies both.
 *
 * Returns undefined, so the caller must not run git there, when the config cannot be read or includes other files.
 * Listing the config runs nothing from it.
 */
export async function hardenedGitConfigArgs(cwd: string): Promise<string[] | undefined> {
  try {
    const names = [...(await listConfigNames(cwd, '--local')), ...(await listConfigNames(cwd, '--worktree'))];
    const inspection = inspectGitConfigNames(names);
    if (!inspection.trusted) return undefined;
    return [
      ...safeGitConfigArgs(),
      '-c',
      'submodule.recurse=false',
      '-c',
      'fetch.recurseSubmodules=false',
      ...inspection.overrides,
    ];
  } catch {
    return undefined;
  }
}
