import { isSsmShellProfile } from '@shared/ssm';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { SshSsmConfig } from '@shared/types/ssm';
import { validateSsmConfig } from '@shared/ssm';

/** Sets/clears the SSM option. SSM owns the route to the instance, so a jump host or outgoing proxy is dropped. */
export function withSsm(
  config: SSHConnectionConfig,
  ssm: SshSsmConfig | undefined,
  extra?: { host?: string; username?: string }
): SSHConnectionConfig {
  return {
    ...config,
    ssm,
    ...(ssm ? { proxy: undefined, proxyJump: undefined, proxyJumpProfileId: undefined } : {}),
    ...(extra?.host ? { host: extra.host } : {}),
    ...(extra?.username ? { username: extra.username } : {}),
  };
}

/** First problem that would make the main process refuse this SSM profile at connect time, or undefined. */
export function ssmProblem(config: Pick<SSHConnectionConfig, 'host' | 'ssm'> & Partial<Pick<SSHConnectionConfig, 'proxy' | 'proxyJump' | 'proxyJumpProfileId'>>): string | undefined {
  const ssm = config.ssm;
  if (!ssm?.enabled) return undefined;
  const base = validateSsmConfig(ssm, config.host.trim());
  if (base) return base;
  if (ssm.sso && (!ssm.sso.accountId || !ssm.sso.roleName)) return 'Enter the SSO account ID and role name';
  // Enabling SSM clears these, but the form lets them be switched on again afterwards; the connect path refuses the mix.
  if (config.proxy?.enabled || config.proxyJump?.trim() || config.proxyJumpProfileId) return 'Turn off the jump host and the outgoing proxy: they cannot be combined with SSM';
  return undefined;
}

/** Whether the profile can be saved: a hostname, and with SSM on, settings the connect path will accept. */
export function hostIsValid(config: Parameters<typeof ssmProblem>[0]): boolean {
  return config.host.trim() !== '' && ssmProblem(config) === undefined;
}

/**
 * Hostname and username as saved: surrounding whitespace (typically from copy-paste) is dropped. Validation already
 * ignores it, so saving the untrimmed value made a profile that passed the form but was refused at connect time.
 */
export function trimProfileFields<T extends { host: string; username: string }>(config: T): T {
  return { ...config, host: config.host.trim(), username: config.username.trim() };
}

/** Whether the SSH username is filled in; a Session Manager shell has no SSH login, so it may be empty. */
export function usernameOk(config: Pick<SSHConnectionConfig, 'username' | 'ssm'>): boolean {
  return config.username.trim() !== '' || isSsmShellProfile(config);
}

/** ` · <auth type>` for a row's subtitle; empty for a Session Manager shell, which has no SSH login. */
export function authSuffix(p: Pick<SSHConnectionConfig, 'authType' | 'ssm'>): string {
  return isSsmShellProfile(p) ? '' : ` · ${p.authType}`;
}

/** The `user@host:port · auth` line of a profile row; a Session Manager shell shows what it is instead. */
export function profileTarget(p: Pick<SSHConnectionConfig, 'username' | 'host' | 'port' | 'authType' | 'ssm'>, suffix: string): string {
  if (isSsmShellProfile(p)) return `Session Manager shell · ${p.host}${suffix}`;
  return `${p.username}@${p.host}:${p.port ?? 22}${suffix}`;
}
