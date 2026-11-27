import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { ProxyConfig, S3Config } from '@shared/types/storage';

/**
 * A file manager tab is saved to the session without its secrets (see `sanitizeTabConfigs`), so a tab
 * restored after a restart holds a connection config with no password, passphrase or secret key. The
 * profile it was opened from still has them, so they are filled back in from it, matched by profile id,
 * and only where the tab has none: a tab opened with its own secret keeps that one. A tab that does not
 * come from a saved profile (a quick `user@host`) is left as it is.
 *
 * The session file is not trusted: if it was edited to point a tab at another server, the profile's secret
 * must not follow it there. A secret is therefore only filled in when the tab still names the same target
 * as the profile (SSH: host, port and user; S3: endpoint, region and access key; a proxy: its host and port).
 */

function sameProxyTarget(a?: ProxyConfig, b?: ProxyConfig): boolean {
  return Boolean(a && b) && a!.host === b!.host && a!.port === b!.port;
}

function withProxyPassword<T extends { proxy?: ProxyConfig }>(config: T, saved: T): T {
  if (!config.proxy || config.proxy.password || !saved.proxy?.password) return config;
  if (!sameProxyTarget(config.proxy, saved.proxy)) return config;
  return { ...config, proxy: { ...config.proxy, password: saved.proxy.password } };
}

/** True when two SSH configs name the same server account: host, port and user. */
function sameSshAccount(a: SSHConnectionConfig, b: SSHConnectionConfig): boolean {
  return a.host === b.host && (a.port ?? 22) === (b.port ?? 22) && a.username === b.username;
}

/**
 * True when the saved profile a connection came from now points somewhere else: another host, port, user or
 * jump host. The file manager keeps one connection per profile id, so opening SFTP with the outdated config
 * would leave the old server behind under that profile. A quick connection and a Team Vault profile have no
 * personal profile to compare with.
 */
export function profileTargetChanged(config: SSHConnectionConfig, profiles: SSHConnectionConfig[] | undefined): boolean {
  if (config.teamVaultProfileRef) return false;
  const saved = profiles?.find((p) => p.id === config.id);
  if (!saved || saved.deletedAt) return false;
  return !(
    sameSshAccount(saved, config) &&
    (saved.proxyJump ?? '') === (config.proxyJump ?? '') &&
    (saved.proxyJumpProfileId ?? '') === (config.proxyJumpProfileId ?? '')
  );
}

export function withSavedSshSecrets(config: SSHConnectionConfig, profiles: SSHConnectionConfig[] | undefined): SSHConnectionConfig {
  const saved = profiles?.find((p) => p.id === config.id);
  if (!saved || saved.deletedAt || saved.authType !== config.authType) return config;
  if (!sameSshAccount(saved, config)) return config;
  let result = config;
  if (!result.password && saved.password) result = { ...result, password: saved.password };
  if (!result.passphrase && saved.passphrase) result = { ...result, passphrase: saved.passphrase };
  return withProxyPassword(result, saved);
}

export function withSavedS3Secrets(config: S3Config, profiles: S3Config[] | undefined): S3Config {
  const saved = profiles?.find((p) => p.id === config.id);
  if (!saved || saved.deletedAt) return config;
  const sameTarget =
    (saved.endpoint ?? '') === (config.endpoint ?? '') &&
    saved.region === config.region &&
    saved.accessKeyId === config.accessKeyId;
  if (!sameTarget) return config;
  let result = config;
  if (!result.secretAccessKey && saved.secretAccessKey) result = { ...result, secretAccessKey: saved.secretAccessKey };
  if (!result.sessionToken && saved.sessionToken) result = { ...result, sessionToken: saved.sessionToken };
  return withProxyPassword(result, saved);
}
