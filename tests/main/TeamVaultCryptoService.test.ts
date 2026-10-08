import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: mockExecFile };
});

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn().mockReturnValue('/app') },
}));

import { TeamVaultCryptoService, TeamVaultDecryptionError } from '../../src/main/services/TeamVaultCryptoService';

describe('TeamVaultCryptoService', () => {
  const service = new TeamVaultCryptoService();

  describe('generateVaultKey', () => {
    it('returns a fresh 32-byte key each time', () => {
      const a = service.generateVaultKey();
      const b = service.generateVaultKey();
      expect(a).toHaveLength(32);
      expect(b).toHaveLength(32);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('encryptPayload / decryptPayload (pure crypto, no binary)', () => {
    it('round-trips plaintext', () => {
      const key = service.generateVaultKey();
      const encrypted = service.encryptPayload(key, 'vlt_1', 1, 'hello team vault');
      expect(service.decryptPayload(key, 'vlt_1', 1, encrypted)).toBe('hello team vault');
    });

    it('produces a fresh IV on every call, even for identical plaintext', () => {
      const key = service.generateVaultKey();
      const a = service.encryptPayload(key, 'vlt_1', 1, 'same payload');
      const b = service.encryptPayload(key, 'vlt_1', 1, 'same payload');
      expect(a).not.toBe(b);
    });

    it('rejects decryption with the wrong Vault Key', () => {
      const key = service.generateVaultKey();
      const wrongKey = service.generateVaultKey();
      const encrypted = service.encryptPayload(key, 'vlt_1', 1, 'secret');
      expect(() => service.decryptPayload(wrongKey, 'vlt_1', 1, encrypted)).toThrow(TeamVaultDecryptionError);
    });

    it('rejects decryption with a mismatched vaultId (AAD binding)', () => {
      const key = service.generateVaultKey();
      const encrypted = service.encryptPayload(key, 'vlt_1', 1, 'secret');
      expect(() => service.decryptPayload(key, 'vlt_2', 1, encrypted)).toThrow(TeamVaultDecryptionError);
    });

    it('rejects decryption with a mismatched formatVersion (AAD binding)', () => {
      const key = service.generateVaultKey();
      const encrypted = service.encryptPayload(key, 'vlt_1', 1, 'secret');
      expect(() => service.decryptPayload(key, 'vlt_1', 2, encrypted)).toThrow(TeamVaultDecryptionError);
    });

    it('rejects a tampered ciphertext (GCM auth tag failure)', () => {
      const key = service.generateVaultKey();
      const encrypted = service.encryptPayload(key, 'vlt_1', 1, 'secret');
      const bytes = Buffer.from(encrypted, 'base64');
      bytes[bytes.length - 1] ^= 0xff;
      expect(() => service.decryptPayload(key, 'vlt_1', 1, bytes.toString('base64'))).toThrow(
        TeamVaultDecryptionError
      );
    });

    it('rejects a truncated payload', () => {
      const key = service.generateVaultKey();
      expect(() => service.decryptPayload(key, 'vlt_1', 1, Buffer.from('short').toString('base64'))).toThrow(
        TeamVaultDecryptionError
      );
    });
  });

  describe('wrapVaultKeyForRecipient / unwrapVaultKey against the real `age` CLI', () => {
    const hasAge = !spawnSync('age', ['--version'], { stdio: 'ignore' }).error;
    const hasAgeKeygen = !spawnSync('age-keygen', ['--version'], { stdio: 'ignore' }).error;

    it.skipIf(!hasAge || !hasAgeKeygen)(
      'wraps a Vault Key for a software age identity and unwraps it back',
      async () => {
        // Unmock node:child_process for this one real-binary round trip.
        vi.doUnmock('node:child_process');
        const real = await vi.importActual<typeof import('../../src/main/services/TeamVaultCryptoService')>(
          '../../src/main/services/TeamVaultCryptoService'
        );
        const realService = new real.TeamVaultCryptoService();

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-it-'));
        const identityPath = path.join(dir, 'identity.txt');
        const keygen = spawnSync('age-keygen', ['-o', identityPath]);
        expect(keygen.status).toBe(0);
        const identity = fs.readFileSync(identityPath, 'utf8');
        const recipientLine = identity.match(/# public key: (age1\S+)/)?.[1];
        expect(recipientLine).toBeTruthy();

        const vaultKey = realService.generateVaultKey();
        const wrapped = await realService.wrapVaultKeyForRecipient(vaultKey, recipientLine!);
        const unwrapped = await realService.unwrapVaultKey(wrapped, identityPath);
        expect(unwrapped.equals(vaultKey)).toBe(true);
      }
    );
  });

  describe('unwrapVaultKey argument construction (age-plugin-yubikey path, mocked)', () => {
    beforeEach(() => {
      mockExecFile.mockReset();
    });

    it('never passes a PIN as a CLI argument', async () => {
      mockExecFile.mockImplementation((_file: string, args: string[], _opts: unknown, cb: any) => {
        expect(args.join(' ')).not.toMatch(/\d{4,}/); // no raw PIN-shaped argument
        cb(null, Buffer.from('unwrapped-key-bytes'), Buffer.from(''));
        return { stdin: { end: vi.fn() } };
      });

      const service2 = new TeamVaultCryptoService();
      const result = await service2.unwrapVaultKey('wrapped-blob', '/tmp/identity.txt');
      expect(result.toString('utf8')).toBe('unwrapped-key-bytes');
      expect(mockExecFile).toHaveBeenCalledTimes(1);
      const [, args] = mockExecFile.mock.calls[0];
      expect(args).toEqual(['-d', '-i', '/tmp/identity.txt']);
    });

    it('propagates a plugin/card error with stderr as the message', async () => {
      mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
        cb(new Error('exit 1'), Buffer.from(''), Buffer.from('age: error: no YubiKey detected'));
        return { stdin: { end: vi.fn() } };
      });

      const service2 = new TeamVaultCryptoService();
      await expect(service2.unwrapVaultKey('wrapped-blob', '/tmp/identity.txt')).rejects.toThrow(
        'no YubiKey detected'
      );
    });

    it('gives a clear, actionable message when the binary itself is missing (ENOENT)', async () => {
      mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
        const err: any = new Error('spawn age ENOENT');
        err.code = 'ENOENT';
        cb(err, Buffer.from(''), Buffer.from(''));
        return { stdin: { end: vi.fn() } };
      });

      const service2 = new TeamVaultCryptoService();
      await expect(service2.unwrapVaultKey('wrapped-blob', '/tmp/identity.txt')).rejects.toThrow(
        'was not found'
      );
    });

    it('rejects a flag-like identity file path before ever shelling out (argument-injection guard)', async () => {
      const service2 = new TeamVaultCryptoService();
      await expect(service2.unwrapVaultKey('wrapped-blob', '--output=/etc/passwd')).rejects.toThrow(
        'Invalid identity file path'
      );
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe('wrapVaultKeyForRecipient argument-injection guard', () => {
    beforeEach(() => {
      mockExecFile.mockReset();
    });

    it('rejects a flag-like recipient string before ever shelling out', async () => {
      const service2 = new TeamVaultCryptoService();
      const key = service2.generateVaultKey();
      await expect(service2.wrapVaultKeyForRecipient(key, '-o/etc/passwd')).rejects.toThrow(
        'Invalid age recipient'
      );
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe('enrollOwnPivRecipient (mocked age-plugin-yubikey --generate)', () => {
    beforeEach(() => {
      mockExecFile.mockReset();
    });

    it('parses the recipient string and persists the identity stanza to a file', async () => {
      const generated =
        '#       Serial: 31310420, Slot: 1\n' +
        '#     PIN policy: Once (requires PIN once per session)\n' +
        '#   Touch policy: Always\n' +
        '#    Recipient: age1yubikey1qg69g6anlkd8w9ql0ugvyahm3ex8qd0v6v2n5l5w6rr0pq0wjxs8nqg6c2a\n' +
        'AGE-PLUGIN-YUBIKEY-1QG69G6ANLKD8W9QL0UGVYAHM3EX8QD0V6V2N5L5W6RR0PQ0WJXS8NQG6C2A\n';
      mockExecFile.mockImplementation((_file: string, args: string[], _opts: unknown, cb: any) => {
        expect(args).toEqual(['--generate']);
        cb(null, Buffer.from(generated), Buffer.from(''));
        return { stdin: { end: vi.fn() } };
      });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-enroll-'));
      const service2 = new TeamVaultCryptoService();
      const result = await service2.enrollOwnPivRecipient(dir);

      expect(result.recipient).toBe(
        'age1yubikey1qg69g6anlkd8w9ql0ugvyahm3ex8qd0v6v2n5l5w6rr0pq0wjxs8nqg6c2a'
      );
      expect(fs.readFileSync(result.identityFilePath, 'utf8')).toBe(generated);
    });

    it('throws if no recipient string is found in the output', async () => {
      mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
        cb(null, Buffer.from('nothing useful here'), Buffer.from(''));
        return { stdin: { end: vi.fn() } };
      });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-enroll-'));
      const service2 = new TeamVaultCryptoService();
      await expect(service2.enrollOwnPivRecipient(dir)).rejects.toThrow('did not produce a recipient string');
    });
  });
});
