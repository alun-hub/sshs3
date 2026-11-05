import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { S3Config } from '../../shared/types/storage';

/**
 * Secret handling for shared Team Vault profiles: what a non-admin may see (redaction) and what a
 * non-admin may write (guards). Pure functions, kept apart from `TeamVaultService` so the rules can
 * be tested directly. See `docs/team-vault-plan.md` (non-admin secret handling).
 */

/** A smartcard/FIDO2 PIN is never written to disk anywhere in this app (see
 * `ProfileStore.persist()`'s identical rule for local profiles) — dropped unconditionally on
 * every save, regardless of who's calling. Every other field on a shared profile (including
 * `pkcs11LibPath`/`agentPath`/`privateKeyPath`/`customCaPath`) is just a string that either
 * resolves on a given member's machine or silently doesn't — none of them execute anything on
 * their own, so there's nothing else to strip here. */
export function withoutPin(profile: SSHConnectionConfig): SSHConnectionConfig {
  if (!('pin' in profile)) return profile;
  const { pin: _pin, ...rest } = profile;
  return rest as SSHConnectionConfig;
}

/** Strips an SSH profile's secret fields for a non-admin reader, replacing them with booleans
 * the UI can use to show "a password is set" without ever seeing it — see
 * `TeamVaultService.getPayloadForRenderer`. */
export function redactSshSecrets(profile: SSHConnectionConfig): SSHConnectionConfig {
  const { password, passphrase, proxy, ...rest } = profile;
  return {
    ...rest,
    hasPassword: Boolean(password) || Boolean(passphrase),
    ...(proxy ? { proxy: { ...proxy, password: undefined, hasPassword: Boolean(proxy.password) } } : {}),
  };
}

/** Strips an S3 profile's secret fields for a non-admin reader — see `redactSshSecrets`.
 * Includes `proxy.password` (the S3 traffic proxy's credential, same shape as the SSH one) —
 * easy to miss since it lives one level down from the fields this is named after. Also reused by
 * `IpcBridge.buildTeamVaultStatus` to redact the vault's own sync *target* config before it ever
 * reaches the renderer (not just member profiles) — the target's secret is shared team
 * infrastructure, not a single member's own credential, so it gets no exception. */
export function redactS3Secrets(profile: S3Config): S3Config {
  const { secretAccessKey, sessionToken, proxy, ...rest } = profile;
  return {
    ...rest,
    secretAccessKey: '',
    hasSecretAccessKey: Boolean(secretAccessKey) || Boolean(sessionToken),
    ...(proxy ? { proxy: { ...proxy, password: undefined, hasPassword: Boolean(proxy.password) } } : {}),
  };
}

/** True when `incoming` is a non-empty value that differs from `existing` — i.e. a genuine
 * attempt to set/change a secret, as opposed to a redacted/untouched field round-tripping back
 * unchanged (always falsy or identical, since a non-admin never receives the real value in the
 * first place — see `getPayloadForRenderer`). */
export function isSecretChangeAttempt(incoming: string | undefined, existing: string | undefined): boolean {
  return Boolean(incoming) && incoming !== existing;
}

/** Whether an SSH profile currently has any secret worth protecting. */
export function hasSshSecret(profile: SSHConnectionConfig | undefined): boolean {
  return Boolean(profile?.password || profile?.passphrase || profile?.proxy?.password);
}

/** Whether `incoming` changes where a connection actually goes relative to `existing` — the
 * host/port/username/auth-type it connects as, or the proxy/jump host it routes through. A
 * non-admin allowed to edit these on a profile with no secret must NOT also be allowed to edit
 * them on one that has a secret: otherwise they could repoint an admin-set password at a server
 * of their own choosing and have it delivered there on the next connect (by themselves via
 * `resolveProfileForConnect`, or by anyone else who later connects using the edited profile) —
 * `guardSshSecretWrite` rejects such a change outright instead of silently keeping the old
 * routing (the user asked for host/port to stay member-editable, which this still allows on
 * secret-less profiles and for every other field regardless). */
export function sshRoutingChanged(incoming: SSHConnectionConfig, existing: SSHConnectionConfig): boolean {
  return (
    incoming.host !== existing.host ||
    (incoming.port ?? 22) !== (existing.port ?? 22) ||
    incoming.username !== existing.username ||
    incoming.authType !== existing.authType ||
    incoming.proxyJump !== existing.proxyJump ||
    incoming.proxyJumpProfileId !== existing.proxyJumpProfileId ||
    Boolean(incoming.proxy?.enabled) !== Boolean(existing.proxy?.enabled) ||
    (incoming.proxy?.host ?? '') !== (existing.proxy?.host ?? '') ||
    (incoming.proxy?.port ?? 0) !== (existing.proxy?.port ?? 0) ||
    (incoming.proxy?.type ?? '') !== (existing.proxy?.type ?? '') ||
    (incoming.proxy?.username ?? '') !== (existing.proxy?.username ?? '')
  );
}

/** Enforces that only an admin may set or change an SSH profile's secret fields
 * (`password`/`passphrase`/`proxy.password`) — see `TeamVaultService.saveSSHProfile`. Throws if
 * a non-admin's incoming value for any of these is a genuine change attempt, or if a non-admin
 * tries to change where a profile with a stored secret actually connects (see
 * `sshRoutingChanged`'s doc comment — that's an exfiltration path, not a harmless edit).
 * Otherwise the previously stored secret value (if any) is kept, discarding whatever
 * blank/redacted value the non-admin's own copy of the field held. */
export function guardSshSecretWrite(incoming: SSHConnectionConfig, existing: SSHConnectionConfig | undefined): SSHConnectionConfig {
  if (
    isSecretChangeAttempt(incoming.password, existing?.password) ||
    isSecretChangeAttempt(incoming.passphrase, existing?.passphrase) ||
    isSecretChangeAttempt(incoming.proxy?.password, existing?.proxy?.password) ||
    (hasSshSecret(existing) && existing && sshRoutingChanged(incoming, existing))
  ) {
    throw new Error('Only a Team Vault admin can set or change a profile password, or where it connects');
  }
  return {
    ...incoming,
    password: existing?.password,
    passphrase: existing?.passphrase,
    ...(incoming.proxy ? { proxy: { ...incoming.proxy, password: existing?.proxy?.password } } : {}),
  };
}

/** Whether `incoming` changes where an S3 profile's credentials actually get sent, or how safely
 * they get there, relative to `existing` — same reasoning as `sshRoutingChanged`, applied to
 * `endpoint`/`region`/`forcePathStyle` (a custom endpoint is how S3Config picks a non-AWS host),
 * `accessKeyId` (pairing a different key id with the stored secret is the same kind of tamper,
 * even though it can't change the request's destination on its own), and `rejectUnauthorized`/
 * `customCaPath` — both feed straight into `S3StorageProvider`'s TLS config, so a non-admin
 * could otherwise leave the endpoint untouched but disable certificate validation or substitute
 * a CA they control, exposing the secret (and all transferred data) to a network MITM without
 * ever touching a field this guard was already watching. */
export function s3RoutingChanged(incoming: S3Config, existing: S3Config): boolean {
  return (
    (incoming.endpoint ?? '') !== (existing.endpoint ?? '') ||
    incoming.region !== existing.region ||
    Boolean(incoming.forcePathStyle) !== Boolean(existing.forcePathStyle) ||
    incoming.accessKeyId !== existing.accessKeyId ||
    // Not Boolean()-coerced: `undefined` (default, validates) and `false` (explicitly disabled)
    // are different states here, unlike the other boolean fields in this function.
    incoming.rejectUnauthorized !== existing.rejectUnauthorized ||
    (incoming.customCaPath ?? '') !== (existing.customCaPath ?? '') ||
    Boolean(incoming.proxy?.enabled) !== Boolean(existing.proxy?.enabled) ||
    (incoming.proxy?.host ?? '') !== (existing.proxy?.host ?? '') ||
    (incoming.proxy?.port ?? 0) !== (existing.proxy?.port ?? 0)
  );
}

/** Same as `guardSshSecretWrite`, for an S3 profile's `secretAccessKey`/`sessionToken`/
 * `proxy.password` and `s3RoutingChanged`. */
export function guardS3SecretWrite(incoming: S3Config, existing: S3Config | undefined): S3Config {
  const existingHasSecret = Boolean(existing?.secretAccessKey || existing?.sessionToken || existing?.proxy?.password);
  if (
    isSecretChangeAttempt(incoming.secretAccessKey, existing?.secretAccessKey) ||
    isSecretChangeAttempt(incoming.sessionToken, existing?.sessionToken) ||
    isSecretChangeAttempt(incoming.proxy?.password, existing?.proxy?.password) ||
    (existingHasSecret && existing && s3RoutingChanged(incoming, existing))
  ) {
    throw new Error('Only a Team Vault admin can set or change a profile secret key, or where it connects');
  }
  return {
    ...incoming,
    secretAccessKey: existing?.secretAccessKey ?? '',
    sessionToken: existing?.sessionToken,
    ...(incoming.proxy ? { proxy: { ...incoming.proxy, password: existing?.proxy?.password } } : {}),
  };
}
