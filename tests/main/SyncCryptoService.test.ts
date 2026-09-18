import { describe, it, expect, beforeEach } from 'vitest';
import {
  SyncCryptoService,
  SyncDecryptionError,
  SyncLockedError,
  generateSalt,
  deriveKey,
  type ScryptParams,
} from '../../src/main/services/SyncCryptoService';

// Cheap scrypt params so the (deliberately slow) production defaults don't
// make the test suite slow. Security of the KDF cost itself is not what
// these tests are validating.
const FAST_PARAMS: ScryptParams = { N: 16, r: 1, p: 1, maxmem: 4 * 1024 * 1024 };

describe('SyncCryptoService', () => {
  let service: SyncCryptoService;

  beforeEach(() => {
    service = new SyncCryptoService(FAST_PARAMS);
  });

  it('round-trips plaintext through encrypt/decrypt for a category', () => {
    const salt = generateSalt();
    service.unlock('topology', 'correct horse battery staple', salt);

    const encrypted = service.encrypt('topology', '{"servers":["a","b"]}');
    const decrypted = service.decrypt('topology', encrypted);

    expect(decrypted).toBe('{"servers":["a","b"]}');
  });

  it('reuses the same embedded salt across multiple encryptions in a group, with fresh IVs', () => {
    const salt = generateSalt();
    service.unlock('topology', 'pw', salt);

    const a = service.encrypt('topology', 'first');
    const b = service.encrypt('topology', 'second');

    const saltA = a.subarray(1, 1 + 16);
    const saltB = b.subarray(1, 1 + 16);
    const ivA = a.subarray(1 + 16, 1 + 16 + 12);
    const ivB = b.subarray(1 + 16, 1 + 16 + 12);

    expect(saltA.equals(salt)).toBe(true);
    expect(saltB.equals(salt)).toBe(true);
    expect(ivA.equals(ivB)).toBe(false);
  });

  it('a single unlock() covers every category in that key group, without needing a password per category', () => {
    const topologySalt = generateSalt();
    service.unlock('topology', 'topology-pw', topologySalt);

    // 'topology' and 'settings' share the 'topology' key group (see
    // CATEGORY_TO_GROUP) — one unlock() call must suffice for both.
    const settings = service.encrypt('settings', 'settings-payload');
    expect(service.decrypt('settings', settings)).toBe('settings-payload');
    const topology = service.encrypt('topology', 'topology-payload');
    expect(service.decrypt('topology', topology)).toBe('topology-payload');

    // But the categories remain AAD-isolated from each other even though
    // they share a key: one category's ciphertext must not decrypt as another.
    expect(() => service.decrypt('topology', settings)).toThrow(SyncDecryptionError);
  });

  it('throws SyncLockedError when encrypting before unlock', () => {
    expect(() => service.encrypt('topology', 'x')).toThrow(SyncLockedError);
  });

  it('throws SyncLockedError when decrypting before unlock and no password is supplied', () => {
    const salt = generateSalt();
    const other = new SyncCryptoService(FAST_PARAMS);
    other.unlock('topology', 'pw', salt);
    const encrypted = other.encrypt('topology', 'x');

    expect(() => service.decrypt('topology', encrypted)).toThrow(SyncLockedError);
  });

  it('bootstraps on a fresh machine by deriving the key from the salt embedded in the downloaded file', () => {
    const salt = generateSalt();
    const remote = new SyncCryptoService(FAST_PARAMS);
    remote.unlock('credentials', 'shared-master-password', salt);
    const encrypted = remote.encrypt('credentials', 'bootstrap-payload');

    // Fresh instance, nothing unlocked yet — simulates a brand new machine.
    const fresh = new SyncCryptoService(FAST_PARAMS);
    const decrypted = fresh.decrypt('credentials', encrypted, 'shared-master-password');
    expect(decrypted).toBe('bootstrap-payload');

    // The derived key is now cached, so a subsequent call needs no password.
    const again = fresh.encrypt('credentials', 'second-payload');
    expect(fresh.decrypt('credentials', again)).toBe('second-payload');
  });

  it('throws SyncDecryptionError for a wrong password', () => {
    const salt = generateSalt();
    const remote = new SyncCryptoService(FAST_PARAMS);
    remote.unlock('credentials', 'right-password', salt);
    const encrypted = remote.encrypt('credentials', 'secret-data');

    const fresh = new SyncCryptoService(FAST_PARAMS);
    expect(() => fresh.decrypt('credentials', encrypted, 'wrong-password')).toThrow(SyncDecryptionError);
  });

  it('throws SyncDecryptionError for a truncated/corrupt file', () => {
    const salt = generateSalt();
    service.unlock('topology', 'pw', salt);
    const encrypted = service.encrypt('topology', 'data');

    expect(() => service.decrypt('topology', encrypted.subarray(0, 10))).toThrow(SyncDecryptionError);
    expect(() => service.decrypt('topology', encrypted.subarray(0, encrypted.length - 5))).toThrow(
      SyncDecryptionError
    );
  });

  it('throws SyncDecryptionError for an unsupported format version byte', () => {
    const salt = generateSalt();
    service.unlock('topology', 'pw', salt);
    const encrypted = service.encrypt('topology', 'data');
    const tampered = Buffer.from(encrypted);
    tampered[0] = 99;

    expect(() => service.decrypt('topology', tampered)).toThrow(SyncDecryptionError);
  });

  it('binds the category as AAD: data encrypted as one category cannot be decrypted as another, even with the right key', () => {
    const salt = generateSalt();
    service.unlock('credentials', 'pw', salt);

    // Both 'credentials' and 'dotfile-pools' share the credentials key group,
    // so the key is identical — only the AAD (category name) differs.
    const encryptedAsCredentials = service.encrypt('credentials', 'payload');

    expect(() => service.decrypt('dotfile-pools', encryptedAsCredentials)).toThrow(SyncDecryptionError);
  });

  it('deriveKey is deterministic for the same password/salt/params and differs for different salts', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const keyA = deriveKey('same-password', salt1, FAST_PARAMS);
    const keyB = deriveKey('same-password', salt1, FAST_PARAMS);
    const keyC = deriveKey('same-password', salt2, FAST_PARAMS);

    expect(keyA.equals(keyB)).toBe(true);
    expect(keyA.equals(keyC)).toBe(false);
  });
});
