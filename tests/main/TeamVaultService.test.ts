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
} from '../../src/main/services/TeamVaultService';
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
    // Simplified but real, deterministic HMAC keyed by the Vault Key — doesn't need to match the
    // production algorithm's exact canonicalization/HKDF, only to be internally consistent (same
    // inputs -> same tag) across every TeamVaultService instance under test.
    computeAccessHeaderMac: (vaultKey: Buffer, vaultId: string, revision: number, accessHeader: unknown, recovery: unknown) =>
      crypto
        .createHmac('sha256', vaultKey)
        .update(JSON.stringify({ vaultId, revision, accessHeader, recovery }))
        .digest('base64'),
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
                ageRecipient: 'age1yubikey1alice',
                wrappedVaultKey: 'wrapped:age1yubikey1alice:aa',
                addedAt: 'x',
                addedBy: 'alice@piv:abc',
              },
              {
                // bob's recipientId kept, but his public key swapped for the attacker's.
                recipientId: 'bob@piv:def',
                role: 'member',
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
  });
});
