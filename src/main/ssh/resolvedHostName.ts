import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createLogger } from '../log';
import { isSafeHostToken } from './hostToken';

const log = createLogger('ssh');

/**
 * The host name to pin with `-o HostName=` for a connection whose proxy or jump host is a shell-run command.
 *
 * ssh expands `%h` in that command from the HostName it RESOLVES for the destination, and a synced `~/.ssh/config` block can
 * set the HostName of an alias to shell syntax. Pinning the profile's host on the command line (a `-o` beats the config)
 * closes that, but it also stops a host that IS an `ssh_config` alias from being resolved: the proxy then receives the alias
 * itself, and `known_hosts` is keyed by it. So the alias is resolved here, the way ssh does it (`ssh -G`), and the RESULT is
 * pinned, but only when it is made of host name characters (`isSafeHostToken`, no leading `-`). Anything else, a failing or
 * slow `ssh -G`, a broken config, falls back to the profile's own host, which is what was pinned before.
 *
 * Notes:
 * - `ssh -G` evaluates the user's own `Match exec` commands, like the real connection does. The answer (also a failure) is
 *   cached for `CACHE_MS`, so they run at most once per host in that time rather than for every spawn (performance pings,
 *   tunnels and file transfers each build the arguments again).
 * - The output is parsed for one line and never logged.
 * - This runs `ssh` synchronously with a short timeout: `buildSSHArguments` is synchronous and has ten callers.
 */
const TIMEOUT_MS = 2000;
const CACHE_MS = 60_000;
const CACHE_MAX = 200;

export type SshGRunner = (args: string[]) => string;

function sshBinary(): string {
  if (process.platform === 'win32') {
    const winDefault = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
    return fs.existsSync(winDefault) ? winDefault : 'ssh.exe';
  }
  return 'ssh';
}

const realRunner: SshGRunner = (args) =>
  execFileSync(sshBinary(), args, { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1024 * 1024 });

let runner: SshGRunner = realRunner;
let clock: () => number = () => Date.now();
const cache = new Map<string, { value: string; at: number }>();

/** The value of the `hostname` line of `ssh -G` output, or undefined. Keywords are lower case in that output. */
export function parseResolvedHostName(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = /^hostname[ \t]+(\S+)[ \t]*$/i.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/** Whether a resolved host name may be placed in the shell-run command: host name characters only, never a leading `-`. */
export function isSafeResolvedHostName(value: unknown): value is string {
  return isSafeHostToken(value) && !value.startsWith('-');
}

export interface HostNameTarget {
  /** Already validated by the caller (`isSafeHostToken`, no leading `-`). */
  host: string;
  username?: string;
  port?: number;
}

export function resolveHostNamePin(target: HostNameTarget): string {
  const port = target.port ?? 22;
  const destination = target.username ? `${target.username}@${target.host}` : target.host;
  const key = `${destination}:${port}`;
  const now = clock();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  let value = target.host;
  try {
    const resolved = parseResolvedHostName(runner(['-G', '-p', String(port), '--', destination]));
    if (isSafeResolvedHostName(resolved)) value = resolved;
    else if (resolved !== undefined) log.warn(`ssh -G resolved ${target.host} to a value that cannot be used in a proxy command; pinning the profile host instead`);
  } catch (err) {
    log.info(`ssh -G failed for ${target.host} (${err instanceof Error ? err.message.split('\n')[0] : 'error'}); pinning the profile host instead`);
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { value, at: now });
  return value;
}

/** For tests: replace what runs `ssh -G` (undefined restores the real one), the clock, and empty the cache. */
export function configureResolvedHostNameForTests(options: { runner?: SshGRunner; clock?: () => number } = {}): void {
  runner = options.runner ?? realRunner;
  clock = options.clock ?? (() => Date.now());
  cache.clear();
}
