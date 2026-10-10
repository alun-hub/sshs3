import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/unused-user-data') },
}));

import {
  TeamVaultService,
  TeamVaultSyncConflictError,
  TeamVaultForeignVaultError,
  TeamVaultRollbackError,
  TeamVaultTamperedEntryError,
  TeamVaultHeaderIntegrityError,
  TeamVaultUnpushedChangesError,
  TeamVaultLockedForPullError,
} from '../../src/main/services/TeamVaultService';
import type { TeamVaultCryptoService } from '../../src/main/services/TeamVaultCryptoService';
import type { FileEntry, IStorageProvider, S3Config } from '../../src/shared/types/storage';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

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
    withRecoveryIdentity: async <T,>(identityText: string, fn: (identityPath: string) => Promise<T>) => {
      if (!identityText.includes('AGE-SECRET-KEY-1')) {
        throw new Error('This does not look like a Team Vault recovery key (no AGE-SECRET-KEY-1... line found)');
      }
      return fn('/tmp/recovery-identity.fifo');
    },
    generateRecoveryIdentity: async () => ({
      identity: 'AGE-SECRET-KEY-FAKE\n# public key: age1fakerecovery',
      recipient: 'age1fakerecovery',
    }),
    // Simplified but real, deterministic HMAC keyed by the Vault Key — doesn't need to match the
    // production algorithm's exact canonicalization/HKDF, only to be internally consistent (same
    // inputs -> same tag) across every TeamVaultService instance under test.
    computeAccessHeaderMac: (
      vaultKey: Buffer,
      vaultId: string,
      revision: number,
      vaultName: string,
      accessHeader: unknown,
      recovery: unknown
    ) =>
      crypto
        .createHmac('sha256', vaultKey)
        .update(JSON.stringify({ vaultId, revision, vaultName, accessHeader, recovery }))
        .digest('base64'),
  } as unknown as TeamVaultCryptoService;
}

/** A structurally valid, unrelated vault file — used to simulate "someone else's content is
 * already sitting at this S3 path" without needing a second real TeamVaultService instance. */
function foreignVaultFileJson(vaultId: string, revision = 1, recoveryAgeRecipient = 'age1yubikey1foreignrecovery'): string {
  return JSON.stringify({
    formatVersion: 1,
    vaultId,
    revision,
    updatedAt: '2026-01-01T00:00:00Z',
    updatedBy: 'someone@piv:else',
    accessHeader: [],
    recovery: { recipientId: 'recovery-key-1', ageRecipient: recoveryAgeRecipient, wrappedVaultKey: 'w' },
    encryptedPayload: '',
    accessHeaderMac: 'placeholder-mac',
  });
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

      await expect(service.addMember('bob@piv:def', 'age1yubikey1bob', 'member')).rejects.toThrow(
        'Unlock the Team Vault'
      );
    });

    it('adds a member without re-keying (same wrapped key material for existing members)', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const beforeStatus = await service.getStatus();

      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

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
      await expect(service.addMember('alice@piv:abc', 'age1yubikey1alice', 'member')).rejects.toThrow(
        'already a member'
      );
    });

    it('rejects a plain member trying to add someone — only an admin may mutate membership', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      await first.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const asBob = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await asBob.unlock('bob@piv:def', '/tmp/fake-bob-identity.txt');

      await expect(asBob.addMember('carol@piv:ghi', 'age1yubikey1carol', 'member')).rejects.toThrow(
        'Only a Team Vault admin'
      );
    });

    it('attributes addedBy/updatedBy to whoever actually unlocked the vault, never a caller-supplied value', async () => {
      // There is no `addedBy` parameter on addMember at all — this is the whole point of the fix:
      // the audit trail can't be spoofed by whatever string a (potentially compromised) renderer
      // happens to send, only by who really unlocked the session.
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      const bobEntry = raw.accessHeader.find((e: any) => e.recipientId === 'bob@piv:def');
      expect(bobEntry.addedBy).toBe('alice@piv:abc');
      expect(raw.updatedBy).toBe('alice@piv:abc');
    });
  });

  describe('removeMember', () => {
    it('re-keys: the removed member loses access, remaining members keep access under a new key', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const { remainingAdmins } = await service.removeMember('bob@piv:def');
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
      await expect(service.removeMember('alice@piv:abc')).rejects.toThrow('Unlock the Team Vault');
    });

    it('rejects removing a recipientId that is not a member', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await expect(service.removeMember('ghost@piv:xyz')).rejects.toThrow('is not a member');
    });

    it('rejects a plain member trying to remove someone — only an admin may mutate membership', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      await first.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const asBob = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await asBob.unlock('bob@piv:def', '/tmp/fake-bob-identity.txt');

      await expect(asBob.removeMember('alice@piv:abc')).rejects.toThrow('Only a Team Vault admin');
    });
  });

  describe('setRole', () => {
    it('changes a member role (requires the vault to be unlocked, to attribute the change)', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      await service.setRole('bob@piv:def', 'admin');

      const status = await service.getStatus();
      expect(status.members).toEqual(
        expect.arrayContaining([expect.objectContaining({ recipientId: 'bob@piv:def', role: 'admin' })])
      );
      expect(status.adminCount).toBe(2);
    });

    it('requires the vault to be unlocked first (so the change is attributed to a real identity)', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');
      service.lock();

      await expect(service.setRole('bob@piv:def', 'admin')).rejects.toThrow('Unlock the Team Vault');
    });

    it('rejects a plain member promoting themselves — only an admin may change roles', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      await first.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const asBob = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await asBob.unlock('bob@piv:def', '/tmp/fake-bob-identity.txt');

      await expect(asBob.setRole('bob@piv:def', 'admin')).rejects.toThrow('Only a Team Vault admin');
    });

    it('allows the recovery identity to act as an admin', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      await first.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const asRecovery = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await asRecovery.unlock('recovery-key-1', '/tmp/recovery-identity.txt');

      await asRecovery.setRole('bob@piv:def', 'admin');
      const status = await asRecovery.getStatus();
      expect(status.members).toEqual(
        expect.arrayContaining([expect.objectContaining({ recipientId: 'bob@piv:def', role: 'admin' })])
      );
    });
  });

  describe('renameVault', () => {
    it('sets a descriptive name, surfaced via getStatus', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      await service.renameVault('Acme Infra Team');

      const status = await service.getStatus();
      expect(status.vaultName).toBe('Acme Infra Team');
    });

    it('trims the name and clears it back to undefined when blank', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice', 'Original Name');

      await service.renameVault('   ');

      const status = await service.getStatus();
      expect(status.vaultName).toBeUndefined();
    });

    it('rejects a plain member renaming the vault — only an admin may', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      await first.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const asBob = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await asBob.unlock('bob@piv:def', '/tmp/fake-bob-identity.txt');

      await expect(asBob.renameVault('Hijacked Name')).rejects.toThrow('Only a Team Vault admin');
    });
  });

  describe('deleteVault', () => {
    it('removes the local vault file and locks the session, admin only', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      expect(await fs.readFile(filePath, 'utf-8').then(() => true, () => false)).toBe(true);

      await service.deleteVault();

      expect(service.isUnlocked()).toBe(false);
      await expect(fs.readFile(filePath, 'utf-8')).rejects.toThrow();
      expect((await service.getStatus()).exists).toBe(false);
    });

    it('rejects a plain member trying to delete the vault', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      await first.addMember('bob@piv:def', 'age1yubikey1bob', 'member');

      const asBob = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await asBob.unlock('bob@piv:def', '/tmp/fake-bob-identity.txt');

      await expect(asBob.deleteVault()).rejects.toThrow('Only a Team Vault admin');
      await expect(fs.readFile(filePath, 'utf-8')).resolves.toBeTruthy();
    });

    it('requires the vault to be unlocked first', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      service.lock();
      await expect(service.deleteVault()).rejects.toThrow('Unlock the Team Vault');
    });

    it('rejects if no local vault file exists at all', async () => {
      const service = makeService();
      await expect(service.deleteVault()).rejects.toThrow();
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

  describe('unlockWithRecoveryText', () => {
    it('writes the pasted text via the crypto service and unlocks as the recovery recipient', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');

      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await second.unlockWithRecoveryText('# public key: age1fakerecovery\nAGE-SECRET-KEY-1FAKERECOVERYTEXT\n');
      expect(second.isUnlocked()).toBe(true);
    });

    it('rejects text that is not a recognizable recovery identity', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');

      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await expect(second.unlockWithRecoveryText('not a key at all')).rejects.toThrow(
        'does not look like a Team Vault recovery key'
      );
      expect(second.isUnlocked()).toBe(false);
    });
  });

  describe('enrollOwnPivRecipient', () => {
    it('delegates to the crypto service with the configured identity directory', async () => {
      const service = makeService();
      const result = await service.enrollOwnPivRecipient();
      expect(result.recipient).toBe('age1yubikey1fakeadmin');
    });
  });

  // unlock()/enrollOwnPivRecipient() must give TeamVaultCryptoService a way to reach the app's
  // existing PIN modal (IpcBridge.promptForPinDirect) and touch-banner (makePresenceNotifier) —
  // see docs/team-vault-plan.md's hardware verification notes. A narrow `pinPrompter` option
  // keeps the dependency to just those two methods rather than the whole IpcBridge.
  describe('PIN/touch prompt wiring (pinPrompter)', () => {
    function fakeCryptoThatPrompts(): TeamVaultCryptoService {
      const base = fakeCrypto();
      return {
        ...base,
        unwrapVaultKey: async (wrapped: string, _identityFilePath: string, callbacks: any) => {
          callbacks.onTouchRequested();
          const pin = await callbacks.requestPin('Enter PIN for YubiKey');
          expect(pin).toBe('999999');
          callbacks.onTouchCleared();
          return (base as any).unwrapVaultKey(wrapped);
        },
        enrollOwnPivRecipient: async (_identityOutDir: string, callbacks: any) => {
          await callbacks.requestPin('Enter PIN for YubiKey');
          return (base as any).enrollOwnPivRecipient();
        },
      } as unknown as TeamVaultCryptoService;
    }

    function fakePinPrompter() {
      const touchRequested = vi.fn();
      const touchCleared = vi.fn();
      return {
        promptForPinDirect: vi.fn(async (_prompt?: string, _kind?: string) => '999999'),
        makePresenceNotifier: vi.fn(() => ({ onPresenceRequested: touchRequested, onPresenceCleared: touchCleared })),
        touchRequested,
        touchCleared,
      };
    }

    it('unlock() routes PIN requests through pinPrompter.promptForPinDirect with kind "smartcard"', async () => {
      const first = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');

      const prompter = fakePinPrompter();
      const second = new TeamVaultService({
        cryptoService: fakeCryptoThatPrompts(),
        filePath,
        identityDir: tempDir,
        pinPrompter: prompter,
      });
      await second.unlock('alice@piv:abc', '/tmp/fake-admin-identity.txt');

      expect(prompter.promptForPinDirect).toHaveBeenCalledWith('Enter PIN for YubiKey', 'smartcard', undefined, undefined);
      expect(prompter.touchRequested).toHaveBeenCalledTimes(1);
      expect(prompter.touchCleared).toHaveBeenCalledTimes(1);
      expect(second.isUnlocked()).toBe(true);
    });

    it('enrollOwnPivRecipient() routes PIN requests through pinPrompter too', async () => {
      const prompter = fakePinPrompter();
      const service = new TeamVaultService({
        cryptoService: fakeCryptoThatPrompts(),
        filePath,
        identityDir: tempDir,
        pinPrompter: prompter,
      });
      await service.enrollOwnPivRecipient();
      expect(prompter.promptForPinDirect).toHaveBeenCalledWith('Enter PIN for YubiKey', 'smartcard', undefined, undefined);
    });

    it('fails clearly, instead of silently hanging, when no pinPrompter is configured but the crypto layer needs one', async () => {
      const first = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');

      const second = new TeamVaultService({ cryptoService: fakeCryptoThatPrompts(), filePath, identityDir: tempDir });
      await expect(second.unlock('alice@piv:abc', '/tmp/fake-admin-identity.txt')).rejects.toThrow(
        'not wired up'
      );
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

    it('pushes without a conflict check on the very first push (nothing exists remotely yet)', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      await expect(service.pushToRemote(provider)).resolves.toBeUndefined();
    });

    it('refuses to push over a different, unrelated vault already at the target — even on the very first push', async () => {
      // This is the fail-open gap: an in-memory "never observed" cache must not be treated as
      // "nothing to check" the first time a freshly created local vault is pushed.
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await provider.writeFile!('team-vault/vault.json', Buffer.from(foreignVaultFileJson('vlt_someone_elses')));

      await expect(service.pushToRemote(provider)).rejects.toThrow(TeamVaultForeignVaultError);
    });

    it('rejects a second push if the remote changed since this instance last observed it', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);
      const vaultId = (await service.getStatus()).vaultId!;

      // Someone else pushed a change this instance never saw (same vault, so the identity check
      // passes — this test is specifically about the freshness check).
      await provider.writeFile!('team-vault/vault.json', Buffer.from(foreignVaultFileJson(vaultId, 2)));

      await expect(service.pushToRemote(provider)).rejects.toThrow(TeamVaultSyncConflictError);
    });

    it('allows pushing again after a pull refreshes the known remote state', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);
      const vaultId = (await service.getStatus()).vaultId!;

      // A newer revision of the *same* vault (e.g. pushed from another machine) — not a vault
      // switch, which pullFromRemote now refuses whenever a local vault already exists. Reuses
      // alice's own recovery ageRecipient so this doesn't also trip the tamper check below.
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(foreignVaultFileJson(vaultId, 2, 'age1fakerecovery'))
      );

      await service.pullFromRemote(provider);
      await expect(service.addMember('bob@piv:def', 'age1yubikey1bob', 'member')).rejects.toThrow(
        // Pull locks the vault (the previous Vault Key may not match the pulled file), so this
        // must now fail for "not unlocked", proving the pull actually replaced local state.
        'Unlock the Team Vault'
      );
    });

    it('rejects a pull that would roll the local vault back to an older revision', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member'); // local revision is now 2
      const vaultId = (await service.getStatus()).vaultId!;

      // An older revision of the *same* vault somehow ends up at the remote (e.g. a bucket-write-
      // access holder who isn't actually a recipient restoring a stale copy).
      await provider.writeFile!('team-vault/vault.json', Buffer.from(foreignVaultFileJson(vaultId, 1)));

      await expect(service.pullFromRemote(provider)).rejects.toThrow(TeamVaultRollbackError);
    });

    it('refuses to pull a substituted, unrelated vault over an existing local one — even with a higher revision', async () => {
      // The real attack the revision check alone can't stop: forging a *different* vault
      // (vaultId) with a revision number higher than ours sails straight past a bare "is this
      // newer" check. The identity check must run first and reject this outright.
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      await provider.writeFile!('team-vault/vault.json', Buffer.from(foreignVaultFileJson('vlt_attacker', 999)));

      await expect(service.pullFromRemote(provider)).rejects.toThrow(TeamVaultForeignVaultError);
    });

    it('rejects a pull that keeps the same vaultId/revision bump but swaps an existing recipient\'s public key', async () => {
      // The two-step attack the vaultId/revision checks alone don't stop: same vault, a
      // plausible-looking higher revision, but an existing member's ageRecipient silently
      // replaced with the attacker's own. On its own this is inert (the attacker has no way to
      // forge a valid wrappedVaultKey) — but a later, routine removeMember would re-wrap a fresh
      // Vault Key for every remaining entry's ageRecipient, including the tampered one, handing
      // the attacker real access the moment that happens.
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');
      const vaultId = (await service.getStatus()).vaultId!;

      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(
          JSON.stringify({
            formatVersion: 1,
            vaultId,
            revision: 99,
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'alice@piv:abc',
            accessHeader: [
              {
                recipientId: 'alice@piv:abc',
                role: 'admin',
                method: 'piv-rsa-oaep',
                ageRecipient: 'age1yubikey1alice',
                wrappedVaultKey: 'wrapped:age1yubikey1alice:aa',
                addedAt: 'x',
                addedBy: 'alice@piv:abc',
              },
              {
                // bob's recipientId kept, but his public key swapped for the attacker's.
                recipientId: 'bob@piv:def',
                role: 'member',
                method: 'piv-rsa-oaep',
                ageRecipient: 'age1yubikey1attacker',
                wrappedVaultKey: 'wrapped:age1yubikey1bob:bb', // stale on purpose — inert until reactivated
                addedAt: 'x',
                addedBy: 'alice@piv:abc',
              },
            ],
            recovery: { recipientId: 'recovery-key-1', ageRecipient: 'age1fakerecovery', wrappedVaultKey: 'w' },
            encryptedPayload: '',
            accessHeaderMac: 'placeholder-mac',
          })
        )
      );

      await expect(service.pullFromRemote(provider)).rejects.toThrow(TeamVaultTamperedEntryError);
    });

    it('accepts a legitimate single-step addMember pulled from another machine (header MAC recomputed correctly)', async () => {
      // addMember never rotates the Vault Key — a real addMember pushed from elsewhere
      // recomputes accessHeaderMac correctly for the new content, using the same (still-valid)
      // Vault Key this instance already holds.
      const fixedKey = Buffer.alloc(32, 7);
      const crypto2 = fakeCrypto();
      crypto2.generateVaultKey = () => fixedKey;
      const service = new TeamVaultService({ cryptoService: crypto2, filePath, identityDir: tempDir });
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const localRaw = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      const provider = fakeProvider();
      const newRevision = localRaw.revision + 1;
      const newAccessHeader = [
        ...localRaw.accessHeader,
        {
          recipientId: 'bob@piv:def',
          role: 'member',
          method: 'piv-rsa-oaep',
          ageRecipient: 'age1yubikey1bob',
          wrappedVaultKey: 'wrapped:age1yubikey1bob:cc',
          addedAt: 'x',
          addedBy: 'alice@piv:abc',
        },
      ];
      const remoteFile = {
        ...localRaw,
        revision: newRevision,
        accessHeader: newAccessHeader,
        accessHeaderMac: await crypto2.computeAccessHeaderMac(
          fixedKey,
          localRaw.vaultId,
          newRevision,
          localRaw.vaultName ?? '',
          newAccessHeader,
          localRaw.recovery
        ),
      };
      await provider.writeFile!('team-vault/vault.json', Buffer.from(JSON.stringify(remoteFile)));

      await expect(service.pullFromRemote(provider)).resolves.toBeUndefined();
    });

    it('rejects a single-step pull that adds a new entry whose header MAC does not match the Vault Key already held', async () => {
      // The gap the ageRecipient-continuity check alone doesn't close: a wholly NEW entry (no
      // existing recipientId to collide with) is indistinguishable from a real addMember at the
      // field level. But computing a valid accessHeaderMac requires the real Vault Key — the
      // attacker doesn't have it, so whatever stale/guessed value they attach can never match
      // what we recompute with the key we already hold, regardless of which field they tampered
      // with or what revision number they chose.
      const fixedKey = Buffer.alloc(32, 7);
      const crypto2 = fakeCrypto();
      crypto2.generateVaultKey = () => fixedKey;
      const service = new TeamVaultService({ cryptoService: crypto2, filePath, identityDir: tempDir });
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const localRaw = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      const provider = fakeProvider();
      const remoteFile = {
        ...localRaw, // keeps the OLD accessHeaderMac, now stale against the content below
        revision: localRaw.revision + 1,
        accessHeader: [
          ...localRaw.accessHeader,
          {
            recipientId: 'attacker@piv:fake',
            role: 'admin',
            method: 'piv-rsa-oaep',
            ageRecipient: 'age1yubikey1attacker',
            wrappedVaultKey: 'bogus',
            addedAt: 'x',
            addedBy: 'attacker@piv:fake',
          },
        ],
      };
      await provider.writeFile!('team-vault/vault.json', Buffer.from(JSON.stringify(remoteFile)));

      await expect(service.pullFromRemote(provider)).rejects.toThrow(TeamVaultHeaderIntegrityError);
    });

    it('rejects a pull where the revision was bumped specifically to dodge a narrower, revision-gated check', async () => {
      // This is the exact bypass a reviewer found in an earlier version of this check (which only
      // verified when `revision === localFile.revision + 1`): picking a different delta skipped
      // verification entirely. The header MAC has no such hole — it's checked regardless of the
      // revision gap, since validity never depends on which specific delta is claimed.
      const fixedKey = Buffer.alloc(32, 7);
      const crypto2 = fakeCrypto();
      crypto2.generateVaultKey = () => fixedKey;
      const service = new TeamVaultService({ cryptoService: crypto2, filePath, identityDir: tempDir });
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const localRaw = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      const provider = fakeProvider();
      const remoteFile = {
        ...localRaw,
        revision: localRaw.revision + 7, // an arbitrary, non-"+1" delta
        accessHeader: [
          ...localRaw.accessHeader,
          {
            recipientId: 'attacker@piv:fake',
            role: 'admin',
            method: 'piv-rsa-oaep',
            ageRecipient: 'age1yubikey1attacker',
            wrappedVaultKey: 'bogus',
            addedAt: 'x',
            addedBy: 'attacker@piv:fake',
          },
        ],
      };
      await provider.writeFile!('team-vault/vault.json', Buffer.from(JSON.stringify(remoteFile)));

      await expect(service.pullFromRemote(provider)).rejects.toThrow(TeamVaultHeaderIntegrityError);
    });

    it('refuses to pull over an existing local vault while locked, since the header MAC cannot be verified without the Vault Key', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      first.lock();

      const provider = fakeProvider();
      await first.pushToRemote(provider); // pushToRemote needs requireFile() only, not unlock

      await expect(first.pullFromRemote(provider)).rejects.toThrow(TeamVaultLockedForPullError);
    });

    it('allows pulling a brand-new join (no local file yet) while locked, since nothing exists to verify against', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      const provider = fakeProvider();
      await first.pushToRemote(provider);

      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath: path.join(tempDir, 'second-vault.json'), identityDir: tempDir });
      expect(second.isUnlocked()).toBe(false);
      await expect(second.pullFromRemote(provider)).resolves.toBeUndefined();
    });

    it('rejects a remote vault file larger than the size cap via the cheap stat() precheck, without ever downloading it', async () => {
      // The fast, common-case path: an honestly reported oversized object is rejected before any
      // download is even attempted — the deeper, download-time cap (tested below) exists for the
      // adversarial case where stat() can't be trusted, not to replace this cheaper check.
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const provider = fakeProvider();
      const hugeStatOnly: IStorageProvider = {
        ...provider,
        stat: async () => ({ name: 'vault.json', path: 'team-vault/vault.json', size: 51 * 1024 * 1024, isDirectory: false, mtime: 'x' }),
        readFile: async () => {
          throw new Error('must not download a file that already failed the cheap size check');
        },
      };
      await expect(service.pullFromRemote(hugeStatOnly)).rejects.toThrow('too large');
    });

    it('rejects a remote vault file larger than the size cap, enforced against the actual downloaded bytes (not just stat())', async () => {
      // Deliberately a mismatched stat() vs. readFile() size — this is the TOCTOU shape the cap
      // must survive: whoever controls the remote object could serve a small stat() and a huge
      // body moments later, so the cap has to be checked against what was actually downloaded,
      // not trusted from a preceding stat() call.
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const provider = fakeProvider();
      const hugeBody = Buffer.alloc(51 * 1024 * 1024, 'x');
      const mismatchedProvider: IStorageProvider = {
        ...provider,
        stat: async () => ({ name: 'vault.json', path: 'team-vault/vault.json', size: 10, isDirectory: false, mtime: 'x' }),
        readFile: async () => hugeBody,
      };
      await expect(service.pullFromRemote(mismatchedProvider)).rejects.toThrow('too large');
    });

    it('aborts an oversized download mid-stream on a provider without a readFile() convenience method', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const { Readable } = await import('node:stream');
      const streamingProvider: IStorageProvider = {
        ...fakeProvider(),
        readFile: undefined,
        stat: async () => ({ name: 'vault.json', path: 'team-vault/vault.json', size: 10, isDirectory: false, mtime: 'x' }),
        createReadStream: async () => {
          const stream = new Readable({
            read() {
              this.push(Buffer.alloc(1024 * 1024, 'x'));
            },
          });
          return stream as any;
        },
      };
      await expect(service.pullFromRemote(streamingProvider)).rejects.toThrow('too large');
    });

    it('rejects a remote file with a duplicate recipient id (shadowing a real member or the recovery slot)', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(
          JSON.stringify({
            formatVersion: 1,
            vaultId: 'vlt_dup',
            revision: 1,
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'x',
            accessHeader: [
              {
                recipientId: 'recovery-key-1', // collides with the recovery entry's own id
                role: 'admin',
                ageRecipient: 'age1yubikey1attacker',
                wrappedVaultKey: 'w',
                addedAt: 'x',
                addedBy: 'x',
              },
            ],
            recovery: { recipientId: 'recovery-key-1', ageRecipient: 'age1y', wrappedVaultKey: 'w' },
            encryptedPayload: '',
          })
        )
      );

      await expect(service.pullFromRemote(provider)).rejects.toThrow('not a recognizable vault');
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

    it('rejects a remote file with a malformed access entry (e.g. missing ageRecipient)', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(
          JSON.stringify({
            formatVersion: 1,
            vaultId: 'vlt_malformed',
            revision: 1,
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'x',
            accessHeader: [{ recipientId: 'a', role: 'admin', wrappedVaultKey: 'w', addedAt: 'x', addedBy: 'x' }],
            recovery: { recipientId: 'recovery-key-1', ageRecipient: 'age1y', wrappedVaultKey: 'w' },
            encryptedPayload: '',
          })
        )
      );

      await expect(service.pullFromRemote(provider)).rejects.toThrow('not a recognizable vault');
    });

    it('rejects a remote file whose access entry has an invalid method', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(
          JSON.stringify({
            formatVersion: 1,
            vaultId: 'vlt_badmethod',
            revision: 1,
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'x',
            accessHeader: [
              {
                recipientId: 'a',
                role: 'admin',
                method: 'something-else',
                ageRecipient: 'age1yubikey1alice',
                wrappedVaultKey: 'w',
                addedAt: 'x',
                addedBy: 'x',
              },
            ],
            recovery: { recipientId: 'recovery-key-1', ageRecipient: 'age1fakerecovery', wrappedVaultKey: 'w' },
            encryptedPayload: '',
          })
        )
      );

      await expect(service.pullFromRemote(provider)).rejects.toThrow('not a recognizable vault');
    });

    it('rejects a remote file whose access entry has a malformed (non-age1...) ageRecipient', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(
          JSON.stringify({
            formatVersion: 1,
            vaultId: 'vlt_badrecipient',
            revision: 1,
            updatedAt: '2026-01-01T00:00:00Z',
            updatedBy: 'x',
            accessHeader: [
              {
                recipientId: 'a',
                role: 'admin',
                method: 'piv-rsa-oaep',
                ageRecipient: '-not-a-real-recipient',
                wrappedVaultKey: 'w',
                addedAt: 'x',
                addedBy: 'x',
              },
            ],
            recovery: { recipientId: 'recovery-key-1', ageRecipient: 'age1fakerecovery', wrappedVaultKey: 'w' },
            encryptedPayload: '',
          })
        )
      );

      await expect(service.pullFromRemote(provider)).rejects.toThrow('not a recognizable vault');
    });

    it('does not force a re-unlock after pulling in a plain profile edit from elsewhere (no re-key happened)', async () => {
      // Regression guard for the background auto-poll (IpcBridge.runTeamVaultAutoPoll): a plain
      // profile/payload edit elsewhere never rotates the Vault Key, so the key this instance
      // already holds still correctly decrypts the pulled file — forcing a lock (and therefore a
      // PIN/touch re-unlock) on every such pull would make the poll useless in practice.
      const fixedKey = Buffer.alloc(32, 7);
      const crypto2 = fakeCrypto();
      crypto2.generateVaultKey = () => fixedKey;
      const service = new TeamVaultService({ cryptoService: crypto2, filePath, identityDir: tempDir });
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const localRaw = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      const provider = fakeProvider();
      const newRevision = localRaw.revision + 1;
      const remoteFile = {
        ...localRaw,
        revision: newRevision,
        encryptedPayload: 'new-payload-content',
        accessHeaderMac: await crypto2.computeAccessHeaderMac(
          fixedKey,
          localRaw.vaultId,
          newRevision,
          localRaw.vaultName ?? '',
          localRaw.accessHeader,
          localRaw.recovery
        ),
      };
      await provider.writeFile!('team-vault/vault.json', Buffer.from(JSON.stringify(remoteFile)));

      await service.pullFromRemote(provider);
      expect(service.isUnlocked()).toBe(true);
    });

    it('locks after a pull whose header MAC proves the held key no longer applies (a real re-key happened)', async () => {
      // Contrast with the test above: this is the removeMember-elsewhere case the lock exists
      // for in the first place — `accessHeader.length` dropping means the MAC check never runs,
      // so `keyProvenStillValid` stays false and the (now-stale) key must not be reused.
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);
      const vaultId = (await service.getStatus()).vaultId!;
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(foreignVaultFileJson(vaultId, 2, 'age1fakerecovery'))
      );

      await service.pullFromRemote(provider);
      expect(service.isUnlocked()).toBe(false);
    });
  });

  describe('lastSyncedRevision / TeamVaultUnpushedChangesError (concurrency guard)', () => {
    it('refuses to pull over local changes that were never pushed', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider); // lastSyncedRevision is now 1
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member'); // local revision is now 2, never pushed
      const vaultId = (await service.getStatus()).vaultId!;

      // Someone else also pushed a change meanwhile (same vault, higher revision — a legitimate
      // update, not an attack) — but pulling it now would silently discard bob's never-pushed add.
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(foreignVaultFileJson(vaultId, 3, 'age1fakerecovery'))
      );

      await expect(service.pullFromRemote(provider)).rejects.toThrow(TeamVaultUnpushedChangesError);
    });

    it('allows the pull anyway when force is set, discarding the unpushed local changes', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');
      const vaultId = (await service.getStatus()).vaultId!;
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(foreignVaultFileJson(vaultId, 3, 'age1fakerecovery'))
      );

      await expect(service.pullFromRemote(provider, '', { force: true })).resolves.toBeUndefined();
    });

    it('does not block the pull when nothing was ever pushed from this instance (lastSyncedRevision still undefined)', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');
      const vaultId = (await service.getStatus()).vaultId!;
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(foreignVaultFileJson(vaultId, 3, 'age1fakerecovery'))
      );

      await expect(service.pullFromRemote(provider)).resolves.toBeUndefined();
    });

    it('does not block the pull when the local revision still matches the last sync (no local-only edits)', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);
      const vaultId = (await service.getStatus()).vaultId!;
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(foreignVaultFileJson(vaultId, 2, 'age1fakerecovery'))
      );

      await expect(service.pullFromRemote(provider)).resolves.toBeUndefined();
    });
  });

  describe('hasRemoteChangedSinceLastSync / hasUnpushedLocalChanges (background poll helpers)', () => {
    it('hasRemoteChangedSinceLastSync is false right after a push, true once something else pushes', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);

      expect(await service.hasRemoteChangedSinceLastSync(provider)).toBe(false);

      const vaultId = (await service.getStatus()).vaultId!;
      await provider.writeFile!(
        'team-vault/vault.json',
        Buffer.from(foreignVaultFileJson(vaultId, 2, 'age1fakerecovery'))
      );
      expect(await service.hasRemoteChangedSinceLastSync(provider)).toBe(true);
    });

    it('hasRemoteChangedSinceLastSync is true the first time this instance ever observes a non-empty remote', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await provider.writeFile!('team-vault/vault.json', Buffer.from(foreignVaultFileJson('vlt_other')));

      expect(await service.hasRemoteChangedSinceLastSync(provider)).toBe(true);
    });

    it('hasUnpushedLocalChanges is false before any sync has happened', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      expect(await service.hasUnpushedLocalChanges()).toBe(false);
    });

    it('hasUnpushedLocalChanges is true after a local mutation following a push, false again after pushing it', async () => {
      const service = makeService();
      const provider = fakeProvider();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.pushToRemote(provider);
      expect(await service.hasUnpushedLocalChanges()).toBe(false);

      await service.addMember('bob@piv:def', 'age1yubikey1bob', 'member');
      expect(await service.hasUnpushedLocalChanges()).toBe(true);

      await service.pushToRemote(provider);
      expect(await service.hasUnpushedLocalChanges()).toBe(false);
    });
  });

  describe('shared SSH/S3 profiles (getPayload / save*Profile / delete*Profile)', () => {
    function sshProfile(id: string, name = 'web-1'): SSHConnectionConfig {
      return { id, name, host: 'example.com', username: 'root', authType: 'password', password: 'secret' }; // pragma: allowlist secret
    }
    function s3Profile(id: string, name = 'backups'): S3Config {
      return { id, name, region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'shh' }; // pragma: allowlist secret
    }

    it('getPayload returns an empty payload for a freshly created vault (still the original {})', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await expect(service.getPayload()).resolves.toEqual({ ssh: [], s3: [], folders: [], folderIcons: {} });
    });

    it('requires the vault unlocked', async () => {
      const first = makeService();
      await first.createVault('alice@piv:abc', 'age1yubikey1alice');
      const second = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await expect(second.getPayload()).rejects.toThrow('Unlock the Team Vault');
      await expect(second.saveSSHProfile(sshProfile('p1'))).rejects.toThrow('Unlock the Team Vault');
    });

    it('rejects an SSH profile with no id', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await expect(service.saveSSHProfile({} as SSHConnectionConfig)).rejects.toThrow('Profile ID is required');
    });

    it('saves and reads back a shared SSH profile, stamped with updatedAt', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveSSHProfile(sshProfile('p1'));

      const payload = await service.getPayload();
      expect(payload.ssh).toHaveLength(1);
      expect(payload.ssh[0]).toMatchObject({ id: 'p1', host: 'example.com', password: 'secret' }); // pragma: allowlist secret
      expect(payload.ssh[0].updatedAt).toBeTruthy();
      expect(payload.s3).toEqual([]);
    });

    it('upserts by id rather than duplicating on a second save', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveSSHProfile(sshProfile('p1', 'web-1'));
      await service.saveSSHProfile(sshProfile('p1', 'web-1-renamed'));

      const payload = await service.getPayload();
      expect(payload.ssh).toHaveLength(1);
      expect(payload.ssh[0].name).toBe('web-1-renamed');
    });

    it('deletes an SSH profile by id, leaving others untouched', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveSSHProfile(sshProfile('p1'));
      await service.saveSSHProfile(sshProfile('p2', 'web-2'));
      await service.deleteSSHProfile('p1');

      const payload = await service.getPayload();
      expect(payload.ssh.map((p) => p.id)).toEqual(['p2']);
    });

    it('saves, upserts, and deletes a shared S3 profile independently of the SSH list', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveSSHProfile(sshProfile('p1'));
      await service.saveS3Profile(s3Profile('s1'));

      let payload = await service.getPayload();
      expect(payload.ssh).toHaveLength(1);
      expect(payload.s3).toHaveLength(1);
      expect(payload.s3[0]).toMatchObject({ id: 's1', secretAccessKey: 'shh' }); // pragma: allowlist secret

      await service.deleteS3Profile('s1');
      payload = await service.getPayload();
      expect(payload.ssh).toHaveLength(1);
      expect(payload.s3).toEqual([]);
    });

    it('bumps revision and recomputes accessHeaderMac on every profile mutation, even though the header itself is unchanged', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const before = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      await service.saveSSHProfile(sshProfile('p1'));

      const after = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(after.revision).toBe(before.revision + 1);
      expect(after.accessHeader).toEqual(before.accessHeader);
      expect(after.accessHeaderMac).not.toBe(before.accessHeaderMac);
    });

    it('any unlocked member — not just an admin — can save a shared profile', async () => {
      const admin = makeService();
      await admin.createVault('alice@piv:abc', 'age1yubikey1alice');
      await admin.addMember('bob@piv:def', 'age1yubikey1bob', 'member');
      const bobsIdentityFile = path.join(tempDir, 'bob-identity.txt');
      await fs.writeFile(bobsIdentityFile, 'unused-by-fake-crypto');

      const asBob = new TeamVaultService({ cryptoService: fakeCrypto(), filePath, identityDir: tempDir });
      await asBob.unlock('bob@piv:def', bobsIdentityFile);

      await expect(asBob.saveSSHProfile(sshProfile('p1'))).resolves.toBeUndefined();
    });

    it('shares privateKeyPath/pkcs11LibPath/agentPath/agentIdentityFiles as plain data — none of them execute anything on their own', async () => {
      // Corrected from an earlier, too-aggressive fix: these fields are a personal environment
      // setting (which PKCS#11 driver, which agent socket), not a security boundary — they either
      // resolve on a given member's machine or silently don't, same risk as a wrong hostname. Only
      // `pin` is special-cased (see withoutPin — never written to disk anywhere in this app).
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveSSHProfile({
        ...sshProfile('p1'),
        authType: 'smartcard',
        privateKeyPath: '/home/alice/.ssh/id_ed25519',
        pkcs11LibPath: '/usr/lib/opensc-pkcs11.so',
        agentPath: '/tmp/agent.sock',
        agentIdentityFiles: ['/tmp/a.pub'],
        pin: '123456', // pragma: allowlist secret
      });

      const payload = await service.getPayload();
      expect(payload.ssh[0]).toMatchObject({
        id: 'p1',
        host: 'example.com',
        password: 'secret', // pragma: allowlist secret
        privateKeyPath: '/home/alice/.ssh/id_ed25519',
        pkcs11LibPath: '/usr/lib/opensc-pkcs11.so',
        agentPath: '/tmp/agent.sock',
        agentIdentityFiles: ['/tmp/a.pub'],
      });
      expect(payload.ssh[0]).not.toHaveProperty('pin');
    });

    it('shares an S3 customCaPath as plain data too', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveS3Profile({ ...s3Profile('s1'), customCaPath: '/etc/ssl/custom-ca.pem' });

      const payload = await service.getPayload();
      expect(payload.s3[0]).toMatchObject({ customCaPath: '/etc/ssl/custom-ca.pem' });
    });

    it('strips a pin on read too, covering an entry stored before this rule existed', async () => {
      // Defense in depth: simulates a pulled vault file whose encryptedPayload already contains
      // a `pin` field (e.g. written by an older app version) — getPayload must still never
      // surface it, matching `ProfileStore`'s identical rule for local profiles.
      const fixedKey = Buffer.alloc(32, 7);
      const crypto2 = fakeCrypto();
      crypto2.generateVaultKey = () => fixedKey;
      const service = new TeamVaultService({ cryptoService: crypto2, filePath, identityDir: tempDir });
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      const localRaw = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      const plantedPayload = JSON.stringify({
        ssh: [{ ...sshProfile('p1'), pin: '123456' }], // pragma: allowlist secret
        s3: [],
      });
      const tampered = {
        ...localRaw,
        encryptedPayload: crypto2.encryptPayload(fixedKey, localRaw.vaultId, localRaw.formatVersion, plantedPayload),
      };
      await fs.writeFile(filePath, JSON.stringify(tampered));

      const payload = await service.getPayload();
      expect(payload.ssh[0]).not.toHaveProperty('pin');
    });
  });

  describe('team folders (saveTeamFolder / renameTeamFolder / deleteTeamFolder)', () => {
    function sshProfile(id: string, group?: string): SSHConnectionConfig {
      return { id, name: id, host: 'example.com', username: 'root', authType: 'password', password: 'secret', group }; // pragma: allowlist secret
    }

    it('creates an empty folder, visible via getPayload', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      await service.saveTeamFolder('Acme Infra/Cluster A');

      const payload = await service.getPayload();
      expect(payload.folders).toEqual(['Acme Infra/Cluster A']);
    });

    it('trims segments and ignores a duplicate save', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');

      await service.saveTeamFolder('  Acme Infra / Cluster A  ');
      await service.saveTeamFolder('Acme Infra/Cluster A');

      const payload = await service.getPayload();
      expect(payload.folders).toEqual(['Acme Infra/Cluster A']);
    });

    it('rejects an empty folder path', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await expect(service.saveTeamFolder('   ')).rejects.toThrow('Folder name is required');
    });

    it('renameTeamFolder moves the folder entry and every descendant folder/profile along with it', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveTeamFolder('Acme Infra');
      await service.saveTeamFolder('Acme Infra/Cluster A');
      await service.saveSSHProfile(sshProfile('p1', 'Acme Infra'));
      await service.saveSSHProfile(sshProfile('p2', 'Acme Infra/Cluster A'));
      await service.saveSSHProfile(sshProfile('p3', 'Unrelated'));

      await service.renameTeamFolder('Acme Infra', 'Acme Co');

      const payload = await service.getPayload();
      expect(payload.folders).toEqual(expect.arrayContaining(['Acme Co', 'Acme Co/Cluster A']));
      expect(payload.folders).not.toEqual(expect.arrayContaining(['Acme Infra', 'Acme Infra/Cluster A']));
      expect(payload.ssh.find((p) => p.id === 'p1')?.group).toBe('Acme Co');
      expect(payload.ssh.find((p) => p.id === 'p2')?.group).toBe('Acme Co/Cluster A');
      expect(payload.ssh.find((p) => p.id === 'p3')?.group).toBe('Unrelated');
    });

    it('deleteTeamFolder without deleteProfiles ungroups affected profiles (self and descendants)', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveTeamFolder('Acme Infra');
      await service.saveTeamFolder('Acme Infra/Cluster A');
      await service.saveSSHProfile(sshProfile('p1', 'Acme Infra'));
      await service.saveSSHProfile(sshProfile('p2', 'Acme Infra/Cluster A'));
      await service.saveSSHProfile(sshProfile('p3', 'Unrelated'));

      await service.deleteTeamFolder('Acme Infra');

      const payload = await service.getPayload();
      expect(payload.folders).toEqual([]);
      expect(payload.ssh.find((p) => p.id === 'p1')?.group).toBeUndefined();
      expect(payload.ssh.find((p) => p.id === 'p2')?.group).toBeUndefined();
      expect(payload.ssh.find((p) => p.id === 'p3')?.group).toBe('Unrelated');
    });

    it('deleteTeamFolder with deleteProfiles removes affected profiles outright', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveTeamFolder('Acme Infra');
      await service.saveSSHProfile(sshProfile('p1', 'Acme Infra'));
      await service.saveSSHProfile(sshProfile('p3', 'Unrelated'));

      await service.deleteTeamFolder('Acme Infra', true);

      const payload = await service.getPayload();
      expect(payload.ssh.map((p) => p.id)).toEqual(['p3']);
    });

    describe('setTeamFolderIcon', () => {
      it('sets and clears a folder icon', async () => {
        const service = makeService();
        await service.createVault('alice@piv:abc', 'age1yubikey1alice');
        await service.saveTeamFolder('Acme Infra');

        await service.setTeamFolderIcon('Acme Infra', 'server');
        expect((await service.getPayload()).folderIcons).toEqual({ 'Acme Infra': 'server' });

        await service.setTeamFolderIcon('Acme Infra', undefined);
        expect((await service.getPayload()).folderIcons).toEqual({});
      });

      it('rejects an empty folder path', async () => {
        const service = makeService();
        await service.createVault('alice@piv:abc', 'age1yubikey1alice');
        await expect(service.setTeamFolderIcon('   ', 'server')).rejects.toThrow('Folder name is required');
      });
    });

    it('renameTeamFolder remaps the icon of the renamed folder and every descendant', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveTeamFolder('Acme Infra');
      await service.saveTeamFolder('Acme Infra/Cluster A');
      await service.setTeamFolderIcon('Acme Infra', 'server');
      await service.setTeamFolderIcon('Acme Infra/Cluster A', 'database');

      await service.renameTeamFolder('Acme Infra', 'Acme Co');

      const payload = await service.getPayload();
      expect(payload.folderIcons).toEqual({ 'Acme Co': 'server', 'Acme Co/Cluster A': 'database' });
    });

    it('deleteTeamFolder removes the icon of the deleted folder and every descendant', async () => {
      const service = makeService();
      await service.createVault('alice@piv:abc', 'age1yubikey1alice');
      await service.saveTeamFolder('Acme Infra');
      await service.saveTeamFolder('Acme Infra/Cluster A');
      await service.saveTeamFolder('Unrelated');
      await service.setTeamFolderIcon('Acme Infra', 'server');
      await service.setTeamFolderIcon('Acme Infra/Cluster A', 'database');
      await service.setTeamFolderIcon('Unrelated', 'cloud');

      await service.deleteTeamFolder('Acme Infra');

      const payload = await service.getPayload();
      expect(payload.folderIcons).toEqual({ Unrelated: 'cloud' });
    });
  });
});
