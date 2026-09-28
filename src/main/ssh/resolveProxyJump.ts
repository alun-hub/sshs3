import type { SSHConnectionConfig } from '../../shared/types/ssh';

interface ProxyJumpSource {
  proxyJumpProfileId?: string;
  proxyJump?: string;
}

/**
 * Turns `proxyJumpProfileId` into the `user@host[:port]` string OpenSSH's `-J`/`ProxyJump`
 * expects, so callers building ssh args never need to know profiles can reference each other.
 * Only host/user/port are pulled from the referenced profile — ProxyJump reuses whatever
 * identity/agent options are already on the outer ssh invocation for both hops, so a jump host
 * needing different credentials than the destination isn't specially handled here.
 */
export function resolveProxyJumpTarget(
  config: ProxyJumpSource,
  getProfile: (id: string) => SSHConnectionConfig | undefined
): string | undefined {
  if (config.proxyJumpProfileId) {
    const jumpProfile = getProfile(config.proxyJumpProfileId);
    if (jumpProfile) {
      const port = jumpProfile.port && jumpProfile.port !== 22 ? `:${jumpProfile.port}` : '';
      return `${jumpProfile.username}@${jumpProfile.host}${port}`;
    }
  }
  return config.proxyJump?.trim() || undefined;
}

/** Returns `config` with `proxyJump` resolved and `proxyJumpProfileId` stripped, ready for any ssh-arg builder that only understands the raw `proxyJump` string. */
export function withResolvedProxyJump<T extends ProxyJumpSource>(
  config: T,
  getProfile: (id: string) => SSHConnectionConfig | undefined
): T {
  if (!config.proxyJumpProfileId && !config.proxyJump) return config;
  const resolved = resolveProxyJumpTarget(config, getProfile);
  return { ...config, proxyJump: resolved, proxyJumpProfileId: undefined };
}
