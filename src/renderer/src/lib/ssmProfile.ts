import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { SshSsmConfig } from '@shared/types/ssm';
import { validateSsmConfig } from '@shared/ssm';

/** Sets/clears the SSM option. SSM owns the route to the instance, so a jump host or outgoing proxy is dropped. */
export function withSsm(config: SSHConnectionConfig, ssm: SshSsmConfig | undefined): SSHConnectionConfig {
  return { ...config, ssm, ...(ssm ? { proxy: undefined, proxyJump: undefined, proxyJumpProfileId: undefined } : {}) };
}

/** First problem that would make the main process refuse this SSM profile at connect time, or undefined. */
export function ssmProblem(config: Pick<SSHConnectionConfig, 'host' | 'ssm'>): string | undefined {
  const ssm = config.ssm;
  if (!ssm?.enabled) return undefined;
  const base = validateSsmConfig(ssm, config.host.trim());
  if (base) return base;
  if (ssm.sso && (!ssm.sso.accountId || !ssm.sso.roleName)) return 'Enter the SSO account ID and role name';
  return undefined;
}

/** Whether the profile can be saved: a hostname, and with SSM on, settings the connect path will accept. */
export function hostIsValid(config: Pick<SSHConnectionConfig, 'host' | 'ssm'>): boolean {
  return config.host.trim() !== '' && ssmProblem(config) === undefined;
}
