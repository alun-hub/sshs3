// A profile with **Use active SSH Certificate Authority session** must reach ssh with the app agent and the
// certificate on every path. These tests start from the saved profile and go through the real mapping, IPC
// handler and SmartcardCoordinator, so a field lost on the way shows up here.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('electron', () => {
  const mockObj = { app: { getPath: vi.fn().mockReturnValue('/tmp/user-data') } };
  return { ...mockObj, default: mockObj };
});

import { registerStorageHandlers, type StorageHost } from '../../src/main/ipc/storageHandlers';
import { registerGitHandlers, type GitHost } from '../../src/main/ipc/gitHandlers';
import { RemoteGitService } from '../../src/main/git/RemoteGitService';
import { SmartcardCoordinator, type SmartcardDeps } from '../../src/main/smartcard/SmartcardCoordinator';
import { IPC_CHANNELS, type StorageConnectConfig } from '../../src/shared/types/ipc';
import { toSftpConfig } from '../../src/shared/toSftpConfig';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const AGENT = '/run/sshs3/agent.sock';
const CERT = '/run/sshs3/certs/ca-cert.pub';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const profile = (over: Partial<SSHConnectionConfig> = {}): SSHConnectionConfig => ({
  id: 'p1', name: 'CA', host: 'ca.example.com', username: 'alun', authType: 'agent', useSshCa: true, ...over,
});

/** The real coordinator with a stand-in app agent and an active PIV-style CA session (one with a certificate file). */
function coordinatorWithCaSession(): SmartcardCoordinator {
  const coordinator = new SmartcardCoordinator({
    settingsStore: { getSettings: vi.fn().mockResolvedValue({}) },
    syncAgentBlock: vi.fn(),
    clearPresence: vi.fn(),
  } as unknown as SmartcardDeps);
  (coordinator as unknown as { appAgent: unknown }).appAgent = { ensure: async () => AGENT, getSocketPath: () => AGENT };
  coordinator.setSshCaService({ getActiveCertificateFilePath: () => CERT } as never);
  return coordinator;
}

/** What the file manager's connect request becomes before the provider is created. */
async function connectInFileManager(saved: SSHConnectionConfig) {
  const handlers = new Map<string, Handler>();
  const getOrCreate = vi.fn().mockResolvedValue({});
  registerStorageHandlers({
    registerHandler: (channel: string, h: Handler) => handlers.set(channel, h),
    storageRegistry: { has: () => false, getOrCreate },
    smartcard: coordinatorWithCaSession(),
    resolveProxyJumpConfig: async <T,>(c: T) => c,
    policy: { policy: {} },
  } as unknown as StorageHost);
  await handlers.get(IPC_CHANNELS.STORAGE_CONNECT)!({}, {
    id: `sftp-${saved.id}`, name: saved.name, type: 'sftp', sftpConfig: toSftpConfig(saved),
  } satisfies StorageConnectConfig);
  return (getOrCreate.mock.calls[0][0] as StorageConnectConfig).sftpConfig!;
}

describe('SSH CA profiles in the file manager', () => {
  it('connects SFTP through the app agent with the certificate', async () => {
    const used = await connectInFileManager(profile());
    expect(used.agentPath).toBe(AGENT);
    expect(used.certificateFile).toBe(CERT);
  });

  it('leaves an agent profile without SSH CA alone', async () => {
    const used = await connectInFileManager(profile({ useSshCa: undefined }));
    expect(used.agentPath).toBeUndefined();
    expect(used.certificateFile).toBeUndefined();
  });
});

describe('SSH CA profiles in Git over SSH', () => {
  afterEach(() => vi.restoreAllMocks());

  function gitHandlers(saved: SSHConnectionConfig) {
    const handlers = new Map<string, Handler>();
    registerGitHandlers({
      registerHandler: (channel: string, h: Handler) => handlers.set(channel, h),
      smartcard: coordinatorWithCaSession(),
      profileStore: { getProfiles: async () => ({ ssh: [saved], s3: [] }) },
      restoreSavedSecrets: async <T,>(c: T) => c,
      resolveProxyJumpConfig: async <T,>(c: T) => c,
      policy: { policy: {} },
    } as unknown as GitHost);
    return handlers;
  }
  const withCa = expect.objectContaining({ agentPath: AGENT, certificateFile: CERT });

  it('pulls with the certificate', async () => {
    const pull = vi.spyOn(RemoteGitService, 'pull').mockResolvedValue({ success: true });
    await gitHandlers(profile()).get(IPC_CHANNELS.GIT_PULL)!({}, '/srv/repo', 'sftp-p1');
    expect(pull).toHaveBeenCalledWith('/srv/repo', 'sftp-p1', withCa);
  });

  it('clones with the certificate', async () => {
    const clone = vi.spyOn(RemoteGitService, 'clone').mockResolvedValue({ success: true });
    await gitHandlers(profile()).get(IPC_CHANNELS.GIT_CLONE)!({}, { url: 'u', targetDirectory: '/srv', sftpConfig: profile() });
    expect(clone).toHaveBeenCalledWith(expect.objectContaining({ sftpConfig: withCa }));
  });

  it('tests remote access with the certificate', async () => {
    const test = vi.spyOn(RemoteGitService, 'testRemoteAccess').mockResolvedValue({ success: true } as never);
    await gitHandlers(profile()).get(IPC_CHANNELS.GIT_TEST_REMOTE_ACCESS)!({}, { config: profile() });
    expect(test).toHaveBeenCalledWith(expect.objectContaining({ config: withCa }));
  });
});
