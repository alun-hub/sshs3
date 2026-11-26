import os from 'node:os';
import { isKnownHarmlessConfigKey } from './gitConfigKeys';

/** The git executable. One place, so the code that vets a repository's config and the code that runs git use the same one. */
export function resolveGitBinary(): string {
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

/**
 * Config overrides that stop a repository's own `.git/config` from running code
 * (core.fsmonitor, hooks, pager) when we invoke git in a directory we do not trust.
 */
export function safeGitConfigArgs(hooksPath: string = os.devNull): string[] {
  return ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${hooksPath}`, '-c', 'core.pager=cat'];
}

export interface GitConfigInspection {
  /** False when git must not be run in this repository: its config holds a key that is not known to be harmless. */
  trusted: boolean;
  /** The first rejected key as `section.variable` (the subsection is left out: it can hold a URL with credentials). Unset for a malformed name. */
  rejectedKey?: string;
}

/** `section.variable` of a git config key (`section[.subsection].variable`), without the free-text subsection. */
export function describeConfigKey(key: string): string | undefined {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first < 1 || last === key.length - 1) return undefined;
  return `${key.slice(0, first).toLowerCase()}.${key.slice(last + 1).toLowerCase()}`;
}

/**
 * Pure: decides, from the key names of a repository's own config, whether git may run there.
 *
 * Allowlist only (see `isKnownHarmlessConfigKey`): any key that is not known to be harmless makes the repository
 * untrusted, so a key we did not think of, or one a future git adds, fails safe. Nothing is blanked with `-c`: that
 * cannot address every key (a name containing "=" is split in the wrong place) and a blanked filter changes what git
 * does with the files (a blanked LFS smudge filter makes a checkout write pointer files over the real content).
 */
export function inspectGitConfigNames(names: readonly string[]): GitConfigInspection {
  for (const name of names) {
    if (!isKnownHarmlessConfigKey(name)) return { trusted: false, rejectedKey: describeConfigKey(name) };
  }
  return { trusted: true };
}

/** Environment for git child processes: no prompts, no system config, no optional locks, restricted transports. */
export function safeGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_ALLOW_PROTOCOL: 'https:http:ssh:git',
  };
}

/**
 * `safeGitEnv` for `git pull`: an interactive rebase (`pull.rebase=interactive`, which a repository's own config can
 * set) would open the user's editor on its todo list, so the sequence editor is a no-op that keeps the list as is.
 */
export function safeGitPullEnv(): NodeJS.ProcessEnv {
  return { ...safeGitEnv(), GIT_SEQUENCE_EDITOR: 'true' };
}

/** Single-quotes a value for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** True if the value contains NUL or line breaks, which must never reach a shell command. */
export function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- intentional: reject NUL/CR/LF in paths
  return /[\u0000\r\n]/.test(value);
}
