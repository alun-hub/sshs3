import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { MIN_PLUGIN_VERSION, compareVersions, parseToolVersion } from '../../shared/ssm';
import type { AwsSsmToolStatus, AwsSsmTools } from '../../shared/types/ssm';

const AWS_NAMES = { win32: 'aws.exe', other: 'aws' };
const PLUGIN_NAMES = { win32: 'session-manager-plugin.exe', other: 'session-manager-plugin' };

/** Fixed install locations besides PATH (GUI-launched apps often lack ~/.local/bin, /snap/bin, …). */
export function candidateDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): { aws: string[]; plugin: string[] } {
  if (platform === 'win32') {
    const pf = env.ProgramFiles ?? env.PROGRAMFILES ?? 'C:\\Program Files';
    return {
      aws: [path.win32.join(pf, 'Amazon', 'AWSCLIV2')],
      plugin: [path.win32.join(pf, 'Amazon', 'SessionManagerPlugin', 'bin')],
    };
  }
  const common = ['/usr/local/bin', '/usr/bin', '/snap/bin', path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/home/linuxbrew/.linuxbrew/bin'];
  return {
    aws: ['/usr/local/aws-cli/v2/current/bin', ...common],
    plugin: ['/usr/local/sessionmanagerplugin/bin', ...common],
  };
}

/** PATH entries (case-insensitive key lookup, as on Windows) split into directories. */
export function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const value = key ? env[key] : undefined;
  if (!value) return [];
  return value.split(platform === 'win32' ? ';' : ':').filter(Boolean);
}

export function pluginStatusFromVersion(version: string | undefined): boolean | undefined {
  return version === undefined ? undefined : compareVersions(version, MIN_PLUGIN_VERSION) >= 0;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** First existing executable named `names` in `dirs` (fs checks only — nothing is executed). */
export function findExecutable(dirs: string[], name: string, platform: NodeJS.Platform): string | undefined {
  const join = platform === 'win32' ? path.win32.join : path.join;
  for (const d of dirs) {
    const candidate = join(d, name);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

const versionCache = new Map<string, string | undefined>();

function probeVersion(file: string): Promise<string | undefined> {
  if (versionCache.has(file)) return Promise.resolve(versionCache.get(file));
  return new Promise((resolve) => {
    // Fixed argument, absolute file found by fs check, bounded time/output; run once per path.
    // nosemgrep: javascript.lang.security.detect-child-process -- fixed args, detected binary, no shell
    execFile(file, ['--version'], { timeout: 5000, maxBuffer: 16 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const v = err ? undefined : parseToolVersion(`${stdout}${stderr}`);
      versionCache.set(file, v);
      resolve(v);
    });
  });
}

export interface ToolOverrides {
  aws?: string;
  plugin?: string;
}

/** Cheap check (no exec): where would the tools be found? */
export function locateTools(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
  overrides: ToolOverrides = {},
): { aws?: string; plugin?: string } {
  const cand = candidateDirs(platform, env, home);
  const onPath = pathDirs(env, platform);
  const names = (n: typeof AWS_NAMES) => (platform === 'win32' ? n.win32 : n.other);
  const pick = (override: string | undefined, dirs: string[], name: string) =>
    override && path.isAbsolute(override) && isFile(override) ? override : findExecutable([...onPath, ...dirs], name, platform);
  return {
    aws: pick(overrides.aws, cand.aws, names(AWS_NAMES)),
    plugin: pick(overrides.plugin, cand.plugin, names(PLUGIN_NAMES)),
  };
}

/**
 * Directories that must be added to PATH so the ssh child can run the tools: only for a tool that
 * is NOT already resolvable through PATH. A tool PATH already resolves is left alone, so the user's
 * own command priority (and any other `aws` earlier on PATH) is never changed.
 */
export function toolDirsMissingFromPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string[] {
  const loc = locateTools(platform, env, home);
  const onPath = pathDirs(env, platform);
  const dirs: string[] = [];
  const check = (file: string | undefined, name: string) => {
    if (file && !findExecutable(onPath, name, platform)) dirs.push((platform === 'win32' ? path.win32 : path).dirname(file));
  };
  check(loc.aws, platform === 'win32' ? AWS_NAMES.win32 : AWS_NAMES.other);
  check(loc.plugin, platform === 'win32' ? PLUGIN_NAMES.win32 : PLUGIN_NAMES.other);
  return dirs;
}

let cached: AwsSsmTools = { aws: { found: false }, plugin: { found: false } };

/** Detects both tools; versions are probed once per newly found path. Updates the sync cache. */
export async function detectAwsSsmTools(overrides: ToolOverrides = {}): Promise<AwsSsmTools> {
  const loc = locateTools(process.platform, process.env, os.homedir(), overrides);
  const status = async (file: string | undefined, isPlugin: boolean): Promise<AwsSsmToolStatus> => {
    if (!file) return { found: false };
    const version = await probeVersion(file);
    return { found: true, path: file, version, ok: isPlugin ? pluginStatusFromVersion(version) !== false : true };
  };
  cached = { aws: await status(loc.aws, false), plugin: await status(loc.plugin, true) };
  return cached;
}

/** Directories of the tools found by the last detection, for the synchronous ssh argument builder. */
export function getCachedToolDirs(): string[] {
  const dirs: string[] = [];
  for (const t of [cached.aws, cached.plugin]) if (t.found && t.path) dirs.push(path.dirname(t.path));
  return dirs;
}

/** Test hook. */
export function resetToolchainCache(): void {
  cached = { aws: { found: false }, plugin: { found: false } };
  versionCache.clear();
}
