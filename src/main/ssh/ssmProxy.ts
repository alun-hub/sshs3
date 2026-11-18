import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { SshSsmConfig } from '../../shared/types/ssm';
import { awsNetworkEnv } from '../../shared/awsSignIns';
import { getAwsNetworkSettings } from '../aws/awsNetworkSettings';
import { toolDirsMissingFromPath } from '../aws/AwsSsmToolchain';
import { ensureSsoConfigFile, ssoProfileName } from '../aws/ssoConfigFile';
import { SSM_START_SESSION_POSIX, SSM_START_SESSION_WINDOWS, validateSsmConfig } from '../../shared/ssm';

/**
 * Credential variables that would silently change which AWS identity the session uses. Scrubbed only
 * when sshs3 picked the credential source (`awsProfile` / `sso`); the default-chain mode leaves the
 * user's environment alone. AWS_PROFILE / AWS_DEFAULT_PROFILE are deliberately not listed: `--profile`
 * overrides them (verified on aws-cli 2.38) and an empty value is *not* treated as unset by the CLI.
 */
export const AWS_CREDENTIAL_ENV = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'] as const;
/** Config-location variables: scrubbed only for `sso`, where sshs3 supplies its own config file. */
export const AWS_CONFIG_ENV = ['AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE'] as const;

let ssmAllowed = true;
/** Machine policy switch (`awsSsm`), set once at startup by IpcBridge; enforced in assertValidSsm for every ssh spawn. */
export function setSsmAllowed(allowed: boolean): void {
  ssmAllowed = allowed;
}

/**
 * Throws when the SSM settings cannot be used. Called from buildSSHArguments, the single point
 * of use, so a hostile synced/imported profile can never reach the shell-run ProxyCommand.
 */
export function assertValidSsm(config: SSHConnectionConfig): void {
  const ssm = config.ssm;
  if (!ssm?.enabled) return;
  if (!ssmAllowed) throw new Error('SSH over AWS SSM is disabled by your administrator');
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
  // The instance's region, never the Identity Center home region (they routinely differ).
  const region = ssm.region;
  const profile = profileName ?? ssm.awsProfile;
  let extra = '';
  if (region) extra += ` --region ${region}`;
  if (profile) extra += ` --profile ${profile}`;
  return platform === 'win32' ? SSM_START_SESSION_WINDOWS(extra) : SSM_START_SESSION_POSIX(extra);
}

/**
 * Environment for the ssh child: drops ambient AWS credential variables (and, for `sso`, config-location variables), prepends the
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
  // the AWS CLI treats an empty value as unset for these keys (verified on aws-cli 2.38). Windows env
  // names are case-insensitive, so each name is emitted once, in the casing the base env already uses.
  const nameIn = (name: string): string =>
    platform === 'win32' ? (Object.keys(baseEnv).find((k) => k.toUpperCase() === name) ?? name) : name;
  const overlay: Record<string, string> = {};
  if (ssm.sso || ssm.awsProfile) for (const n of AWS_CREDENTIAL_ENV) overlay[nameIn(n)] = '';
  if (ssm.sso) {
    for (const n of AWS_CONFIG_ENV) overlay[nameIn(n)] = '';
    if (ssoConfigFile) overlay[nameIn('AWS_CONFIG_FILE')] = ssoConfigFile;
  }

  const sep = platform === 'win32' ? ';' : ':';
  const key = Object.keys(baseEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const current = baseEnv[key];
  // Only directories not already on PATH are added, so existing command priority is never reshuffled.
  const onPath = new Set((current ?? '').split(sep));
  const dirs = [...new Set(toolDirs.filter((d) => (path.isAbsolute(d) || /^[A-Za-z]:\\/.test(d)) && !onPath.has(d)))];
  if (dirs.length > 0) {
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

const ensured = new Map<string, string>();
/** App-owned SSO config path for the profile; written once per process unless the file went missing. */
function ssoConfigPath(sso: NonNullable<SshSsmConfig['sso']>): string {
  const name = ssoProfileName(sso);
  const known = ensured.get(name);
  if (known && fs.existsSync(known)) return known;
  const file = ensureSsoConfigFile(sso, appDataDir());
  ensured.set(name, file);
  return file;
}

/** `-o ProxyCommand=…` for an SSM profile (writes the app-owned SSO config when needed). */
export function ssmProxyOption(config: SSHConnectionConfig): string | undefined {
  const ssm = config.ssm;
  if (!ssm?.enabled) return undefined;
  const profile = ssm.sso ? ssoProfileName(ssm.sso) : undefined;
  if (ssm.sso) ssoConfigPath(ssm.sso);
  return `ProxyCommand=${buildSsmProxyCommand(ssm, process.platform, profile)}`;
}

/** Env overlay for an SSM profile; empty for other profiles. */
export function ssmEnvOverlay(config: SSHConnectionConfig): Record<string, string> {
  const ssm = config.ssm;
  if (!ssm?.enabled) return {};
  const dirs = toolDirsMissingFromPath();
  const cfg = ssm.sso ? ssoConfigPath(ssm.sso) : undefined;
  // The CLI needs the same proxy/CA as sshs3's own AWS calls; both are plain environment values, never credentials.
  return { ...awsNetworkEnv(getAwsNetworkSettings()), ...buildSsmEnv(ssm, dirs, process.env, process.platform, cfg) };
}
