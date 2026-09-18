import { safeStorage } from 'electron';

/**
 * Shared helpers for at-rest encryption of individual secret fields (e.g. a
 * saved SSH password) via Electron's OS-backed safeStorage (libsecret/
 * Keychain/DPAPI). Used by any local JSON store that persists credentials —
 * ProfileStore and SyncConfigStore — so the encryption behavior (including
 * the plaintext fallback when no OS keyring is available) stays consistent
 * and isn't duplicated.
 */

const ENC_PREFIX = 'enc:v1:';

/**
 * Returns false outside a running Electron app (e.g. under test) or when no
 * OS keyring backend exists, in which case secrets are persisted in
 * plaintext as a graceful fallback.
 */
export function isEncryptionAvailable(): boolean {
  try {
    return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function encryptSecretValue(value: string): string {
  if (!value) return value;
  try {
    if (isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
    }
  } catch {
    // Fall through and store as plaintext rather than losing the value.
  }
  return value;
}

export function decryptSecretValue(value: string): string {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) {
    return value;
  }
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
    if (isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
  } catch {
    // Undecryptable (e.g. moved to a machine/user without the original OS
    // keyring entry) — fall through and return the raw stored value.
  }
  return value;
}

export function transformSecretFields<T extends object>(
  entry: T,
  fields: Array<keyof T>,
  transform: (value: string) => string
): T {
  const result: T = { ...entry };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === 'string' && value) {
      result[field] = transform(value) as T[keyof T];
    }
  }
  return result;
}

/** Same as transformSecretFields, but also transforms `proxy.password` when present. */
export function transformEntrySecrets<T extends { proxy?: any }>(
  entry: T,
  fields: Array<keyof T>,
  transform: (value: string) => string
): T {
  const result = transformSecretFields(entry, fields, transform);
  if (result.proxy && typeof result.proxy.password === 'string' && result.proxy.password) {
    result.proxy = {
      ...result.proxy,
      password: transform(result.proxy.password),
    };
  }
  return result;
}
