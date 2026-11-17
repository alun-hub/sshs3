import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { SshSsmConfig } from '../../shared/types/ssm';
import { locateTools } from '../aws/AwsSsmToolchain';
import { ensureSsoConfigFile, ssoProfileName } from '../aws/ssoConfigFile';
import { SSM_START_SESSION_POSIX, SSM_START_SESSION_WINDOWS, validateSsmConfig } from '../../shared/ssm';

/**
 * Env vars that would silently change which AWS identity the session uses. Scrubbed only when
 * sshs3 picked the credential source (`awsProfile` / `sso`); the default-chain mode leaves the
 * user's environment alone. AWS_PROFILE / AWS_DEFAULT_PROFILE are deliberately not listed: the
 * `--profile` option overrides them (verified on aws-cli 2.38, see tests/main/ssmProxy.test.ts
 * notes) and an empty value is *not* treated as unset by the CLI (it errors "profile () not found").
 */
export const AWS_ENV_SCRUB = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
] as const;

/**
 * Throws when the SSM settings cannot be used. Called from buildSSHArguments, the single point
 * of use, so a hostile synced/imported profile can never reach the shell-run ProxyCommand.
 */
export function assertValidSsm(config: SSHConnectionConfig): void {
  const ssm = config.ssm;
  if (!ssm?.enabled) return;
  const problem = validateSsmConfig(ssm, config.host);
  if (problem) throw new Error(`Invalid AWS SSM settings: ${problem}`);
  if (config.proxy?.enabled || config.proxyJump?.trim() || config.proxyJumpProfileId) {
    throw new Error('AWS SSM cannot be combined with a jump host or an outgoing proxy');
  }
}

/**
 * The ProxyCommand value for an SSM profile. Only validated literals are interpolated (region and
 * profile name come from strict allowlists, see assertValidSsm); no file path ever appears in it —
 * the aws CLI is found through PATH (see buildSsmEnv).
 * @param profileName CLI profile to pass as --profile (app-owned SSO profile or the user's own)
 */
export function buildSsmProxyCommand(ssm: SshSsmConfig, platform: NodeJS.Platform, profileName?: string): string {
  const region = ssm.region ?? ssm.sso?.region;
  const profile = profileName ?? ssm.awsProfile;
  let extra = '';
  if (region) extra += ` --region ${region}`;
  if (profile) extra += ` --profile ${profile}`;
  return platform === 'win32' ? SSM_START_SESSION_WINDOWS(extra) : SSM_START_SESSION_POSIX(extra);
}

/**
 * Environment for the ssh child: drops ambient AWS credential/profile variables, prepends the
 * directories of the detected tools to PATH (keeping the existing key's exact casing — Windows
 * uses `Path`) and points AWS_CONFIG_FILE at the app-owned config for `ssm.sso`.
 * Returns only the overlay to spread over the base environment.
 */
export function buildSsmEnv(
  ssm: SshSsmConfig,
  toolDirs: string[],
  baseEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  ssoConfigFile?: string,
): Record<string, string> {
  // Scrubbed variables are set to '' rather than removed: callers spread this over process.env, and
  // the AWS CLI treats an empty value as unset for these keys (verified on aws-cli 2.38).
  const overlay: Record<string, string> = {};
  if (ssm.sso || ssm.awsProfile) {
    for (const k of Object.keys(baseEnv)) {
      if ((AWS_ENV_SCRUB as readonly string[]).includes(platform === 'win32' ? k.toUpperCase() : k)) overlay[k] = '';
    }
    for (const k of AWS_ENV_SCRUB) overlay[k] = '';
  }
  if (ssm.sso && ssoConfigFile) overlay.AWS_CONFIG_FILE = ssoConfigFile;

  const dirs = [...new Set(toolDirs.filter((d) => path.isAbsolute(d) || /^[A-Za-z]:\\/.test(d)))];
  if (dirs.length > 0) {
    const sep = platform === 'win32' ? ';' : ':';
    const key = Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const current = baseEnv[key];
    overlay[key] = current ? `${dirs.join(sep)}${sep}${current}` : dirs.join(sep);
  }
  return overlay;
}

function appDataDir(): string {
  try {
    return app.getPath('userData');
  } catch {
    return path.join(os.homedir(), '.sshs3');
  }
}

/** `-o ProxyCommand=…` for an SSM profile (writes the app-owned SSO config when needed). */
export function ssmProxyOption(config: SSHConnectionConfig): string | undefined {
  const ssm = config.ssm;
  if (!ssm?.enabled) return undefined;
  const profile = ssm.sso ? ssoProfileName(ssm.sso) : undefined;
  if (ssm.sso) ensureSsoConfigFile(ssm.sso, appDataDir());
  return `ProxyCommand=${buildSsmProxyCommand(ssm, process.platform, profile)}`;
}

/** Env overlay for an SSM profile; empty for other profiles. */
export function ssmEnvOverlay(config: SSHConnectionConfig): Record<string, string> {
  const ssm = config.ssm;
  if (!ssm?.enabled) return {};
  const tools = locateTools();
  const dirs = [tools.aws, tools.plugin].filter((f): f is string => !!f).map((f) => path.dirname(f));
  const cfg = ssm.sso ? ensureSsoConfigFile(ssm.sso, appDataDir()) : undefined;
  return buildSsmEnv(ssm, dirs, process.env, process.platform, cfg);
}
