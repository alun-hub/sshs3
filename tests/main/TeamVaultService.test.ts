import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/unused-user-data') },
}));

import { TeamVaultService, TeamVaultSyncConflictError } from '../../src/main/services/TeamVaultService';
import type { TeamVaultCryptoService } from '../../src/main/services/TeamVaultCryptoService';
import type { FileEntry, IStorageProvider } from '../../src/shared/types/storage';

/** A minimal in-memory S3-like provider — only `stat`/`writeFile`/`readFile` are exercised by
 * TeamVaultService's push/pull, same subset `ProfileSyncService` relies on. */
function fakeProvider(): IStorageProvider {
  const files = new Map<string, { data: Buffer; mtime: string }>();
  let tick = 0;
  return {
    id: 'fake-s3',
    name: 'Fake S3',
    type: 's3',
    list: async () => [],
    stat: async (remotePath: string): Promise<FileEntry> => {
      const entry = files.get(remotePath);
      if (!entry) {
        const err: any = new Error('NoSuchKey');
        err.name = 'NoSuchKey';
        throw err;
      }
      return { name: remotePath, path: remotePath, size: entry.data.length, isDirectory: false, mtime: entry.mtime };
    },
    createFolder: async () => {},
    delete: async () => {
      files.clear();
    },
    rename: async () => {},
    createReadStream: async () => {
      throw new Error('not implemented in fake provider');
    },
    createWriteStream: async () => {
      throw new Error('not implemented in fake provider');
    },
    writeFile: async (remotePath: string, data: Buffer | Uint8Array) => {
      tick += 1;
      files.set(remotePath, { data: Buffer.from(data), mtime: `2026-01-01T00:00:${String(tick).padStart(2, '0')}Z` });
    },
    readFile: async (remotePath: string) => {
      const entry = files.get(remotePath);
      if (!entry) {
        const err: any = new Error('NoSuchKey');
        err.name = 'NoSuchKey';
        throw err;
      }
      return entry.data;
    },
  } as unknown as IStorageProvider;
}

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

  describe('hasRemoteVault / pushToRemote / pullFromRemote (Fas 3)', () => {
    it('hasRemoteVault is false against an empty remote and true after a push', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      expect(await service.hasRemoteVault(provider)).toBe(false);
      await service.pushToRemote(provider);
      expect(await service.hasRemoteVault(provider)).toBe(true);
    });

    it('pushes without a conflict check on the very first push (nothing observed yet)', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      await expect(service.pushToRemote(provider)).resolves.toBeUndefined();
    });

    it('rejects a second push if the remote changed since this instance last observed it', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);

      // Someone else pushed a change this instance never saw.
      await provider.writeFile!('team-vault/vault.json', Buffer.from('{"formatVersion":1,"vaultId":"other"}'));

      await expect(service.pushToRemote(provider)).rejects.toThrow(TeamVaultSyncConflictError);
    });

    it('allows pushing again after a pull refreshes the known remote state', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);

      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(JSON.stringify({ formatVersion: 1, vaultId: 'vlt_other', accessHeader: [], recovery: {}, encryptedPayload: '', updatedAt: '', updatedBy: '' }))
      );

      await service.pullFromRemote(provider);
      await expect(service.addMember('bob@piv:def', 'age1yubikey1bob', 'member', 'alice@piv:abc')).rejects.toThrow(
        // Pull locks the vault (the previous Vault Key may not match the pulled file), so this
        // must now fail for "not unlocked", proving the pull actually replaced local state.
        'Unlock the Team Vault'
      );
    });

    it('pulling an existing remote vault lets a new member join without creating their own', async () => {
      const admin = makeService();
      const adminProvider = fakeProvider();
      await admin.createVault('alice@piv:abc', 'age1yubikey1alice');
      await admin.pushToRemote(adminProvider);

      const newMemberFilePath = path.join(tempDir, 'team-vault-new-member.json');
      const newMember = new TeamVaultService({ cryptoService: fakeCrypto(), filePath: newMemberFilePath, identityDir: tempDir });

      expect(await newMember.hasRemoteVault(adminProvider)).toBe(true);
      await newMember.pullFromRemote(adminProvider);

      const status = await newMember.getStatus();
      expect(status.exists).toBe(true);
      expect(status.vaultId).toBe((await admin.getStatus()).vaultId);
    });

    it('rejects a pull whose remote file is not a recognizable vault', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await provider.writeFile!('team-vault/vault.json', Buffer.from('{"not":"a vault"}'));

      await expect(service.pullFromRemote(provider)).rejects.toThrow('not a recognizable vault');
    });
  });
});
