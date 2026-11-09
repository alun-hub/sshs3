import { describe, it, expect, vi } from 'vitest';

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

// The set of invoke-channels IpcBridge.register() installs is the app's privileged API surface. This
// pins it: a handler group that silently stops registering (or registers twice, which Electron rejects
// at startup) fails here instead of at runtime. Adding or removing a channel is deliberate, so it shows
// up as a diff of the checked-in snapshot in review. Update it with `npx vitest run -u <this file>`.

function registerAll(): string[] {
  const registered: string[] = [];
  const ipcMain = { handle: (channel: string) => void registered.push(channel), removeHandler: vi.fn() };
  const bridge = new IpcBridge({
    ipcMain: ipcMain as any,
    // Never read the developer's real sync config when register() looks up auto-sync.
    syncConfigStore: { getConfig: vi.fn().mockResolvedValue({}) } as any,
    profileSyncService: { syncAgentBlockToLocalSshConfig: vi.fn().mockResolvedValue(undefined), autoSyncLocalSshConfig: vi.fn() } as any,
  });
  bridge.register();
  return registered;
}

describe('IpcBridge.register() channel contract', () => {
  const registered = registerAll();

  it('registers a substantial set of channels (guards against an empty registration passing the checks below)', () => {
    expect(registered.length).toBeGreaterThan(150);
  });

  it('registers no channel twice (Electron throws on a second handle() for the same channel)', () => {
    const duplicates = registered.filter((channel, i) => registered.indexOf(channel) !== i);
    expect(duplicates).toEqual([]);
  });

  it('only registers channels declared in IPC_CHANNELS (no stray string literals)', () => {
    const declared = new Set<string>(Object.values(IPC_CHANNELS));
    expect(registered.filter((channel) => !declared.has(channel))).toEqual([]);
  });

  it('matches the checked-in list of registered channels', async () => {
    await expect([...registered].sort().join('\n') + '\n').toMatchFileSnapshot('./__snapshots__/ipcRegisteredChannels.txt');
  });
});
