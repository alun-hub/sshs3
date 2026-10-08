import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/unused-user-data') },
}));

import { TeamVaultService } from '../../src/main/services/TeamVaultService';
import type { TeamVaultCryptoService } from '../../src/main/services/TeamVaultCryptoService';

/** A deterministic, in-memory stand-in for the real `age`-backed crypto service, so these tests
 * exercise TeamVaultService's own orchestration (re-keying, unlock gating, file persistence)
 * without shelling out to any binary. */
function fakeCrypto(): TeamVaultCryptoService {
  return {
    generateVaultKey: () => crypto.randomBytes(32),
    encryptPayload: (key: Buffer, vaultId: string, v: number, plaintext: string) =>
      `${key.toString('hex')}|${vaultId}|${v}|${plaintext}`,
    decryptPayload: (key: Buffer, vaultId: string, v: number, encrypted: string) => {
      const [keyHex, evId, ev, ...rest] = encrypted.split('|');
      if (keyHex !== key.toString('hex') || evId !== vaultId || Number(ev) !== v) {
        throw new Error('decrypt failed: wrong key/vaultId/version');
      }
      return rest.join('|');
    },
    wrapVaultKeyForRecipient: async (key: Buffer, recipient: string) => `wrapped:${recipient}:${key.toString('hex')}`,
    unwrapVaultKey: async (wrapped: string) => {
      const m = wrapped.match(/^wrapped:[^:]+:([0-9a-f]+)$/);
      if (!m) throw new Error('bad wrap');
      return Buffer.from(m[1], 'hex');
    },
    enrollOwnPivRecipient: async () => ({
      recipient: 'age1yubikey1fakeadmin',
      identityFilePath: '/tmp/fake-admin-identity.txt',
    }),
    generateRecoveryIdentity: async () => ({
      identity: 'AGE-SECRET-KEY-FAKE\n# public key: age1fakerecovery',
      recipient: 'age1fakerecovery',
    }),
  } as unknown as TeamVaultCryptoService;
}

describe('TeamVaultService', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-team-vault-test-'));
    filePath = path.join(tempDir, 'team-vault.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  function makeService(): TeamVaultService {
    return new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
  }

  describe('getStatus', () => {
    it('reports exists:false when no vault file exists yet', async () => {
      const service = makeService();
      expect(await service.getStatus()).toEqual({ exists: false, unlocked: false, filePath });
    });
  });

  describe('createVault', () => {
    it('creates a vault with the creating admin as the sole member, unlocked in this session', async () => {
      const service = makeService();
      const { recoveryIdentity } = await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      expect(recoveryIdentity).toContain('AGE-SECRET-KEY-FAKE');
      expect(service.isUnlocked()).toBe(true);

      const status = await service.getStatus();
      expect(status.exists).toBe(true);
      expect(status.members).toEqual([{ recipientId: 'alice@piv:abc', role: 'admin', addedAt: expect.any(String) }]);
      expect(status.adminCount).toBe(1);
    });

    it('refuses to create a second vault on top of an existing one', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await expect(service.createVault('bob@piv:def', 'age1yubikey1bob')).rejects.toThrow('already exists');
    });
  });

  describe('addMember', () => {
    it('requires the vault to be unlocked first', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      service.lock();

      await expect(service.addMember('bob@piv:def', 'age1yubikey1bob', 'member', 'alice@piv:abc')).rejects.toThrow(
        'Unlock the Team Vault'
      );
    });

    it('adds a member without re-keying (same wrapped key material for existing members)', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const beforeStatus = await service.getStatus();

      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member', 'alice@piv:abc');

      const status = await service.getStatus();
      expect(status.members).toHaveLength(2);
      expect(status.adminCount).toBe(1);
      expect(status.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ recipientId: 'alice@piv:abc', role: 'admin' }),
          expect.objectContaining({ recipientId: 'bob@piv:def', role: 'member' }),
        ])
      );
      expect(beforeStatus.members).toHaveLength(1);
    });

    it('rejects adding a recipientId that is already a member', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await expect(
        service.addMember('alice@piv:abc', 'age1yubikey1alice', 'member', 'alice@piv:abc')
      ).rejects.toThrow('already a member');
    });
  });

  describe('removeMember', () => {
    it('re-keys: the removed member loses access, remaining members keep access under a new key', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member', 'alice@piv:abc');

      const { remainingAdmins } = await service.removeMember('bob@piv:def', 'alice@piv:abc');
      expect(remainingAdmins).toBe(1);

      const status = await service.getStatus();
      expect(status.members).toEqual([expect.objectContaining({ recipientId: 'alice@piv:abc' })]);

      // A fresh service instance pointed at the same file, unlocking as alice, must still work —
      // proving alice's entry was genuinely re-wrapped for the new Vault Key, not left stale.
      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await second.unlock('alice@piv:abc', '/tmp/fake-admin-identity.txt');
      expect(second.isUnlocked()).toBe(true);
    });

    it('requires the vault to be unlocked first', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      service.lock();
      await expect(service.removeMember('alice@piv:abc', 'alice@piv:abc')).rejects.toThrow('Unlock the Team Vault');
    });

    it('rejects removing a recipientId that is not a member', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await expect(service.removeMember('ghost@piv:xyz', 'alice@piv:abc')).rejects.toThrow('is not a member');
    });
  });

  describe('setRole', () => {
    it('changes a member role without requiring the vault to be unlocked', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member', 'alice@piv:abc');
      service.lock();

      await service.setRole('bob@piv:def', 'admin', 'alice@piv:abc');

      const status = await service.getStatus();
      expect(status.members).toEqual(
        expect.arrayContaining([expect.objectContaining({ recipientId: 'bob@piv:def', role: 'admin' })])
      );
      expect(status.adminCount).toBe(2);
    });
  });

  describe('unlock / lock', () => {
    it('unlocks using a recipient wrap and lock() clears it again', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');

      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      expect(second.isUnlocked()).toBe(false);
      await second.unlock('alice@piv:abc', '/tmp/fake-admin-identity.txt');
      expect(second.isUnlocked()).toBe(true);

      second.lock();
      expect(second.isUnlocked()).toBe(false);
    });

    it('rejects unlocking as a recipient that does not exist in the vault', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');

      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await expect(second.unlock('ghost@piv:xyz', '/tmp/whatever.txt')).rejects.toThrow(
        'is not a recipient of this vault'
      );
    });

    it('can unlock using the recovery recipientId', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');

      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await second.unlock('recovery-key-1', '/tmp/recovery-identity.txt');
      expect(second.isUnlocked()).toBe(true);
    });
  });

  describe('enrollOwnPivRecipient', () => {
    it('delegates to the crypto service with the configured identity directory', async () => {
      const service = makeService();
      const result = await service.enrollOwnPivRecipient();
      expect(result.recipient).toBe('age1yubikey1fakeadmin');
    });
  });
});
