import type { AwsSsoConfig } from './types/aws';
import type { SshSsmConfig } from './types/ssm';

/**
 * Pure helpers for SSH over AWS Systems Manager. Everything here that ends up in a shell-run
 * ProxyCommand or in an AWS config file is validated against a strict allowlist: a rejected
 * value must never be "cleaned up" and used anyway.
 */

/**
 * AWS-documented ProxyCommand forms ("Allowing and controlling permissions for SSH connections
 * through Session Manager", https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-enable-ssh-connections.html,
 * checked 2026-11-17). `%h` is the instance id (the profile's host) and `%p` the port, both expanded by ssh.
 */
export const SSM_START_SESSION_POSIX = (extra: string): string =>
  `sh -c "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters 'portNumber=%p'${extra}"`;
export const SSM_START_SESSION_WINDOWS = (extra: string): string =>
  `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p${extra}"`;

/** Minimum Session Manager plugin version for SSH sessions (AWS docs, checked 2026-11-17). */
export const MIN_PLUGIN_VERSION = '1.1.23.0';
/** Minimum SSM Agent version on the instance (informational, shown in the UI). */
export const MIN_AGENT_VERSION = '2.3.672.0';

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const AWS_PROFILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const INSTANCE_ID = /^(i-([0-9a-f]{8}|[0-9a-f]{17})|mi-[0-9a-f]{17})$/;
const ACCOUNT_ID = /^\d{12}$/;
const ROLE_NAME = /^[\w+=,.@-]{1,64}$/;
const START_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~%/-]*)?$/;

export function isValidRegion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32 && REGION.test(value);
}

export function isValidAwsProfile(value: unknown): value is string {
  return typeof value === 'string' && AWS_PROFILE.test(value);
}

export function isValidInstanceId(value: unknown): value is string {
  return typeof value === 'string' && INSTANCE_ID.test(value);
}

export function isValidSsoConfig(value: unknown): value is AwsSsoConfig {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.startUrl !== 'string' || s.startUrl.length > 512 || !START_URL.test(s.startUrl)) return false;
  if (!isValidRegion(s.region)) return false;
  if (s.accountId !== undefined && !(typeof s.accountId === 'string' && ACCOUNT_ID.test(s.accountId))) return false;
  if (s.roleName !== undefined && !(typeof s.roleName === 'string' && ROLE_NAME.test(s.roleName))) return false;
  return true;
}

/** First problem with an SSM config as a short message, or undefined when it is usable. */
export function validateSsmConfig(ssm: SshSsmConfig, host: unknown): string | undefined {
  if (!isValidInstanceId(host)) return 'Instance ID must look like i-0123456789abcdef0 (or mi-… for a hybrid node)';
  if (ssm.region !== undefined && !isValidRegion(ssm.region)) return 'Invalid AWS region';
  if (ssm.awsProfile !== undefined && !isValidAwsProfile(ssm.awsProfile)) return 'Invalid AWS CLI profile name';
  if (ssm.sso !== undefined && !isValidSsoConfig(ssm.sso)) return 'Invalid AWS SSO settings';
  if (ssm.awsProfile !== undefined && ssm.sso !== undefined) return 'Choose either an AWS CLI profile or SSO sign-in, not both';
  return undefined;
}

/** Field-wise equality of two SSM settings (independent of key order and undefined-vs-absent). */
export function ssmEqual(a: SshSsmConfig | undefined, b: SshSsmConfig | undefined): boolean {
  if (!a?.enabled || !b?.enabled) return Boolean(a?.enabled) === Boolean(b?.enabled);
  return (
    (a.region ?? '') === (b.region ?? '') &&
    (a.awsProfile ?? '') === (b.awsProfile ?? '') &&
    (a.sso?.startUrl ?? '') === (b.sso?.startUrl ?? '') &&
    (a.sso?.region ?? '') === (b.sso?.region ?? '') &&
    (a.sso?.accountId ?? '') === (b.sso?.accountId ?? '') &&
    (a.sso?.roleName ?? '') === (b.sso?.roleName ?? '') &&
    Boolean(a.sso) === Boolean(b.sso) &&
    (a.awsProfile === undefined) === (b.awsProfile === undefined)
  );
}

/** Compares dotted numeric versions ("1.2.707.0"); returns <0, 0, >0. Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Extracts the version from `session-manager-plugin --version` / `aws --version` output. */
export function parseToolVersion(output: string): string | undefined {
  const m = /(\d+(?:\.\d+){1,3})/.exec(output.slice(0, 512));
  return m?.[1];
}

/** Default SSH login names per EC2 User Guide (checked 2026-11-17); best effort, unknown → ec2-user. */
export function suggestLoginName(platformName: string | undefined): string {
  const p = (platformName ?? '').toLowerCase();
  if (p.includes('ubuntu')) return 'ubuntu';
  if (p.includes('debian')) return 'admin';
  if (p.includes('fedora')) return 'fedora';
  if (p.includes('centos')) return 'centos';
  if (p.includes('rocky')) return 'rocky';
  if (p.includes('bitnami')) return 'bitnami';
  return 'ec2-user';
}
