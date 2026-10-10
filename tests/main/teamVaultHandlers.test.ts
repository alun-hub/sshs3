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
    renameVault: vi.fn(),
    unlock: vi.fn(),
    unlockWithRecoveryText: vi.fn(),
    lock: vi.fn(),
    deleteVault: vi.fn(),
    resetRemoteState: vi.fn(),
    pushToRemote: vi.fn(),
    pullFromRemote: vi.fn(),
    hasRemoteVault: vi.fn(),
    isUnlocked: vi.fn().mockReturnValue(false),
    getPayload: vi.fn(),
    saveSSHProfile: vi.fn(),
    deleteSSHProfile: vi.fn(),
    saveS3Profile: vi.fn(),
    deleteS3Profile: vi.fn(),
    saveTeamFolder: vi.fn(),
    renameTeamFolder: vi.fn(),
    deleteTeamFolder: vi.fn(),
  };
  const startTeamVaultAutoPollTimer = vi.fn();
  const stopTeamVaultAutoPollTimer = vi.fn();
  const scheduleTeamVaultAutoPush = vi.fn();
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
      startTeamVaultAutoPollTimer,
      stopTeamVaultAutoPollTimer,
      scheduleTeamVaultAutoPush,
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
      await call(IPC_CHANNELS.TEAM_VAULT_CREATE, 'alice@piv:abc', VALID_RECIPIENT, 'Acme Team');
      expect(teamVaultService.createVault).toHaveBeenCalledWith('alice@piv:abc', VALID_RECIPIENT, 'Acme Team');
    });

    it('rejects an overlong vault name', async () => {
      await expect(
        call(IPC_CHANNELS.TEAM_VAULT_CREATE, 'alice@piv:abc', VALID_RECIPIENT, 'x'.repeat(201))
      ).rejects.toThrow('Vault name must be a string of at most 200 characters');
    });

    it('starts the background auto-poll once creation succeeds', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_CREATE, 'alice@piv:abc', VALID_RECIPIENT);
      expect(startTeamVaultAutoPollTimer).toHaveBeenCalled();
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

    it('stops the background auto-poll', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_DELETE);
      expect(stopTeamVaultAutoPollTimer).toHaveBeenCalled();
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

    it('starts the background auto-poll once unlock succeeds', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_UNLOCK, 'alice', '/tmp/identity.txt');
      expect(startTeamVaultAutoPollTimer).toHaveBeenCalled();
    });
  });

  describe('TEAM_VAULT_UNLOCK_WITH_RECOVERY_TEXT', () => {
    it('rejects empty text', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_UNLOCK_WITH_RECOVERY_TEXT, '   ')).rejects.toThrow(
        'Recovery key text is required'
      );
      expect(teamVaultService.unlockWithRecoveryText).not.toHaveBeenCalled();
    });

    it('forwards the text and starts the background auto-poll once it succeeds', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_UNLOCK_WITH_RECOVERY_TEXT, 'AGE-SECRET-KEY-1FAKE');
      expect(teamVaultService.unlockWithRecoveryText).toHaveBeenCalledWith('AGE-SECRET-KEY-1FAKE');
      expect(startTeamVaultAutoPollTimer).toHaveBeenCalled();
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

  describe('TEAM_VAULT_RENAME', () => {
    it('rejects an overlong vault name', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_RENAME, 'x'.repeat(201))).rejects.toThrow(
        'Vault name must be a string of at most 200 characters'
      );
    });

    it('renames and schedules an auto-push', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_RENAME, 'Acme Team');
      expect(teamVaultService.renameVault).toHaveBeenCalledWith('Acme Team');
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
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

    it('stops the background auto-poll on lock', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_LOCK);
      expect(stopTeamVaultAutoPollTimer).toHaveBeenCalled();
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

    it('restarts the auto-poll when the vault is already unlocked', async () => {
      teamVaultService.isUnlocked.mockReturnValue(true);
      await call(IPC_CHANNELS.TEAM_VAULT_SET_TARGET, s3Target, 'team-bucket');
      expect(startTeamVaultAutoPollTimer).toHaveBeenCalled();
    });

    it('does not start the auto-poll when the vault is locked', async () => {
      teamVaultService.isUnlocked.mockReturnValue(false);
      await call(IPC_CHANNELS.TEAM_VAULT_SET_TARGET, s3Target, 'team-bucket');
      expect(startTeamVaultAutoPollTimer).not.toHaveBeenCalled();
    });
  });

  describe('TEAM_VAULT_GET_PAYLOAD / SAVE / DELETE (shared SSH & S3 profiles)', () => {
    it('returns null without calling the service when the vault is locked', async () => {
      teamVaultService.isUnlocked.mockReturnValue(false);
      await expect(call(IPC_CHANNELS.TEAM_VAULT_GET_PAYLOAD)).resolves.toBeNull();
      expect(teamVaultService.getPayload).not.toHaveBeenCalled();
    });

    it('returns the payload when unlocked', async () => {
      teamVaultService.isUnlocked.mockReturnValue(true);
      const payload = { ssh: [], s3: [] };
      teamVaultService.getPayload.mockResolvedValue(payload);
      await expect(call(IPC_CHANNELS.TEAM_VAULT_GET_PAYLOAD)).resolves.toBe(payload);
    });

    it('returns null (rather than throwing) if getPayload itself fails unexpectedly', async () => {
      teamVaultService.isUnlocked.mockReturnValue(true);
      teamVaultService.getPayload.mockRejectedValue(new Error('boom'));
      await expect(call(IPC_CHANNELS.TEAM_VAULT_GET_PAYLOAD)).resolves.toBeNull();
    });

    it('rejects an SSH profile with no id', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_SAVE_SSH_PROFILE, { name: 'x' })).rejects.toThrow(
        'SSH profile is required'
      );
      expect(teamVaultService.saveSSHProfile).not.toHaveBeenCalled();
    });

    it('saves a well-formed SSH profile and schedules an auto-push', async () => {
      const profile = { id: 'p1', name: 'x', host: 'h', username: 'u', authType: 'password' };
      await call(IPC_CHANNELS.TEAM_VAULT_SAVE_SSH_PROFILE, profile);
      expect(teamVaultService.saveSSHProfile).toHaveBeenCalledWith(profile);
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
    });

    it('does not schedule an auto-push when the save itself is rejected', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_SAVE_SSH_PROFILE, { name: 'x' })).rejects.toThrow();
      expect(scheduleTeamVaultAutoPush).not.toHaveBeenCalled();
    });

    it('deletes an SSH profile by id and schedules an auto-push', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_DELETE_SSH_PROFILE, 'p1');
      expect(teamVaultService.deleteSSHProfile).toHaveBeenCalledWith('p1');
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
    });

    it('rejects an S3 profile with no id', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_SAVE_S3_PROFILE, { name: 'x' })).rejects.toThrow(
        'S3 profile is required'
      );
      expect(teamVaultService.saveS3Profile).not.toHaveBeenCalled();
    });

    it('saves a well-formed S3 profile and schedules an auto-push', async () => {
      const profile = { id: 'p1', name: 'x', region: 'us-east-1', accessKeyId: 'a', secretAccessKey: 'b' };
      await call(IPC_CHANNELS.TEAM_VAULT_SAVE_S3_PROFILE, profile);
      expect(teamVaultService.saveS3Profile).toHaveBeenCalledWith(profile);
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
    });

    it('deletes an S3 profile by id and schedules an auto-push', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_DELETE_S3_PROFILE, 'p1');
      expect(teamVaultService.deleteS3Profile).toHaveBeenCalledWith('p1');
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
    });
  });

  describe('TEAM_VAULT_SAVE_FOLDER / TEAM_VAULT_RENAME_FOLDER / TEAM_VAULT_DELETE_FOLDER', () => {
    it('saves a folder and schedules an auto-push', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_SAVE_FOLDER, 'Acme Infra/Cluster A');
      expect(teamVaultService.saveTeamFolder).toHaveBeenCalledWith('Acme Infra/Cluster A');
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
    });

    it('renames a folder and schedules an auto-push', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_RENAME_FOLDER, 'Acme Infra', 'Acme Co');
      expect(teamVaultService.renameTeamFolder).toHaveBeenCalledWith('Acme Infra', 'Acme Co');
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
    });

    it('deletes a folder, forwarding the deleteProfiles flag, and schedules an auto-push', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_DELETE_FOLDER, 'Acme Infra', true);
      expect(teamVaultService.deleteTeamFolder).toHaveBeenCalledWith('Acme Infra', true);
      expect(scheduleTeamVaultAutoPush).toHaveBeenCalled();
    });

    it('defaults deleteProfiles to false when omitted', async () => {
      await call(IPC_CHANNELS.TEAM_VAULT_DELETE_FOLDER, 'Acme Infra');
      expect(teamVaultService.deleteTeamFolder).toHaveBeenCalledWith('Acme Infra', false);
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
      expect(teamVaultService.pullFromRemote).toHaveBeenCalledWith({}, 'b', undefined);
      expect(teamVaultConfigStore.setLastSyncAt).toHaveBeenCalled();
    });

    it('passes a force option through to pullFromRemote', async () => {
      teamVaultConfigStore.getConfig.mockResolvedValue({ target: { id: 't1', type: 's3' }, remoteBasePath: 'b' });
      await call(IPC_CHANNELS.TEAM_VAULT_PULL, { force: true });
      expect(teamVaultService.pullFromRemote).toHaveBeenCalledWith({}, 'b', { force: true });
    });

    it('hasRemoteVault returns false with no target configured, without touching the provider', async () => {
      await expect(call(IPC_CHANNELS.TEAM_VAULT_HAS_REMOTE_VAULT)).resolves.toBe(false);
      expect(storageRegistry.getOrCreate).not.toHaveBeenCalled();
    });
  });
});
