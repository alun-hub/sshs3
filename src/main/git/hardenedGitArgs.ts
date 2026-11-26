import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectGitConfigNames, resolveGitBinary, safeGitConfigArgs, safeGitEnv } from './gitSafety';

const execFileAsync = promisify(execFile);

export type HardenedGitConfig =
  | {
      ok: true;
      args: string[];
      /** The repository has initialised submodules. status does not look inside them (see GitStatusService). */
      hasSubmodules: boolean;
    }
  | { ok: false; reason: string };

const UNREADABLE = 'the repository configuration could not be read';
/** `git config --show-scope` is from git 2.26; an older git rejects the option as unknown (usage error, exit 129). */
const GIT_TOO_OLD = 'the installed git is too old to list the repository configuration (git 2.26 or newer is needed)';

/**
 * Names of the config keys a repository itself defines, from the scopes it controls: `local` (`.git/config`) and
 * `worktree` (`.git/config.worktree`, read by git when `extensions.worktreeConfig` is on). System, global and
 * command-line config is the user's own and is left out. One call lists them all and, unlike
 * `git config --worktree`, does not fail when `config.worktree` is missing.
 *
 * `--list --show-scope -z` prints `scope NUL name NUL` pairs. Listing runs nothing from the config.
 * Returns undefined when the output is malformed or holds no `local` key: `git config --list` succeeds with an empty
 * list outside a repository, and git writes `core.repositoryformatversion` into every real one.
 */
async function listRepositoryConfigNames(cwd: string): Promise<string[] | undefined> {
  const { stdout } = await execFileAsync(
    resolveGitBinary(),
    [...safeGitConfigArgs(), 'config', '--list', '--show-scope', '--name-only', '-z'],
    { cwd, timeout: 5000, env: safeGitEnv() }
  );
  const fields = stdout.split('\0');
  if (fields[fields.length - 1] === '') fields.pop();
  if (fields.length % 2 !== 0) return undefined;
  const names: string[] = [];
  let sawLocal = false;
  for (let i = 0; i < fields.length; i += 2) {
    const scope = fields[i];
    if (scope === 'local') sawLocal = true;
    if (scope === 'local' || scope === 'worktree') names.push(fields[i + 1]);
  }
  return sawLocal ? names : undefined;
}

function isUnknownOptionError(err: unknown): boolean {
  const e = err as { code?: unknown; stderr?: unknown };
  return e.code === 129 || (typeof e.stderr === 'string' && /unknown option/i.test(e.stderr));
}

/**
 * Config arguments for running git in a directory we did not create (a folder downloaded from a server, say).
 * A repository's own config can make git run programs (`filter.<x>.clean`, `core.sshCommand`, diff and merge drivers,
 * credential helpers, ...), so git is only run when every key in it is on an allowlist of harmless settings
 * (`gitConfigKeys.ts`). The result is `safeGitConfigArgs` plus submodule recursion turned off, so a pull never runs a
 * submodule's `update = !command`. Otherwise `ok` is false with a reason naming the first rejected key, and the
 * caller must not run git there.
 *
 * Only the repository's own config is vetted. A submodule has one of its own, which git reads when it runs
 * `git status` inside it, so a caller that runs `status` must pass `--ignore-submodules=all`.
 */
export async function hardenedGitConfigArgs(cwd: string): Promise<HardenedGitConfig> {
  try {
    const names = await listRepositoryConfigNames(cwd);
    if (!names) return { ok: false, reason: UNREADABLE };
    const inspection = inspectGitConfigNames(names);
    if (!inspection.trusted) {
      return {
        ok: false,
        reason: inspection.rejectedKey
          ? `the setting ${inspection.rejectedKey} is not on the list of safe settings`
          : 'a setting with an invalid name is not on the list of safe settings',
      };
    }
    return {
      ok: true,
      args: [...safeGitConfigArgs(), '-c', 'submodule.recurse=false', '-c', 'fetch.recurseSubmodules=false'],
      hasSubmodules: names.some((name) => /^submodule\./i.test(name)),
    };
  } catch (err) {
    return { ok: false, reason: isUnknownOptionError(err) ? GIT_TOO_OLD : UNREADABLE };
  }
}
