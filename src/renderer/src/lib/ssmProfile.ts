import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { SshSsmConfig } from '@shared/types/ssm';
import { isValidInstanceId } from '@shared/ssm';

/** Sets/clears the SSM option. SSM owns the route to the instance, so a jump host or outgoing proxy is dropped. */
export function withSsm(config: SSHConnectionConfig, ssm: SshSsmConfig | undefined): SSHConnectionConfig {
  return { ...config, ssm, ...(ssm ? { proxy: undefined, proxyJump: undefined, proxyJumpProfileId: undefined } : {}) };
}

/** Whether the hostname is acceptable: with SSM on it must be an instance id. */
export function hostIsValid(config: Pick<SSHConnectionConfig, 'host' | 'ssm'>): boolean {
  return config.host.trim() !== '' && (!config.ssm?.enabled || isValidInstanceId(config.host.trim()));
}
