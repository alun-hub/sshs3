import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockEncryptString, mockDecryptString, mockIsEncryptionAvailable } = vi.hoisted(() => {
  return {
    mockEncryptString: vi.fn((value: string) => Buffer.from(`cipher:${value}`, 'utf-8')),
    mockDecryptString: vi.fn((buf: Buffer) => buf.toString('utf-8').replace(/^cipher:/, '')),
    mockIsEncryptionAvailable: vi.fn().mockReturnValue(true),
  };
});

vi.mock('electron', () => {
  const mockObj = {
    safeStorage: {
      isEncryptionAvailable: mockIsEncryptionAvailable,
      encryptString: mockEncryptString,
      decryptString: mockDecryptString,
    },
  };
  return { ...mockObj, default: mockObj };
});

import { encryptSecretValue, decryptSecretValue } from '../../src/main/crypto/SecretFieldCrypto';

describe('decryptSecretValue', () => {
  beforeEach(() => {
    mockIsEncryptionAvailable.mockReturnValue(true);
    mockEncryptString.mockClear();
    mockDecryptString.mockClear();
  });

  it('returns a never-encrypted (unprefixed) value unchanged', () => {
    expect(decryptSecretValue('plain-password')).toBe('plain-password');
    expect(decryptSecretValue('')).toBe('');
  });

  it('decrypts a value that was encrypted with the same keyring', () => {
    const encrypted = encryptSecretValue('super-secret');
    expect(encrypted).toContain('enc:v1:');
    expect(decryptSecretValue(encrypted)).toBe('super-secret');
  });

  // Regression tests for the H1 finding (code review): an encrypted value
  // that can't be decrypted here used to fall through and return the raw
  // ciphertext string as if it were the real secret — which a caller would
  // then use directly as an SSH/S3 password, silently failing auth with a
  // confusing error, or worse, re-save as "plaintext" and permanently lose
  // the original value. It must come back as '' instead, matching "no
  // credential saved", which callers already handle by re-prompting.

  it('returns "" instead of raw ciphertext when no OS keyring is available to decrypt', () => {
    const encrypted = encryptSecretValue('super-secret');
    mockIsEncryptionAvailable.mockReturnValue(false);

    const result = decryptSecretValue(encrypted);

    expect(result).toBe('');
    expect(result).not.toContain('enc:v1:');
  });

  it('returns "" instead of raw ciphertext when decryptString throws', () => {
    const encrypted = encryptSecretValue('super-secret');
    mockDecryptString.mockImplementationOnce(() => {
      throw new Error('decryption failed');
    });

    const result = decryptSecretValue(encrypted);

    expect(result).toBe('');
    expect(result).not.toContain('enc:v1:');
  });

  it('returns "" for a corrupted enc:v1: value that is not valid base64/ciphertext', () => {
    mockDecryptString.mockImplementationOnce(() => {
      throw new Error('bad ciphertext');
    });

    const result = decryptSecretValue('enc:v1:not-really-valid-ciphertext');

    expect(result).toBe('');
  });
});

// M2: encryptSecretValue must fall through to plaintext for both the
// expected "no OS keyring" case and an unexpected encryptString() failure,
// but only log a warning for the latter — the two used to be
// indistinguishable, which could hide a real bug behind the normal
// no-keyring fallback.
describe('encryptSecretValue (M2)', () => {
  beforeEach(() => {
    mockIsEncryptionAvailable.mockReturnValue(true);
    mockEncryptString.mockClear();
    mockDecryptString.mockClear();
  });

  it('stores as plaintext without warning when no OS keyring is available', () => {
    mockIsEncryptionAvailable.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = encryptSecretValue('super-secret');

    expect(result).toBe('super-secret');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('falls through to plaintext AND warns when encryptString throws unexpectedly', () => {
    mockEncryptString.mockImplementationOnce(() => {
      throw new Error('keyring locked');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = encryptSecretValue('super-secret');

    expect(result).toBe('super-secret');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
