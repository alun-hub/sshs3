// "Git Clone to here" in an SFTP pane: git runs on that pane's server, over the connection main already has.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runSshCommand = vi.hoisted(() => vi.fn());
vi.mock('../../src/main/ssh/KeyInstallService', () => ({ runSshCommand }));
vi.mock('electron', () => {
  const mockObj = { app: { getPath: vi.fn().mockReturnValue('/tmp/user-data') } };
  return { ...mockObj, default: mockObj };
});

import { registerGitHandlers, type GitHost } from '../../src/main/ipc/gitHandlers';
import { StorageRegistry } from '../../src/main/storage/StorageRegistry';
import { SFTPStorageProvider } from '../../src/main/storage/SFTPStorageProvider';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import type { GitCloneRequest, GitOperationResult } from '../../src/shared/types/git';
import type { PromptHandlers } from '../../src/main/ssh/KeyInstallService';

const URL = 'https://github.com/example/repo.git';

async function setup() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const storageRegistry = new StorageRegistry();
  // Creating the provider opens no connection.
  const provider = (await storageRegistry.getOrCreate({
    id: 'sftp-p1', name: 'Server', type: 'sftp',
    sftpConfig: { host: 'server.example.com', port: 2222, username: 'alun', authType: 'smartcard', agentPath: '/run/agent.sock' },
  })) as SFTPStorageProvider;
  await storageRegistry.getOrCreate({ id: 'local', name: 'Local Disk', type: 'local' });
  const bridge = {
    registerHandler: (channel: string, h: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, h),
    storageRegistry,
    promptForPinDirect: vi.fn().mockResolvedValue('1234'),
    promptHostKeyTrust: vi.fn().mockResolvedValue(false),
    makePresenceNotifier: vi.fn(() => ({ onPresenceRequested: vi.fn(), onPresenceCleared: vi.fn() })),
  };
  registerGitHandlers(bridge as unknown as GitHost);
  const clone = (request: Partial<GitCloneRequest> & Record<string, unknown>) =>
    handlers.get(IPC_CHANNELS.GIT_CLONE)!({}, { url: URL, targetDirectory: '/srv/work', providerId: 'sftp-p1', ...request }) as Promise<GitOperationResult>;
  return { bridge, provider, clone };
}

describe('Git clone in an SFTP pane', () => {
  beforeEach(() => {
    runSshCommand.mockReset();
    runSshCommand.mockResolvedValue({ code: 0, stdout: '', stderr: "Cloning into 'repo'..." });
  });

  it('runs git on the server over the pane connection', async () => {
    const { clone } = await setup();
    await expect(clone({})).resolves.toMatchObject({ success: true });
    const [config, command] = runSshCommand.mock.calls[0];
    expect(config).toMatchObject({ host: 'server.example.com', port: 2222, agentPath: '/run/agent.sock' });
    expect(command).toMatch(/^cd -- '\/srv\/work' && git .*'clone' '--' 'https:\/\/github\.com\/example\/repo\.git'$/);
  });

  it('takes no connection from the renderer', async () => {
    const { clone } = await setup();
    await clone({ sftpConfig: { host: 'elsewhere.example.com', username: 'x', authType: 'agent' } });
    expect(runSshCommand.mock.calls[0][0]).toMatchObject({ host: 'server.example.com' });
  });

  it('resolves a home-relative folder before quoting it', async () => {
    const { clone, provider } = await setup();
    vi.spyOn(provider, 'getHomeDir').mockResolvedValue('/home/alun');
    await clone({ targetDirectory: '~/work' });
    expect(runSshCommand.mock.calls[0][1]).toContain("cd -- '/home/alun/work' && ");
  });

  it('asks the user for what ssh needs', async () => {
    const { clone, bridge } = await setup();
    await clone({});
    const prompts = runSshCommand.mock.calls[0][2] as PromptHandlers;
    await expect(Promise.resolve(prompts.pinPromptHandler!("Enter PIN for 'card': "))).resolves.toBe('1234');
    expect(bridge.promptForPinDirect).toHaveBeenCalledWith("Enter PIN for 'card':", 'smartcard', 'SSH: Server');
    await expect(prompts.hostKeyPromptHandler!({} as never)).resolves.toBe(false);
  });

  it('reports what git said when it fails', async () => {
    runSshCommand.mockResolvedValue({ code: 128, stdout: '', stderr: "fatal: destination path 'repo' already exists" });
    const { clone } = await setup();
    await expect(clone({})).resolves.toEqual({ success: false, error: "fatal: destination path 'repo' already exists" });
  });

  it.each([['a connection that is not open', 'sftp-gone'], ['a provider that is not SFTP', 'local-2']])(
    'refuses %s', async (_label, providerId) => {
      const { clone, bridge } = await setup();
      await bridge.storageRegistry.getOrCreate({ id: 'local-2', name: 'Other', type: 'local' });
      await expect(clone({ providerId })).resolves.toMatchObject({ success: false, error: expect.stringContaining('open SFTP connection') });
      expect(runSshCommand).not.toHaveBeenCalled();
    });

  it('still rejects an empty folder', async () => {
    const { clone } = await setup();
    await expect(clone({ targetDirectory: ' ' })).resolves.toEqual({ success: false, error: 'Target directory is required' });
    expect(runSshCommand).not.toHaveBeenCalled();
  });
});
