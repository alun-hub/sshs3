import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { ProxyConfig, S3Config } from '@shared/types/storage';

/**
 * A file manager tab is saved to the session without its secrets (see `sanitizeTabConfigs`), so a tab
 * restored after a restart holds a connection config with no password, passphrase or secret key. The
 * profile it was opened from still has them, so they are filled back in from it, matched by profile id,
 * and only where the tab has none: a tab opened with its own secret keeps that one. A tab that does not
 * come from a saved profile (a quick `user@host`) is left as it is.
 */

function withProxyPassword<T extends { proxy?: ProxyConfig }>(config: T, saved: T): T {
  if (!config.proxy || config.proxy.password || !saved.proxy?.password) return config;
  return { ...config, proxy: { ...config.proxy, password: saved.proxy.password } };
}

export function withSavedSshSecrets(config: SSHConnectionConfig, profiles: SSHConnectionConfig[] | undefined): SSHConnectionConfig {
  const saved = profiles?.find((p) => p.id === config.id);
  if (!saved || saved.deletedAt || saved.authType !== config.authType) return config;
  let result = config;
  if (!result.password && saved.password) result = { ...result, password: saved.password };
  if (!result.passphrase && saved.passphrase) result = { ...result, passphrase: saved.passphrase };
  return withProxyPassword(result, saved);
}

export function withSavedS3Secrets(config: S3Config, profiles: S3Config[] | undefined): S3Config {
  const saved = profiles?.find((p) => p.id === config.id);
  if (!saved || saved.deletedAt) return config;
  let result = config;
  if (!result.secretAccessKey && saved.secretAccessKey) result = { ...result, secretAccessKey: saved.secretAccessKey };
  if (!result.sessionToken && saved.sessionToken) result = { ...result, sessionToken: saved.sessionToken };
  return withProxyPassword(result, saved);
}
