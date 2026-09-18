import crypto from 'node:crypto';
import type { SyncDataCategory, SyncKeyGroup } from '../../shared/types/sync';

export type { SyncDataCategory, SyncKeyGroup };

const CATEGORY_TO_GROUP: Record<SyncDataCategory, SyncKeyGroup> = {
  topology: 'topology',
  settings: 'topology',
  credentials: 'credentials',
  'dotfile-pools': 'credentials',
  'ssh-native': 'credentials',
};

const FORMAT_VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HEADER_LENGTH = 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  /** Passed through to Node's scrypt as `maxmem`; must cover 128*N*r bytes. */
  maxmem: number;
}

/**
 * scrypt cost parameters for deriving a 256-bit key from the master
 * password. N=2^17/r=8/p=1 (~128 MiB, roughly 1-2s on typical hardware) is
 * intentionally expensive: the threat model is offline brute-forcing of a
 * stolen encrypted file, not an online rate-limited login, and this runs
 * once per unlock, not per keystroke.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 1 << 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
};

export class SyncDecryptionError extends Error {
  constructor(message = 'Wrong master password or corrupted sync file') {
    super(message);
    this.name = 'SyncDecryptionError';
  }
}

export class SyncLockedError extends Error {
  constructor(group: SyncKeyGroup) {
    super(`Sync key group "${group}" is locked; call unlock() first or supply a password to decrypt().`);
    this.name = 'SyncLockedError';
  }
}

export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Derives a 256-bit key from a master password and salt via scrypt. This is
 * deliberately slow (see DEFAULT_SCRYPT_PARAMS) — callers should run it once
 * at unlock time and cache the result, never per encrypt/decrypt call.
 */
export function deriveKey(password: string, salt: Buffer, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): Buffer {
  return crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: params.maxmem,
  });
}

interface CachedKey {
  key: Buffer;
  salt: Buffer;
}

/**
 * Zero-knowledge AES-256-GCM encryption for remote profile sync payloads.
 *
 * Each key group's salt is generated once (at `unlock`, or read from the
 * first downloaded file during bootstrap) and reused for every subsequent
 * encrypt/decrypt call in that group — only the derived key is cached, not
 * re-derived per file. Only the IV is fresh on every single encryption, as
 * AES-GCM requires.
 *
 * File layout: [formatVersion(1)][salt(16)][iv(12)][authTag(16)][ciphertext]
 */
export class SyncCryptoService {
  private readonly scryptParams: ScryptParams;
  private readonly keys = new Map<SyncKeyGroup, CachedKey>();

  constructor(scryptParams: ScryptParams = DEFAULT_SCRYPT_PARAMS) {
    this.scryptParams = scryptParams;
  }

  /** Derives and caches the key for a group. Expensive — call once, not per file. */
  unlock(group: SyncKeyGroup, password: string, salt: Buffer): void {
    this.keys.set(group, { key: deriveKey(password, salt, this.scryptParams), salt: Buffer.from(salt) });
  }

  /** Drops all cached keys from memory (e.g. on app lock/quit). */
  lock(): void {
    this.keys.clear();
  }

  isUnlocked(group: SyncKeyGroup): boolean {
    return this.keys.has(group);
  }

  /** The salt currently cached for a group, e.g. to persist it locally after `unlock`. */
  getSalt(group: SyncKeyGroup): Buffer | undefined {
    return this.keys.get(group)?.salt;
  }

  encrypt(category: SyncDataCategory, plaintext: string): Buffer {
    const group = CATEGORY_TO_GROUP[category];
    const cached = this.keys.get(group);
    if (!cached) {
      throw new SyncLockedError(group);
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', cached.key, iv);
    cipher.setAAD(Buffer.from(category, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([Buffer.from([FORMAT_VERSION]), cached.salt, iv, authTag, ciphertext]);
  }

  /**
   * Decrypts a downloaded blob. If the group isn't unlocked yet (first pull
   * on a fresh machine, before any local salt exists), pass `password` to
   * derive the key from the salt embedded in the blob itself; the result is
   * cached for subsequent calls in this group.
   */
  decrypt(category: SyncDataCategory, data: Buffer, password?: string): string {
    if (!Buffer.isBuffer(data) || data.length < HEADER_LENGTH) {
      throw new SyncDecryptionError('Encrypted file is truncated or corrupt');
    }

    let offset = 0;
    const formatVersion = data.readUInt8(offset);
    offset += 1;
    if (formatVersion !== FORMAT_VERSION) {
      throw new SyncDecryptionError(`Unsupported sync file format version ${formatVersion}`);
    }
    const salt = data.subarray(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;
    const iv = data.subarray(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;
    const authTag = data.subarray(offset, offset + AUTH_TAG_LENGTH);
    offset += AUTH_TAG_LENGTH;
    const ciphertext = data.subarray(offset);

    const group = CATEGORY_TO_GROUP[category];
    let key: Buffer;
    const cached = this.keys.get(group);
    if (cached) {
      key = cached.key;
    } else {
      if (!password) {
        throw new SyncLockedError(group);
      }
      key = deriveKey(password, salt, this.scryptParams);
      this.keys.set(group, { key, salt: Buffer.from(salt) });
    }

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(category, 'utf8'));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch {
      // Wrong password and a swapped/corrupted file both fail GCM auth-tag
      // verification the same way, which doubles as our password check —
      // there's no need for a separate plaintext "canary" value.
      throw new SyncDecryptionError();
    }
  }
}
