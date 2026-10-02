import type { SSHConnectionConfig } from '@shared/types/ssh';

/**
 * What is still missing before a profile can be tested or have keys installed on it, or null when it is
 * complete enough. The Access panel is blocked on this instead of letting the user into a flow that cannot work.
 */
export function accessConfigProblem(config: SSHConnectionConfig): string | null {
  if (!config.host.trim() || !config.username.trim()) return 'Fill in host and user first.';
  if (config.authType === 'smartcard' && !config.pkcs11LibPath?.trim()) {
    return 'Choose a PKCS#11 library first.';
  }
  if (config.authType === 'fido2' && !config.fido2Resident && !config.privateKeyPath?.trim()) {
    return 'Choose a key file first, or enable "Resident key on device".';
  }
  return null;
}
