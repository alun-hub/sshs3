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
  const common = ['/usr/local/bin', '/usr/bin', '/snap/bin', path.posix.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/home/linuxbrew/.linuxbrew/bin'];
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
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  for (const d of dirs) {
    const candidate = join(d, name);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

const versionCache = new Map<string, string>();

function fingerprint(file: string): string | undefined {
  try {
    const st = fs.statSync(file);
    return `${file}|${st.mtimeMs}|${st.size}`;
  } catch {
    return undefined;
  }
}

/** Version of the tool; cached per file *version* (path+mtime+size) so an in-place upgrade is noticed, and failures are never cached. */
function probeVersion(file: string): Promise<string | undefined> {
  const key = fingerprint(file);
  const hit = key ? versionCache.get(key) : undefined;
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    // Fixed argument, absolute file found by fs check, bounded time/output; run once per file version.
    // nosemgrep: javascript.lang.security.detect-child-process -- fixed args, detected binary, no shell
    execFile(file, ['--version'], { timeout: 5000, maxBuffer: 16 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const v = err ? undefined : parseToolVersion(`${stdout}${stderr}`);
      if (v && key) versionCache.set(key, v);
      resolve(v);
    });
  });
}

interface Located {
  file: string;
  /** Resolved through PATH itself (as opposed to a fixed install folder). */
  viaPath: boolean;
}

function locate(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): { aws?: Located; plugin?: Located } {
  const cand = candidateDirs(platform, env, home);
  const onPath = pathDirs(env, platform);
  const names = (n: typeof AWS_NAMES) => (platform === 'win32' ? n.win32 : n.other);
  const find = (dirs: string[], name: string): Located | undefined => {
    const viaPath = findExecutable(onPath, name, platform);
    if (viaPath) return { file: viaPath, viaPath: true };
    const file = findExecutable(dirs, name, platform);
    return file ? { file, viaPath: false } : undefined;
  };
  return { aws: find(cand.aws, names(AWS_NAMES)), plugin: find(cand.plugin, names(PLUGIN_NAMES)) };
}

/** Cheap check (no exec): where would the tools be found? PATH wins over the fixed install folders. */
export function locateTools(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): { aws?: string; plugin?: string } {
  const l = locate(platform, env, home);
  return { aws: l.aws?.file, plugin: l.plugin?.file };
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
  const dirname = platform === 'win32' ? path.win32.dirname : path.dirname;
  const l = locate(platform, env, home);
  return [l.aws, l.plugin].filter((t): t is Located => !!t && !t.viaPath).map((t) => dirname(t.file));
}

/** Detects both tools; versions are probed once per tool file version (see probeVersion). */
export async function detectAwsSsmTools(): Promise<AwsSsmTools> {
  const loc = locateTools();
  const status = async (file: string | undefined, isPlugin: boolean): Promise<AwsSsmToolStatus> => {
    if (!file) return { found: false };
    const version = await probeVersion(file);
    return { found: true, path: file, version, ok: isPlugin ? pluginStatusFromVersion(version) !== false : true };
  };
  const [aws, plugin] = await Promise.all([status(loc.aws, false), status(loc.plugin, true)]);
  return { aws, plugin };
}
