import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTeamVaultHandlers, type TeamVaultHost } from '../../src/main/ipc/teamVaultHandlers';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';

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
    resetRemoteState: vi.fn(),
    pushToRemote: vi.fn(),
    pullFromRemote: vi.fn(),
    hasRemoteVault: vi.fn(),
  };
  const teamVaultConfigStore = {
    getConfig: vi.fn().mockResolvedValue({}),
    setTarget: vi.fn(),
    setLastSyncAt: vi.fn(),
  };
  const storageRegistry = {
    getOrCreate: vi.fn().mockResolvedValue({}),
    disconnect: vi.fn(),
  };
  const buildTeamVaultStatus = vi.fn().mockResolvedValue({ exists: false, unlocked: false, filePath: '/x' });

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    teamVaultConfigStore.getConfig.mockResolvedValue({});
    storageRegistry.getOrCreate.mockResolvedValue({});
    buildTeamVaultStatus.mockResolvedValue({ exists: false, unlocked: false, filePath: '/x' });
    registerTeamVaultHandlers({
      registerHandler: (channel: string, h: Handler) => void handlers.set(channel, h),
      teamVaultService,
      teamVaultConfigStore,
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
  });

  describe('TEAM_VAULT_ADD_MEMBER', () => {
    it('rejects an invalid role', async () => {
      await expect(
        call(IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER, 'bob', VALID_RECIPIENT, 'superadmin', 'alice')
      ).rejects.toThrow('Invalid role');
    });

    it('rejects a non-age-shaped recipient string', async () => {
      await expect(
        call(IPC_CHANNELS.TEAM_VAULT_ADD_MEMBER, 'bob', 'not-a-recipient', 'member', 'alice')
      ).rejects.toThrow('must be a valid age recipient string');
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
  });

  describe('TEAM_VAULT_SET_ROLE', () => {
    it('rejects an invalid role', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_SET_ROLE, 'bob', 'owner', 'alice')).rejects.toThrow(
        'Invalid role'
      );
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
