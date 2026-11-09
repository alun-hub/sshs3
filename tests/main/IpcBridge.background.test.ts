import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('electron', () => {
  const mockObj = {
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    app: { getPath: vi.fn().mockReturnValue('/tmp/user-data-unused') },
    safeStorage: {
      isEncryptionAvailable: vi.fn().mockReturnValue(false),
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    },
    shell: { openPath: vi.fn().mockResolvedValue('') },
  };
  return { ...mockObj, default: mockObj };
});

import { IpcBridge } from '../../src/main/IpcBridge';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import { captureLogs } from './helpers/captureLogs';

// Characterization tests: they pin what IpcBridge's background work (periodic pull, Team Vault poll,
// debounced push) and its status builders do TODAY, through public methods and injected fakes only
// (no private names), so they stay valid unchanged if that code moves into its own module.

const AUTO_PULL_INTERVAL_MS = 10 * 60 * 1000;
const TEAM_VAULT_POLL_INTERVAL_MS = 3 * 60 * 1000;

const S3_TARGET = { id: 't', name: 'n', type: 's3' as const };

describe('IpcBridge background work', () => {
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    vi.useFakeTimers();
    logs = captureLogs();
  });
  afterEach(() => {
    vi.useRealTimers();
    logs.restore();
  });

  function makeBridge(overrides: { syncConfig?: Record<string, unknown>; unlocked?: boolean } = {}) {
    const provider = { id: 'provider' };
    const syncConfigStore = {
      getConfig: vi.fn().mockResolvedValue({ autoSync: true, target: S3_TARGET, remoteBasePath: 'base', ...overrides.syncConfig }),
      setLastSyncAt: vi.fn().mockResolvedValue(undefined),
    };
    const syncCryptoService = { isUnlocked: vi.fn().mockReturnValue(overrides.unlocked ?? true) };
    const profileSyncService = {
      pullFromRemote: vi.fn().mockResolvedValue({ sshNativeConflicts: [] }),
      pushToRemote: vi.fn().mockResolvedValue(undefined),
      getLastComparison: vi.fn().mockReturnValue(null),
      // Called by SmartcardCoordinator.dispose() when it removes the local agent block.
      syncAgentBlockToLocalSshConfig: vi.fn().mockResolvedValue(undefined),
    };
    const storageRegistry = { getOrCreate: vi.fn().mockResolvedValue(provider), disconnect: vi.fn(), has: vi.fn().mockReturnValue(true) };
    const teamVaultService = {
      isUnlocked: vi.fn().mockReturnValue(true),
      hasRemoteChangedSinceLastSync: vi.fn().mockResolvedValue(false),
      hasUnpushedLocalChanges: vi.fn().mockResolvedValue(false),
      pushToRemote: vi.fn().mockResolvedValue(undefined),
      pullFromRemote: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
      listVaultIds: vi.fn().mockResolvedValue([]),
    };
    const teamVaultConfigStore = {
      getConfig: vi.fn().mockResolvedValue({ target: S3_TARGET, remoteBasePath: 'tv-base' }),
      getAllConfigs: vi.fn().mockResolvedValue({}),
      setLastSyncAt: vi.fn().mockResolvedValue(undefined),
      setSelfIdentity: vi.fn().mockResolvedValue(undefined),
    };
    const bridge = new IpcBridge({
      syncConfigStore: syncConfigStore as any,
      syncCryptoService: syncCryptoService as any,
      profileSyncService: profileSyncService as any,
      storageRegistry: storageRegistry as any,
      teamVaultService: teamVaultService as any,
      teamVaultConfigStore: teamVaultConfigStore as any,
    });
    const sent: Array<{ channel: string; payload: unknown }> = [];
    bridge.getWebContents = (() => ({
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    })) as any;
    return { bridge, provider, syncConfigStore, syncCryptoService, profileSyncService, storageRegistry, teamVaultService, teamVaultConfigStore, sent };
  }

  /** Lets queued promise callbacks (a timer tick's async body) finish without advancing time. */
  const flush = () => vi.advanceTimersByTimeAsync(0);

  describe('periodic profile-sync pull (startAutoPullTimer)', () => {
    it('pulls from the sync target on every interval while auto-sync is on and sync is unlocked', async () => {
      const { bridge, provider, profileSyncService, syncConfigStore } = makeBridge();
      bridge.getWebContents = () => null; // no window: the status push after a pull is skipped, not under test here
      bridge.startAutoPullTimer();

      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);
      expect(profileSyncService.pullFromRemote).toHaveBeenCalledTimes(1);
      expect(profileSyncService.pullFromRemote).toHaveBeenCalledWith(provider, 'base');
      expect(syncConfigStore.setLastSyncAt).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);
      expect(profileSyncService.pullFromRemote).toHaveBeenCalledTimes(2);
      bridge.stopAutoPullTimer();
    });

    it('does nothing before the first interval has elapsed', async () => {
      const { bridge, profileSyncService } = makeBridge();
      bridge.startAutoPullTimer();
      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS - 1);
      expect(profileSyncService.pullFromRemote).not.toHaveBeenCalled();
      bridge.stopAutoPullTimer();
    });

    it('stops its own timer when auto-sync has been switched off', async () => {
      const { bridge, profileSyncService } = makeBridge({ syncConfig: { autoSync: false } });
      bridge.startAutoPullTimer();
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);

      expect(profileSyncService.pullFromRemote).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops its own timer when the sync target has been removed', async () => {
      const { bridge, profileSyncService } = makeBridge({ syncConfig: { target: undefined } });
      bridge.startAutoPullTimer();
      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);
      expect(profileSyncService.pullFromRemote).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('skips the cycle (but keeps the timer) while sync is locked and no smartcard is linked', async () => {
      const { bridge, profileSyncService } = makeBridge({ unlocked: false });
      bridge.startAutoPullTimer();

      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);

      expect(profileSyncService.pullFromRemote).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      bridge.stopAutoPullTimer();
    });

    it('logs a failed pull and keeps polling instead of throwing', async () => {
      const { bridge, profileSyncService } = makeBridge();
      bridge.getWebContents = () => null;
      profileSyncService.pullFromRemote.mockRejectedValueOnce(new Error('remote unreachable'));
      bridge.startAutoPullTimer();

      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);
      expect(logs.text()).toContain('Background pull failed');
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);
      expect(profileSyncService.pullFromRemote).toHaveBeenCalledTimes(2);
      bridge.stopAutoPullTimer();
    });

    it('reports known_hosts conflicts found by a background pull in the log and leaves them unapplied', async () => {
      const { bridge, profileSyncService } = makeBridge();
      bridge.getWebContents = () => null;
      profileSyncService.pullFromRemote.mockResolvedValue({ sshNativeConflicts: [{}, {}] });
      bridge.startAutoPullTimer();

      await vi.advanceTimersByTimeAsync(AUTO_PULL_INTERVAL_MS);

      expect(logs.text()).toContain('2 known_hosts conflict(s)');
      bridge.stopAutoPullTimer();
    });

    it('restarting replaces the timer instead of stacking a second one', () => {
      const { bridge } = makeBridge();
      bridge.startAutoPullTimer();
      bridge.startAutoPullTimer();
      expect(vi.getTimerCount()).toBe(1);
      bridge.stopAutoPullTimer();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('Team Vault background poll (startTeamVaultAutoPollTimer)', () => {
    it('keeps one independent timer per vault: stopping one leaves the other polling', async () => {
      const { bridge, teamVaultService } = makeBridge();
      bridge.startTeamVaultAutoPollTimer('vlt_a');
      bridge.startTeamVaultAutoPollTimer('vlt_b');
      expect(vi.getTimerCount()).toBe(2);

      bridge.stopTeamVaultAutoPollTimer('vlt_a');
      await vi.advanceTimersByTimeAsync(TEAM_VAULT_POLL_INTERVAL_MS);

      const polled = teamVaultService.hasRemoteChangedSinceLastSync.mock.calls.map((c) => c[0]);
      expect(polled).toEqual(['vlt_b']);
      bridge.stopTeamVaultAutoPollTimer('vlt_b');
    });

    it('restarting a vault replaces its timer', () => {
      const { bridge } = makeBridge();
      bridge.startTeamVaultAutoPollTimer('vlt_a');
      bridge.startTeamVaultAutoPollTimer('vlt_a');
      expect(vi.getTimerCount()).toBe(1);
      bridge.stopTeamVaultAutoPollTimer('vlt_a');
    });

    it('stops its own timer when the vault is no longer unlocked', async () => {
      const { bridge, teamVaultService } = makeBridge();
      teamVaultService.isUnlocked.mockReturnValue(false);
      bridge.startTeamVaultAutoPollTimer('vlt_a');

      await vi.advanceTimersByTimeAsync(TEAM_VAULT_POLL_INTERVAL_MS);

      expect(teamVaultService.hasRemoteChangedSinceLastSync).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops its own timer when the vault has no remote target configured', async () => {
      const { bridge, teamVaultConfigStore, teamVaultService } = makeBridge();
      teamVaultConfigStore.getConfig.mockResolvedValue({ target: undefined });
      bridge.startTeamVaultAutoPollTimer('vlt_a');

      await vi.advanceTimersByTimeAsync(TEAM_VAULT_POLL_INTERVAL_MS);

      expect(teamVaultService.hasRemoteChangedSinceLastSync).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does nothing when the remote has not changed', async () => {
      const { bridge, teamVaultService, sent } = makeBridge();
      bridge.startTeamVaultAutoPollTimer('vlt_a');

      await vi.advanceTimersByTimeAsync(TEAM_VAULT_POLL_INTERVAL_MS);

      expect(teamVaultService.pullFromRemote).not.toHaveBeenCalled();
      expect(sent).toEqual([]);
      bridge.stopTeamVaultAutoPollTimer('vlt_a');
    });

    it('auto-pulls a remote change when there are no unpushed local changes, and tells every window', async () => {
      const { bridge, teamVaultService, teamVaultConfigStore, sent } = makeBridge();
      teamVaultService.hasRemoteChangedSinceLastSync.mockResolvedValue(true);
      bridge.startTeamVaultAutoPollTimer('vlt_a');

      await vi.advanceTimersByTimeAsync(TEAM_VAULT_POLL_INTERVAL_MS);

      expect(teamVaultService.pullFromRemote).toHaveBeenCalledWith('vlt_a', expect.anything(), 'tv-base');
      expect(teamVaultConfigStore.setLastSyncAt).toHaveBeenCalledWith('vlt_a', expect.any(String));
      expect(sent.map((e) => e.channel)).toContain(IPC_CHANNELS.TEAM_VAULT_AUTO_PULLED);
      bridge.stopTeamVaultAutoPollTimer('vlt_a');
    });

    it('never auto-pulls over unpushed local changes: it only notifies that the remote changed', async () => {
      const { bridge, teamVaultService, sent } = makeBridge();
      teamVaultService.hasRemoteChangedSinceLastSync.mockResolvedValue(true);
      teamVaultService.hasUnpushedLocalChanges.mockResolvedValue(true);
      bridge.startTeamVaultAutoPollTimer('vlt_a');

      await vi.advanceTimersByTimeAsync(TEAM_VAULT_POLL_INTERVAL_MS);

      expect(teamVaultService.pullFromRemote).not.toHaveBeenCalled();
      expect(sent.map((e) => e.channel)).toContain(IPC_CHANNELS.TEAM_VAULT_REMOTE_CHANGED);
      bridge.stopTeamVaultAutoPollTimer('vlt_a');
    });

    it('survives a failing poll and logs it', async () => {
      const { bridge, teamVaultService } = makeBridge();
      teamVaultService.hasRemoteChangedSinceLastSync.mockRejectedValue(new Error('network down'));
      bridge.startTeamVaultAutoPollTimer('vlt_a');

      await vi.advanceTimersByTimeAsync(TEAM_VAULT_POLL_INTERVAL_MS);

      expect(logs.text()).toContain('Team Vault background poll failed (vaultId=vlt_a)');
      expect(vi.getTimerCount()).toBe(1);
      bridge.stopTeamVaultAutoPollTimer('vlt_a');
    });
  });

  describe('Team Vault debounced push (scheduleTeamVaultAutoPush)', () => {
    it('coalesces several quick saves for one vault into a single push', async () => {
      const { bridge, teamVaultService } = makeBridge();
      bridge.scheduleTeamVaultAutoPush('vlt_a', 2000);
      await vi.advanceTimersByTimeAsync(1000);
      bridge.scheduleTeamVaultAutoPush('vlt_a', 2000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(teamVaultService.pushToRemote).not.toHaveBeenCalled(); // the second save restarted the debounce

      await vi.advanceTimersByTimeAsync(1000);
      expect(teamVaultService.pushToRemote).toHaveBeenCalledTimes(1);
    });

    it('debounces each vault separately', async () => {
      const { bridge, teamVaultService } = makeBridge();
      bridge.scheduleTeamVaultAutoPush('vlt_a', 2000);
      bridge.scheduleTeamVaultAutoPush('vlt_b', 2000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(teamVaultService.pushToRemote.mock.calls.map((c) => c[0]).sort()).toEqual(['vlt_a', 'vlt_b']);
    });

    it('does not push when the vault has no remote target', async () => {
      const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
      teamVaultConfigStore.getConfig.mockResolvedValue({ target: undefined });
      bridge.scheduleTeamVaultAutoPush('vlt_a', 0);
      await flush();
      expect(teamVaultService.pushToRemote).not.toHaveBeenCalled();
    });
  });

  describe('timers and dispose', () => {
    it('leaves no timer of its own behind after dispose()', async () => {
      const { bridge } = makeBridge();
      const baseline = vi.getTimerCount();

      bridge.startAutoPullTimer();
      bridge.startTeamVaultAutoPollTimer('vlt_a');
      bridge.startTeamVaultAutoPollTimer('vlt_b');
      bridge.scheduleTeamVaultAutoPush('vlt_a', 60_000);
      bridge.scheduleAutoSync(60_000);
      expect(vi.getTimerCount()).toBe(baseline + 5);

      await bridge.dispose();

      expect(vi.getTimerCount()).toBeLessThanOrEqual(baseline);
    });
  });
});

describe('IpcBridge status builders', () => {
  function makeBridge() {
    const teamVaultService = { getStatus: vi.fn(), listVaultIds: vi.fn().mockResolvedValue([]) };
    const teamVaultConfigStore = {
      getConfig: vi.fn().mockResolvedValue({}),
      getAllConfigs: vi.fn().mockResolvedValue({}),
      setSelfIdentity: vi.fn().mockResolvedValue(undefined),
    };
    const bridge = new IpcBridge({
      teamVaultService: teamVaultService as any,
      teamVaultConfigStore: teamVaultConfigStore as any,
    });
    return { bridge, teamVaultService, teamVaultConfigStore };
  }

  describe('buildTeamVaultStatus', () => {
    it('merges the local-file status with the remote config, and reports the vaultId it was asked about when no file exists yet', async () => {
      const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
      teamVaultService.getStatus.mockResolvedValue({ exists: false });
      teamVaultConfigStore.getConfig.mockResolvedValue({
        target: { id: 't', name: 'n', type: 's3', s3Config: { id: 't', name: 'n', region: 'eu', accessKeyId: 'AKIA', secretAccessKey: 'top-secret' } },
        remoteBasePath: 'tv/base',
        lastSyncAt: '2026-11-09T10:00:00.000Z',
      });

      const status = await bridge.buildTeamVaultStatus('vlt_pending');

      expect(status.vaultId).toBe('vlt_pending');
      expect(status.remoteConfigured).toBe(true);
      expect(status.remoteBasePath).toBe('tv/base');
      expect(status.lastSyncAt).toBe('2026-11-09T10:00:00.000Z');
    });

    it('never lets the S3 secret reach the renderer: it is blanked and only its presence is reported', async () => {
      const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
      teamVaultService.getStatus.mockResolvedValue({ vaultId: 'vlt_a' });
      teamVaultConfigStore.getConfig.mockResolvedValue({
        target: {
          id: 't',
          name: 'n',
          type: 's3',
          s3Config: { id: 't', name: 'n', region: 'eu', accessKeyId: 'AKIA', secretAccessKey: 'top-secret', sessionToken: 'tok' },
        },
      });

      const status = await bridge.buildTeamVaultStatus('vlt_a');

      expect(status.targetConfig).toMatchObject({ type: 's3', s3Config: { accessKeyId: 'AKIA', secretAccessKey: '', hasSecretAccessKey: true } });
      expect(JSON.stringify(status)).not.toContain('top-secret');
      expect(JSON.stringify(status)).not.toContain('"tok"');
    });

    it('reports no target config and remoteConfigured=false when no remote is set', async () => {
      const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
      teamVaultService.getStatus.mockResolvedValue({ vaultId: 'vlt_a' });
      teamVaultConfigStore.getConfig.mockResolvedValue({});

      const status = await bridge.buildTeamVaultStatus('vlt_a');

      expect(status.remoteConfigured).toBe(false);
      expect(status.targetConfig).toBeUndefined();
    });

    it("derives the caller's role from the members list via their recipient id", async () => {
      const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
      teamVaultService.getStatus.mockResolvedValue({
        vaultId: 'vlt_a',
        members: [
          { recipientId: 'r1', role: 'admin' },
          { recipientId: 'r2', role: 'member' },
        ],
      });
      teamVaultConfigStore.getConfig.mockResolvedValue({ selfRecipientId: 'r2' });

      expect((await bridge.buildTeamVaultStatus('vlt_a')).selfRole).toBe('member');
    });

    it('has no role when the caller is not in the members list or no recipient is remembered', async () => {
      const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
      teamVaultService.getStatus.mockResolvedValue({ vaultId: 'vlt_a', members: [{ recipientId: 'r1', role: 'admin' }] });

      teamVaultConfigStore.getConfig.mockResolvedValue({ selfRecipientId: 'unknown' });
      expect((await bridge.buildTeamVaultStatus('vlt_a')).selfRole).toBeUndefined();

      teamVaultConfigStore.getConfig.mockResolvedValue({});
      expect((await bridge.buildTeamVaultStatus('vlt_a')).selfRole).toBeUndefined();
    });

    describe('identity path self-heal (a path from before the multi-team migration)', () => {
      let dir: string;
      beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-tv-status-'));
      });
      afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
      });

      it('leaves an identity path alone when the file is still there', async () => {
        const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
        const identity = path.join(dir, 'key.txt');
        fs.writeFileSync(identity, 'x');
        teamVaultService.getStatus.mockResolvedValue({ vaultId: 'vlt_a' });
        teamVaultConfigStore.getConfig.mockResolvedValue({ selfIdentityFilePath: identity });

        const status = await bridge.buildTeamVaultStatus('vlt_a');

        expect(status.selfIdentityFilePath).toBe(identity);
        expect(teamVaultConfigStore.setSelfIdentity).not.toHaveBeenCalled();
      });

      it('points a missing flat-directory path at the migrated copy under the vault id, and persists the new path', async () => {
        const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
        const oldPath = path.join(dir, 'key.txt');
        const relocated = path.join(dir, 'vlt_a', 'key.txt');
        fs.mkdirSync(path.dirname(relocated), { recursive: true });
        fs.writeFileSync(relocated, 'x');
        teamVaultService.getStatus.mockResolvedValue({ vaultId: 'vlt_a' });
        teamVaultConfigStore.getConfig.mockResolvedValue({ selfIdentityFilePath: oldPath });

        const status = await bridge.buildTeamVaultStatus('vlt_a');

        expect(status.selfIdentityFilePath).toBe(relocated);
        expect(teamVaultConfigStore.setSelfIdentity).toHaveBeenCalledWith('vlt_a', undefined, relocated);
      });

      it('keeps reporting the stale path when there is no migrated copy either', async () => {
        const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
        const oldPath = path.join(dir, 'gone.txt');
        teamVaultService.getStatus.mockResolvedValue({ vaultId: 'vlt_a' });
        teamVaultConfigStore.getConfig.mockResolvedValue({ selfIdentityFilePath: oldPath });

        const status = await bridge.buildTeamVaultStatus('vlt_a');

        expect(status.selfIdentityFilePath).toBe(oldPath);
        expect(teamVaultConfigStore.setSelfIdentity).not.toHaveBeenCalled();
      });

      it('still reports the relocated path when persisting it fails (non-fatal, logged)', async () => {
        const logs = captureLogs();
        try {
          const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
          const oldPath = path.join(dir, 'key.txt');
          const relocated = path.join(dir, 'vlt_a', 'key.txt');
          fs.mkdirSync(path.dirname(relocated), { recursive: true });
          fs.writeFileSync(relocated, 'x');
          teamVaultService.getStatus.mockResolvedValue({ vaultId: 'vlt_a' });
          teamVaultConfigStore.getConfig.mockResolvedValue({ selfIdentityFilePath: oldPath });
          teamVaultConfigStore.setSelfIdentity.mockRejectedValue(new Error('disk full'));

          const status = await bridge.buildTeamVaultStatus('vlt_a');
          await new Promise((r) => setImmediate(r));

          expect(status.selfIdentityFilePath).toBe(relocated);
          expect(logs.text()).toContain('Failed to persist the relocated Team Vault identity path');
        } finally {
          logs.restore();
        }
      });
    });
  });

  describe('buildAllTeamVaultStatuses', () => {
    it('returns one status per known vault: local files and configured remotes merged, each vault once', async () => {
      const { bridge, teamVaultService, teamVaultConfigStore } = makeBridge();
      teamVaultService.listVaultIds.mockResolvedValue(['vlt_a', 'vlt_b']);
      teamVaultConfigStore.getAllConfigs.mockResolvedValue({ vlt_b: {}, vlt_pending: {} });
      teamVaultService.getStatus.mockImplementation(async (id: string) => (id === 'vlt_pending' ? { exists: false } : { vaultId: id }));

      const statuses = await bridge.buildAllTeamVaultStatuses();

      expect(statuses.map((s) => s.vaultId).sort()).toEqual(['vlt_a', 'vlt_b', 'vlt_pending']);
    });

    it('returns an empty list when nothing is known', async () => {
      const { bridge } = makeBridge();
      expect(await bridge.buildAllTeamVaultStatuses()).toEqual([]);
    });
  });
});
