import os from 'node:os';
import { isKnownHarmlessConfigKey } from './gitConfigKeys';

/**
 * Config overrides that stop a repository's own `.git/config` from running code
 * (core.fsmonitor, hooks, pager) when we invoke git in a directory we do not trust.
 */
export function safeGitConfigArgs(hooksPath: string = os.devNull): string[] {
  return ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${hooksPath}`, '-c', 'core.pager=cat'];
}

/**
 * Config keys that make git run an external program (clean/smudge filters, diff and merge drivers, ssh/proxy/askpass
 * commands, credential helpers, remote helpers, gpg). `-c` cannot take wildcards, so the keys a repository actually
 * defines are read first and each one is blanked (see `inspectGitConfigNames`).
 * Keyed by section, then the variables of that section that run a program. A key is `section[.subsection].variable`.
 */
const COMMAND_VARIABLES: Record<string, ReadonlySet<string>> = {
  filter: new Set(['clean', 'smudge', 'process']),
  diff: new Set(['command', 'textconv', 'external']),
  merge: new Set(['driver']),
  core: new Set(['sshcommand', 'gitproxy', 'askpass', 'editor']), // fsmonitor and pager: see safeGitConfigArgs
  credential: new Set(['helper']),
  gpg: new Set(['program', 'defaultkeycommand']),
  remote: new Set(['uploadpack', 'receivepack', 'vcs', 'proxy']),
  sequence: new Set(['editor']),
};

function splitConfigKey(key: string): { section: string; variable: string; hasSubsection: boolean } {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  return {
    section: key.slice(0, first).toLowerCase(),
    variable: key.slice(last + 1).toLowerCase(),
    hasSubsection: last > first,
  };
}

function isCommandConfigKey(key: string): boolean {
  if (!key.includes('.')) return false;
  const { section, variable } = splitConfigKey(key);
  return COMMAND_VARIABLES[section]?.has(variable) === true;
}

/** `include.path` / `includeIf.<cond>.path` pull in files that cannot be vetted key by key. */
function isIncludeConfigKey(key: string): boolean {
  if (!key.includes('.')) return false;
  const { section, variable } = splitConfigKey(key);
  return (section === 'include' || section === 'includeif') && variable === 'path';
}

export interface GitConfigInspection {
  /** False when git must not be run in this repository: its config includes other files or holds an unknown key. */
  trusted: boolean;
  /** `-c key=` arguments that blank every program-running key the repository defines (only `filter.lfs.*` can remain). */
  overrides: string[];
}

/**
 * Pure: decides, from the key names of a repository's own config, whether git may run there.
 *
 * The allowlist is the gate: any key that is not known to be harmless (see `isKnownHarmlessConfigKey`) makes the
 * repository untrusted, so keys we did not think of fail safe. The denylist stays as a second layer: a program-running
 * key that is allowlisted (Git LFS's `filter.lfs.*`) is blanked with `-c key=` rather than run.
 */
export function inspectGitConfigNames(names: readonly string[]): GitConfigInspection {
  const blank = new Set<string>();
  for (const name of names) {
    if (isIncludeConfigKey(name)) return { trusted: false, overrides: [] };
    if (!isKnownHarmlessConfigKey(name)) return { trusted: false, overrides: [] };
    if (isCommandConfigKey(name)) {
      // `-c key=` splits at the first "=", so a key that itself contains one (`[filter "a=b"]`) cannot be blanked that way
      // and would stay active. Such a repository is not worth running git in.
      if (name.includes('=')) return { trusted: false, overrides: [] };
      blank.add(name);
    }
  }
  return { trusted: true, overrides: [...blank].flatMap((name) => ['-c', `${name}=`]) };
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

/** Single-quotes a value for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** True if the value contains NUL or line breaks, which must never reach a shell command. */
export function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- intentional: reject NUL/CR/LF in paths
  return /[\u0000\r\n]/.test(value);
}
