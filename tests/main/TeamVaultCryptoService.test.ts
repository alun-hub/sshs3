import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { mockExecFile, mockRunAgeCommandViaPty, mockCreateFifo, mockReadFifoOnce, mockRemoveFifo } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockRunAgeCommandViaPty: vi.fn(),
  mockCreateFifo: vi.fn(),
  mockReadFifoOnce: vi.fn(),
  mockRemoveFifo: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: mockExecFile };
});

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn().mockReturnValue('/app') },
}));

import { app as mockedElectronApp } from 'electron';

// enrollOwnPivRecipient/unwrapVaultKey go through AgePtyPinRelay (a real terminal is required
// for age-plugin-yubikey to prompt for PIN/touch — see docs/team-vault-plan.md). Mocked here so
// these unit tests never spawn a pty or touch real hardware; the one real-CLI round trip test
// below uses a software (non-PIV) identity instead, which needs none of this.
vi.mock('../../src/main/services/AgePtyPinRelay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/services/AgePtyPinRelay')>();
  return {
    ...actual,
    runAgeCommandViaPty: mockRunAgeCommandViaPty,
    createFifo: mockCreateFifo,
    readFifoOnce: mockReadFifoOnce,
    removeFifo: mockRemoveFifo,
  };
});

import { TeamVaultCryptoService, TeamVaultDecryptionError } from '../../src/main/services/TeamVaultCryptoService';
import type { AgePtyPromptCallbacks } from '../../src/main/services/AgePtyPinRelay';

function noopCallbacks(): AgePtyPromptCallbacks {
  return {
    requestPin: vi.fn().mockRejectedValue(new Error('requestPin should not be called in this test')),
    onTouchRequested: vi.fn(),
    onTouchCleared: vi.fn(),
  };
}

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
        // Unmock node:child_process and AgePtyPinRelay for this one real-binary round trip.
        // A software (non-PIV) identity never prompts for anything, so the real
        // runAgeCommandViaPty/createFifo/readFifoOnce/removeFifo can run unmocked too.
        vi.doUnmock('node:child_process');
        vi.doUnmock('../../src/main/services/AgePtyPinRelay');
        vi.resetModules();
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
        const unwrapped = await realService.unwrapVaultKey(wrapped, identityPath, noopCallbacks());
        expect(unwrapped.equals(vaultKey)).toBe(true);
      }
    );
  });

  describe('unwrapVaultKey (pty + FIFO path, mocked)', () => {
    beforeEach(() => {
      mockRunAgeCommandViaPty.mockReset();
      mockCreateFifo.mockReset();
      mockReadFifoOnce.mockReset();
      mockRemoveFifo.mockReset();
    });

    it('creates a FIFO, decrypts via the pty with -o <fifo>, reads the result from the FIFO, and cleans up', async () => {
      mockCreateFifo.mockResolvedValue('/tmp/fake.fifo');
      mockReadFifoOnce.mockResolvedValue(Buffer.from('raw-vault-key-bytes'));
      mockRunAgeCommandViaPty.mockResolvedValue('# some human-readable status text\n');
      mockRemoveFifo.mockResolvedValue(undefined);

      const callbacks = noopCallbacks();
      const service2 = new TeamVaultCryptoService();
      const result = await service2.unwrapVaultKey('wrapped-blob', '/tmp/identity.txt', callbacks);

      expect(result.toString('utf8')).toBe('raw-vault-key-bytes');
      expect(mockCreateFifo).toHaveBeenCalledTimes(1);
      expect(mockRunAgeCommandViaPty).toHaveBeenCalledTimes(1);
      const [binary, args, , cbArg, , stdinArg] = mockRunAgeCommandViaPty.mock.calls[0];
      expect(binary).toMatch(/age$/);
      expect(args).toEqual(['-d', '-i', '/tmp/identity.txt', '-o', '/tmp/fake.fifo']);
      expect(cbArg).toBe(callbacks);
      expect(stdinArg).toBe('wrapped-blob');
      expect(mockRemoveFifo).toHaveBeenCalledWith('/tmp/fake.fifo');
    });

    it('still cleans up the FIFO when the pty run rejects', async () => {
      mockCreateFifo.mockResolvedValue('/tmp/fake.fifo');
      mockReadFifoOnce.mockResolvedValue(Buffer.alloc(0));
      mockRunAgeCommandViaPty.mockRejectedValue(new Error('age: error: no YubiKey detected'));
      mockRemoveFifo.mockResolvedValue(undefined);

      const service2 = new TeamVaultCryptoService();
      await expect(service2.unwrapVaultKey('wrapped-blob', '/tmp/identity.txt', noopCallbacks())).rejects.toThrow(
        'no YubiKey detected'
      );
      expect(mockRemoveFifo).toHaveBeenCalledWith('/tmp/fake.fifo');
    });

    it('rejects a flag-like identity file path before ever creating a FIFO or spawning (argument-injection guard)', async () => {
      const service2 = new TeamVaultCryptoService();
      await expect(
        service2.unwrapVaultKey('wrapped-blob', '--output=/etc/passwd', noopCallbacks())
      ).rejects.toThrow('Invalid identity file path');
      expect(mockCreateFifo).not.toHaveBeenCalled();
      expect(mockRunAgeCommandViaPty).not.toHaveBeenCalled();
    });
  });

  describe('wrapVaultKeyForRecipient argument-injection guard', () => {
    beforeEach(() => {
      mockExecFile.mockReset();
    });

    // Wrapping for an age1yubikey1... recipient needs `age` to find the `age-plugin-yubikey`
    // plugin binary to parse/validate the recipient stanza — a pure public-key operation
    // (no PIV card or PIN involved), but it still execs the plugin, so it needs the same
    // PATH-prepending `unwrapVaultKey` already gets. Without it, this call fails identically in
    // a packaged build (the plugin is bundled right next to `age`, but not found by bare name on
    // PATH) as it does in dev with no system-wide install.
    it("passes an env with the age-plugin-yubikey directory prepended to PATH, same as unwrapVaultKey, so wrapping for a yubikey recipient doesn't fail with \"plugin not found\"", async () => {
      // Give resolveAgeBinary('age-plugin-yubikey') a real directory to resolve to (its
      // dev-checkout lookup is a plain fs.existsSync against <appPath>/build-resources/age/<os>),
      // so this test doesn't depend on whatever happens to be on the real machine's disk.
      const fakeAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-fake-app-root-'));
      const platformBinDir = path.join(fakeAppRoot, 'build-resources', 'age', process.platform === 'win32' ? 'win' : 'linux');
      fs.mkdirSync(platformBinDir, { recursive: true });
      fs.writeFileSync(path.join(platformBinDir, process.platform === 'win32' ? 'age-plugin-yubikey.exe' : 'age-plugin-yubikey'), '');
      vi.mocked(mockedElectronApp.getAppPath).mockReturnValueOnce(fakeAppRoot);

      mockExecFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: any) => {
        cb(null, Buffer.from('wrapped'), Buffer.from(''));
        return { stdin: { end: vi.fn() } };
      });

      const service2 = new TeamVaultCryptoService();
      const key = service2.generateVaultKey();
      await service2.wrapVaultKeyForRecipient(key, 'age1yubikey1fakerecipient');

      const [, , opts] = mockExecFile.mock.calls[0];
      // Mirrors unwrapVaultKey's pluginPathEnv exactly, so `age` can exec the plugin by bare
      // name even when it isn't installed system-wide (dev checkout or packaged build alike).
      expect(opts.env).not.toBe(process.env);
      expect(opts.env.PATH.split(path.delimiter)[0]).toBe(platformBinDir);
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

  describe('enrollOwnPivRecipient (mocked, pty path)', () => {
    beforeEach(() => {
      mockRunAgeCommandViaPty.mockReset();
    });

    it('parses the recipient string, persists the identity stanza to a file, and forwards callbacks', async () => {
      const generated =
        '#       Serial: 31310420, Slot: 1\n' +
        '#     PIN policy: Once (requires PIN once per session)\n' +
        '#   Touch policy: Always\n' +
        '#    Recipient: age1yubikey1qg69g6anlkd8w9ql0ugvyahm3ex8qd0v6v2n5l5w6rr0pq0wjxs8nqg6c2a\n' +
        'AGE-PLUGIN-YUBIKEY-1QG69G6ANLKD8W9QL0UGVYAHM3EX8QD0V6V2N5L5W6RR0PQ0WJXS8NQG6C2A\n';
      mockRunAgeCommandViaPty.mockImplementation(async (_binary: string, args: string[], _env: unknown, cb: unknown) => {
        expect(args).toEqual(['--generate']);
        expect(cb).toBe(callbacks);
        return generated;
      });

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-enroll-'));
      const service2 = new TeamVaultCryptoService();
      const callbacks = noopCallbacks();
      const result = await service2.enrollOwnPivRecipient(dir, callbacks);

      expect(result.recipient).toBe(
        'age1yubikey1qg69g6anlkd8w9ql0ugvyahm3ex8qd0v6v2n5l5w6rr0pq0wjxs8nqg6c2a'
      );
      expect(fs.readFileSync(result.identityFilePath, 'utf8')).toBe(generated);
    });

    // Real hardware transcripts (docs/team-vault-plan.md's "Hårdvaruverifiering") include
    // interactive noise before the actual stanza — a "Generating key..." banner, the echoed PIN
    // prompt (with cursor-redraw escape codes), and a touch-prompt line. Found via run-desktop:
    // the file was unusable by `age -d -i <file>` ("unknown identity type") because the FULL
    // noisy transcript was being written verbatim instead of just the stanza.
    it('strips interactive pty noise from the saved identity file, keeping only the real stanza', async () => {
      const noisyTranscript =
        '\u{1f3b2} Generating key...\r\n' +
        '\r\n' +
        'Enter PIN for YubiKey with serial 20185052 (default is 123456): \r\n' +
        '\u001b[1A\r\u001b[2K\u001b[1B\u001b[1AEnter PIN for YubiKey with serial 20185052 (default is 123456): [hidden]\r\n' +
        '\r\n' +
        '\u{1f50f} Generating certificate...\r\n' +
        '\u{1f446} Please touch the YubiKey\r\n' +
        '#       Serial: 20185052, Slot: 3\r\n' +
        '#         Name: age identity 0b5f7a03\r\n' +
        '#      Created: Fri, 09 Oct 2026 14:18:26 +0000\r\n' +
        '#   PIN policy: Once   (A PIN is required once per session, if set)\r\n' +
        '# Touch policy: Always (A physical touch is required for every decryption)\r\n' +
        '#    Recipient: age1yubikey1qt5hwsyd95vtvxkpyjayvcgys4ng7gs4ucd02g07z2l32qvpvumesxkwg9u\r\n' +
        'AGE-PLUGIN-YUBIKEY-1MNLNXQVYPD0H5QCVDPS26\r\n';
      mockRunAgeCommandViaPty.mockResolvedValue(noisyTranscript);

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-enroll-'));
      const service2 = new TeamVaultCryptoService();
      const result = await service2.enrollOwnPivRecipient(dir, noopCallbacks());

      const saved = fs.readFileSync(result.identityFilePath, 'utf8');
      expect(saved).not.toContain('Generating key');
      expect(saved).not.toContain('Enter PIN');
      expect(saved).not.toContain('Please touch');
      expect(saved).toBe(
        '#       Serial: 20185052, Slot: 3\n' +
          '#         Name: age identity 0b5f7a03\n' +
          '#      Created: Fri, 09 Oct 2026 14:18:26 +0000\n' +
          '#   PIN policy: Once   (A PIN is required once per session, if set)\n' +
          '# Touch policy: Always (A physical touch is required for every decryption)\n' +
          '#    Recipient: age1yubikey1qt5hwsyd95vtvxkpyjayvcgys4ng7gs4ucd02g07z2l32qvpvumesxkwg9u\n' +
          'AGE-PLUGIN-YUBIKEY-1MNLNXQVYPD0H5QCVDPS26\n'
      );
    });

    it('throws if no recipient string is found in the output', async () => {
      mockRunAgeCommandViaPty.mockResolvedValue('nothing useful here');

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-enroll-'));
      const service2 = new TeamVaultCryptoService();
      await expect(service2.enrollOwnPivRecipient(dir, noopCallbacks())).rejects.toThrow(
        'did not produce a recipient string'
      );
    });

    it('propagates TeamVaultDefaultCredentialsError/TeamVaultWrongPinError unchanged', async () => {
      const { TeamVaultDefaultCredentialsError } = await import('../../src/main/services/AgePtyPinRelay');
      mockRunAgeCommandViaPty.mockRejectedValue(new TeamVaultDefaultCredentialsError());

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-enroll-'));
      const service2 = new TeamVaultCryptoService();
      await expect(service2.enrollOwnPivRecipient(dir, noopCallbacks())).rejects.toBeInstanceOf(
        TeamVaultDefaultCredentialsError
      );
    });
  });

  describe('saveRecoveryIdentityText', () => {
    it('writes a clean recovery identity text to a file under identityOutDir', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-recovery-'));
      const service2 = new TeamVaultCryptoService();
      const text = '# created: 2026-01-01T00:00:00Z\n# public key: age1fakerecovery\nAGE-SECRET-KEY-1FAKERECOVERYTEXT\n';
      const identityFilePath = await service2.saveRecoveryIdentityText(dir, text);
      expect(fs.readFileSync(identityFilePath, 'utf8')).toBe(text);
    });

    it('tolerates surrounding chat/email quoting, keeping only the real stanza', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-recovery-'));
      const service2 = new TeamVaultCryptoService();
      const pasted =
        'Hey, here is the recovery key we printed:\n\n' +
        '# created: 2026-01-01T00:00:00Z\n' +
        '# public key: age1fakerecovery\n' +
        'AGE-SECRET-KEY-1FAKERECOVERYTEXT\n\n' +
        '-- sent from my phone';
      const identityFilePath = await service2.saveRecoveryIdentityText(dir, pasted);
      const saved = fs.readFileSync(identityFilePath, 'utf8');
      expect(saved).not.toContain('Hey, here is');
      expect(saved).not.toContain('sent from my phone');
      expect(saved).toBe('# created: 2026-01-01T00:00:00Z\n# public key: age1fakerecovery\nAGE-SECRET-KEY-1FAKERECOVERYTEXT\n');
    });

    it('rejects text with no recognizable AGE-SECRET-KEY-1... line', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-vault-recovery-'));
      const service2 = new TeamVaultCryptoService();
      await expect(service2.saveRecoveryIdentityText(dir, 'not a key at all')).rejects.toThrow(
        'does not look like a Team Vault recovery key'
      );
    });
  });

  describe('computeAccessHeaderMac', () => {
    const accessHeader = [
      {
        recipientId: 'alice@piv:abc',
        role: 'admin' as const,
        method: 'piv-rsa-oaep' as const,
        ageRecipient: 'age1yubikey1alice',
        wrappedVaultKey: 'wrapped-alice',
        addedAt: '2026-01-01T00:00:00Z',
        addedBy: 'alice@piv:abc',
      },
    ];
    const recovery = {
      recipientId: 'recovery-key-1',
      ageRecipient: 'age1recovery',
      wrappedVaultKey: 'wrapped-recovery',
    };

    it('is deterministic for the same inputs', () => {
      const svc = new TeamVaultCryptoService();
      const key = Buffer.alloc(32, 1);
      const a = svc.computeAccessHeaderMac(key, 'vlt_1', 1, '', accessHeader, recovery);
      const b = svc.computeAccessHeaderMac(key, 'vlt_1', 1, '', accessHeader, recovery);
      expect(a).toBe(b);
    });

    it('changes if the Vault Key differs', () => {
      const svc = new TeamVaultCryptoService();
      const macA = svc.computeAccessHeaderMac(Buffer.alloc(32, 1), 'vlt_1', 1, '', accessHeader, recovery);
      const macB = svc.computeAccessHeaderMac(Buffer.alloc(32, 2), 'vlt_1', 1, '', accessHeader, recovery);
      expect(macA).not.toBe(macB);
    });

    it('changes if any access entry field differs, even a single character', () => {
      const svc = new TeamVaultCryptoService();
      const key = Buffer.alloc(32, 1);
      const macA = svc.computeAccessHeaderMac(key, 'vlt_1', 1, '', accessHeader, recovery);
      const tampered = [{ ...accessHeader[0], ageRecipient: 'age1yubikey1alicX' }];
      const macB = svc.computeAccessHeaderMac(key, 'vlt_1', 1, '', tampered, recovery);
      expect(macA).not.toBe(macB);
    });

    it('changes if the revision, vaultId, or vaultName differs', () => {
      const svc = new TeamVaultCryptoService();
      const key = Buffer.alloc(32, 1);
      const base = svc.computeAccessHeaderMac(key, 'vlt_1', 1, '', accessHeader, recovery);
      expect(svc.computeAccessHeaderMac(key, 'vlt_1', 2, '', accessHeader, recovery)).not.toBe(base);
      expect(svc.computeAccessHeaderMac(key, 'vlt_2', 1, '', accessHeader, recovery)).not.toBe(base);
      expect(svc.computeAccessHeaderMac(key, 'vlt_1', 1, 'Acme Team', accessHeader, recovery)).not.toBe(base);
    });

    it('is insensitive to access-entry array order (sorted canonicalization)', () => {
      const svc = new TeamVaultCryptoService();
      const key = Buffer.alloc(32, 1);
      const second = {
        recipientId: 'bob@piv:def',
        role: 'member' as const,
        method: 'piv-rsa-oaep' as const,
        ageRecipient: 'age1yubikey1bob',
        wrappedVaultKey: 'wrapped-bob',
        addedAt: '2026-01-02T00:00:00Z',
        addedBy: 'alice@piv:abc',
      };
      const forward = svc.computeAccessHeaderMac(key, 'vlt_1', 1, '', [accessHeader[0], second], recovery);
      const reversed = svc.computeAccessHeaderMac(key, 'vlt_1', 1, '', [second, accessHeader[0]], recovery);
      expect(forward).toBe(reversed);
    });
  });
});
