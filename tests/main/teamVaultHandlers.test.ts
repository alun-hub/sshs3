import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';

const { mockReadSmartcardCertificates } = vi.hoisted(() => ({ mockReadSmartcardCertificates: vi.fn() }));
vi.mock('../../src/main/smartcard/SmartcardCertificateReader', () => ({
  readSmartcardCertificates: mockReadSmartcardCertificates,
}));

import { registerTeamVaultHandlers, type TeamVaultHost } from '../../src/main/ipc/teamVaultHandlers';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

describe('Team Vault IPC handlers', () => {
  const handlers = new Map<string, Handler>();
  const teamVaultService = {
    getStatus: vi.fn(),
    enrollOwnPivRecipient: vi.fn(),
    createVault: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    setRole: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    deleteVault: vi.fn(),
    resetRemoteState: vi.fn(),
    pushToRemote: vi.fn(),
    pullFromRemote: vi.fn(),
    hasRemoteVault: vi.fn(),
  };
  const teamVaultConfigStore = {
    getConfig: vi.fn().mockResolvedValue({}),
    setTarget: vi.fn(),
    setLastSyncAt: vi.fn(),
    setSelfIdentity: vi.fn(),
    clearSelfIdentity: vi.fn(),
  };
  const syncConfigStore = {
    getConfig: vi.fn().mockResolvedValue({}),
  };
  const storageRegistry = {
    getOrCreate: vi.fn().mockResolvedValue({}),
    disconnect: vi.fn(),
  };
  const buildTeamVaultStatus = vi.fn().mockResolvedValue({ exists: false, unlocked: false, filePath: '/x' });

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    teamVaultService.getStatus.mockResolvedValue({ exists: false, unlocked: false, filePath: '/x' });
    teamVaultConfigStore.getConfig.mockResolvedValue({});
    syncConfigStore.getConfig.mockResolvedValue({});
    mockReadSmartcardCertificates.mockResolvedValue(new Map());
    storageRegistry.getOrCreate.mockResolvedValue({});
    buildTeamVaultStatus.mockResolvedValue({ exists: false, unlocked: false, filePath: '/x' });
    registerTeamVaultHandlers({
      registerHandler: (channel: string, h: Handler) => void handlers.set(channel, h),
      teamVaultService,
      teamVaultConfigStore,
      syncConfigStore,
      storageRegistry,
      buildTeamVaultStatus,
    } as unknown as TeamVaultHost);
  });

  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

  const VALID_RECIPIENT = `age1${'a'.repeat(30)}`;

  describe('TEAM_VAULT_CREATE', () => {
    it('rejects a flag-like age recipient (argument-injection guard)', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_CREATE, 'alice', '-o/etc/passwd')).rejects.toThrow(
        'Age recipient must be a valid age recipient string'
      );
      expect(teamVaultService.createVault).not.toHaveBeenCalled();
    });

    it('rejects a missing recipient id', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_CREATE, '  ', VALID_RECIPIENT)).rejects.toThrow(
        'Recipient id is required'
      );
    });

    it('accepts a well-formed call', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_CREATE, 'alice@piv:abc', VALID_RECIPIENT);
      expect(teamVaultService.createVault).toHaveBeenCalledWith('alice@piv:abc', VALID_RECIPIENT);
    });

    it('remembers the chosen recipient id for unlock-form prefill, once creation succeeds', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_CREATE, 'alice@piv:abc', VALID_RECIPIENT);
      expect(teamVaultConfigStore.setSelfIdentity).toHaveBeenCalledWith('alice@piv:abc', undefined);
    });
  });

  describe('TEAM_VAULT_ENROLL_RECIPIENT', () => {
    it('remembers the generated identity file path for unlock-form prefill', async () => {
      teamVaultService.enrollOwnPivRecipient.mockResolvedValue({
        recipient: VALID_RECIPIENT,
        identityFilePath: '/home/alice/.config/sshs3/team-vault-identities/abc.txt',
      });
      await call(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT);
      expect(teamVaultConfigStore.setSelfIdentity).toHaveBeenCalledWith(
        undefined,
        '/home/alice/.config/sshs3/team-vault-identities/abc.txt'
      );
    });

    it("never overwrites the remembered identity for an EXISTING vault — \"Generate my recipient\" is now always visible (for a future second team), and must not clobber what unlock() needs for the current one", async () => {
      // Regression found via real-world use: generating an extra recipient while a vault already
      // exists silently overwrote the identity file unlock() needed for that existing vault,
      // producing "no identity matched any of the recipients" on the next unlock attempt.
      teamVaultService.getStatus.mockResolvedValue({ exists: true, unlocked: true, filePath: '/x' });
      teamVaultService.enrollOwnPivRecipient.mockResolvedValue({
        recipient: VALID_RECIPIENT,
        identityFilePath: '/tmp/a-fresh-identity-for-some-other-team.txt',
      });

      await call(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT);
      expect(teamVaultConfigStore.setSelfIdentity).not.toHaveBeenCalled();
    });

    it('suggests the UPN from the auth-capable smartcard certificate as a default label', async () => {
      teamVaultService.enrollOwnPivRecipient.mockResolvedValue({
        recipient: VALID_RECIPIENT,
        identityFilePath: '/tmp/identity.txt',
      });
      syncConfigStore.getConfig.mockResolvedValue({ smartcardSync: { pkcs11LibPath: '/usr/lib/opensc-pkcs11.so' } });
      mockReadSmartcardCertificates.mockResolvedValue(
        new Map([
          ['fp1', { authCapable: false, upn: 'not-this-one@example.com' }],
          ['fp2', { authCapable: true, upn: 'alice@example.com' }],
        ])
      );

      const result = await call(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT);
      expect(mockReadSmartcardCertificates).toHaveBeenCalledWith('/usr/lib/opensc-pkcs11.so');
      expect(result).toMatchObject({ suggestedLabel: 'alice@example.com' });
    });

    it('never blocks enroll when no pkcs11 path is configured', async () => {
      teamVaultService.enrollOwnPivRecipient.mockResolvedValue({ recipient: VALID_RECIPIENT, identityFilePath: '/tmp/x' });
      syncConfigStore.getConfig.mockResolvedValue({});

      const result = await call(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT);
      expect(mockReadSmartcardCertificates).not.toHaveBeenCalled();
      expect((result as any).suggestedLabel).toBeUndefined();
    });

    it('never blocks enroll when cert reading fails (best-effort only)', async () => {
      teamVaultService.enrollOwnPivRecipient.mockResolvedValue({ recipient: VALID_RECIPIENT, identityFilePath: '/tmp/x' });
      syncConfigStore.getConfig.mockResolvedValue({ smartcardSync: { pkcs11LibPath: '/bad/path.so' } });
      mockReadSmartcardCertificates.mockRejectedValue(new Error('no card reader found'));

      const result = await call(IPC_CHANNELS.TEAM_VAULT_ENROLL_RECIPIENT);
      expect((result as any).recipient).toBe(VALID_RECIPIENT);
      expect((result as any).suggestedLabel).toBeUndefined();
    });
  });

  describe('TEAM_VAULT_DELETE', () => {
    it('deletes the vault and forgets the remembered self-identity', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_DELETE);
      expect(teamVaultService.deleteVault).toHaveBeenCalled();
      expect(teamVaultConfigStore.clearSelfIdentity).toHaveBeenCalled();
    });
  });

  describe('TEAM_VAULT_ADD_MEMBER', () => {
    it('rejects an invalid role', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER, 'bob', VALID_RECIPIENT, 'superadmin')).rejects.toThrow(
        'Invalid role'
      );
    });

    it('rejects a non-age-shaped recipient string', async () => {
      await expect(
        call(IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER, 'bob', 'not-a-recipient', 'member')
      ).rejects.toThrow('must be a valid age recipient string');
    });

    it('never accepts an addedBy argument — attribution comes only from the unlocked session', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER, 'bob', VALID_RECIPIENT, 'member');
      expect(teamVaultService.addMember).toHaveBeenCalledWith('bob', VALID_RECIPIENT, 'member');
    });
  });

  describe('TEAM_VAULT_UNLOCK', () => {
    it('rejects a relative identity file path', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_UNLOCK, 'alice', 'identity.txt')).rejects.toThrow(
        'must be an absolute path'
      );
    });

    it('rejects a flag-like identity file path', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_UNLOCK, 'alice', '--output=/etc/passwd')).rejects.toThrow(
        'must be an absolute path'
      );
    });

    it('accepts a well-formed absolute path', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_UNLOCK, 'alice', '/tmp/identity.txt');
      expect(teamVaultService.unlock).toHaveBeenCalledWith('alice', '/tmp/identity.txt');
    });

    it('remembers both the recipient id and identity file path for next time, once unlock succeeds', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_UNLOCK, 'alice', '/tmp/identity.txt');
      expect(teamVaultConfigStore.setSelfIdentity).toHaveBeenCalledWith('alice', '/tmp/identity.txt');
    });
  });

  describe('TEAM_VAULT_SET_ROLE', () => {
    it('rejects an invalid role', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_SET_ROLE, 'bob', 'owner')).rejects.toThrow('Invalid role');
    });

    it('never accepts an updatedBy argument — attribution comes only from the unlocked session', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_SET_ROLE, 'bob', 'admin');
      expect(teamVaultService.setRole).toHaveBeenCalledWith('bob', 'admin');
    });
  });

  describe('TEAM_VAULT_REMOVE_MEMBER', () => {
    it('never accepts a removedBy argument — attribution comes only from the unlocked session', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_REMOVE_MEMBER, 'bob');
      expect(teamVaultService.removeMember).toHaveBeenCalledWith('bob');
    });
  });

  describe('TEAM_VAULT_GET_STATUS / TEAM_VAULT_LOCK', () => {
    it('delegate straight through with no extra arguments', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_GET_STATUS);
      expect(buildTeamVaultStatus).toHaveBeenCalled();
      await call(IPC_CHANNELS.TEAM_VAULT_LOCK);
      expect(teamVaultService.lock).toHaveBeenCalled();
    });
  });

  describe('TEAM_VAULT_SET_TARGET', () => {
    const s3Target = { id: 't1', name: 'Team bucket', type: 's3' as const };

    it('rejects a non-S3 target', async () => {
      await expect(
        call(IPC_CHANNELS.TEAM_VAULT_SET_TARGET, { id: 't1', name: 'x', type: 'sftp' }, 'bucket')
      ).rejects.toThrow('only supports an S3-compatible target');
    });

    it('rejects a missing bucket/remoteBasePath', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_SET_TARGET, s3Target, '')).rejects.toThrow(
        'requires a bucket'
      );
    });

    it('persists the target and resets the remote-state cache', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_SET_TARGET, s3Target, 'team-bucket');
      expect(teamVaultConfigStore.setTarget).toHaveBeenCalledWith(s3Target, 'team-bucket');
      expect(teamVaultService.resetRemoteState).toHaveBeenCalled();
    });
  });

  describe('TEAM_VAULT_PUSH / TEAM_VAULT_PULL / TEAM_VAULT_HAS_REMOTE_VAULT', () => {
    it('rejects push/pull when no target is configured', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_PUSH)).rejects.toThrow('Configure a Team Vault target first');
      await expect(call(IPC_CHANNELS.TEAM_VAULT_PULL)).rejects.toThrow('Configure a Team Vault target first');
    });

    it('pushes via the configured target and records the sync timestamp', async () => {
      teamVaultConfigStore.getConfig.mockResolvedValue({ target: { id: 't1', type: 's3' }, remoteBasePath: 'b' });
      await call(IPC_CHANNELS.TEAM_VAULT_PUSH);
      expect(teamVaultService.pushToRemote).toHaveBeenCalledWith({}, 'b');
      expect(teamVaultConfigStore.setLastSyncAt).toHaveBeenCalled();
    });

    it('pulls via the configured target and records the sync timestamp', async () => {
      teamVaultConfigStore.getConfig.mockResolvedValue({ target: { id: 't1', type: 's3' }, remoteBasePath: 'b' });
      await call(IPC_CHANNELS.TEAM_VAULT_PULL);
      expect(teamVaultService.pullFromRemote).toHaveBeenCalledWith({}, 'b');
      expect(teamVaultConfigStore.setLastSyncAt).toHaveBeenCalled();
    });

    it('hasRemoteVault returns false with no target configured, without touching the provider', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_HAS_REMOTE_VAULT)).resolves.toBe(false);
      expect(storageRegistry.getOrCreate).not.toHaveBeenCalled();
    });
  });
});
