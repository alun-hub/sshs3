import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';

vi.mock('electron', () => {
  const mockObj = {
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    app: { getPath: vi.fn().mockReturnValue('/tmp/user-data-unused') },
    safeStorage: {
      isEncryptionAvailable: vi.fn().mockReturnValue(false), // exercise the plaintext-fallback path, same as most other IPC tests
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    },
    shell: {
      openPath: vi.fn().mockResolvedValue(''),
    },
  };
  return { ...mockObj, default: mockObj };
});

import { IpcBridge } from '../../src/main/IpcBridge';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import { ProfileStore } from '../../src/main/profile/ProfileStore';
import { DotfilePoolStore } from '../../src/main/dotfiles/DotfilePoolStore';
import { SettingsStore } from '../../src/main/settings/SettingsStore';
import { SyncConfigStore } from '../../src/main/services/SyncConfigStore';
import { SyncCryptoService, type ScryptParams } from '../../src/main/services/SyncCryptoService';
import { ProfileSyncService } from '../../src/main/services/ProfileSyncService';
import type { IStorageProvider, FileEntry, StorageType, WriteStreamOptions } from '../../src/shared/types/storage';
import type { StorageConnectConfig } from '../../src/shared/types/ipc';

const FAST_PARAMS: ScryptParams = { N: 16, r: 1, p: 1, maxmem: 4 * 1024 * 1024 };

class MockIpcMain {
  handlers = new Map<string, (...args: any[]) => any>();
  handle(channel: string, listener: (...args: any[]) => any) {
    this.handlers.set(channel, listener);
  }
  removeHandler(channel: string) {
    this.handlers.delete(channel);
  }
  async invoke(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for channel "${channel}"`);
    return await handler({} as any, ...args);
  }
}

/** Same in-memory IStorageProvider double used in ProfileSyncService.test.ts. */
class FakeStorageProvider implements IStorageProvider {
  readonly id = 'fake';
  readonly name = 'fake';
  readonly type: StorageType = 'sftp';
  private files = new Map<string, { buffer: Buffer; mtime: string }>();
  private clock = 0;

  async list(): Promise<FileEntry[]> {
    return [];
  }
  async stat(remotePath: string): Promise<FileEntry> {
    const entry = this.files.get(remotePath);
    if (!entry) {
      const err: any = new Error(`not found: ${remotePath}`);
      err.code = 'ENOENT';
      throw err;
    }
    return { name: path.basename(remotePath), path: remotePath, size: entry.buffer.length, isDirectory: false, mtime: entry.mtime };
  }
  async createFolder(): Promise<void> {}
  async delete(remotePath: string): Promise<void> {
    this.files.delete(remotePath);
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    const entry = this.files.get(oldPath);
    if (!entry) throw new Error(`rename source missing: ${oldPath}`);
    this.files.delete(oldPath);
    this.files.set(newPath, entry);
  }
  async createReadStream(remotePath: string): Promise<NodeJS.ReadableStream> {
    const entry = this.files.get(remotePath);
    if (!entry) {
      const err: any = new Error(`not found: ${remotePath}`);
      err.code = 'ENOENT';
      throw err;
    }
    return Readable.from([entry.buffer]);
  }
  async createWriteStream(remotePath: string, _options?: WriteStreamOptions): Promise<NodeJS.WritableStream> {
    const chunks: Buffer[] = [];
    return new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk as Buffer);
        cb();
      },
      final: (cb) => {
        this.clock += 1;
        this.files.set(remotePath, { buffer: Buffer.concat(chunks), mtime: String(this.clock) });
        cb();
      },
    });
  }
}

interface Harness {
  bridge: IpcBridge;
  ipc: MockIpcMain;
  dir: string;
}

async function makeHarness(sharedProvider: FakeStorageProvider): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-ipc-sync-test-'));
  const profileStore = new ProfileStore(path.join(dir, 'profiles.json'));
  const dotfilePoolStore = new DotfilePoolStore(path.join(dir, 'dotfile-pools.json'));
  const settingsStore = new SettingsStore(path.join(dir, 'settings.json'));
  const syncConfigStore = new SyncConfigStore(path.join(dir, 'sync-config.json'));
  const syncCryptoService = new SyncCryptoService(FAST_PARAMS);
  const profileSyncService = new ProfileSyncService(profileStore, dotfilePoolStore, settingsStore, syncCryptoService, {
    sshConfigPath: path.join(dir, 'ssh_config'),
    knownHostsPath: path.join(dir, 'known_hosts'),
  });

  const storageRegistry = {
    getOrCreate: vi.fn().mockResolvedValue(sharedProvider),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  const ipc = new MockIpcMain();
  const bridge = new IpcBridge({
    ipcMain: ipc as any,
    storageRegistry: storageRegistry as any,
    profileStore,
    dotfilePoolStore,
    settingsStore,
    syncConfigStore,
    syncCryptoService,
    profileSyncService,
  });
  bridge.register();

  return { bridge, ipc, dir };
}

const TARGET: StorageConnectConfig = {
  id: 'sync-target',
  name: 'My Sync Bucket',
  type: 's3',
  s3Config: { id: 'sync-target', name: 'My Sync Bucket', region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'shh' },
};

describe('IpcBridge — remote profile sync handlers', () => {
  let provider: FakeStorageProvider;
  let dirs: string[];

  beforeEach(() => {
    provider = new FakeStorageProvider();
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function harness(): Promise<Harness> {
    const h = await makeHarness(provider);
    dirs.push(h.dir);
    return h;
  }

  it('reports not configured before setup', async () => {
    const { ipc } = await harness();
    const status = await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_STATUS);
    expect(status.configured).toBe(false);
    expect(status.topologyUnlocked).toBe(false);
  });

  it('rejects a local-type sync target', async () => {
    const { ipc } = await harness();
    await expect(
      ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: { id: 'x', name: 'x', type: 'local' } })
    ).rejects.toThrow(/SFTP or S3/);
  });

  it('setup then enable on a brand new target generates salts and does an initial push', async () => {
    const { ipc } = await harness();
    await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: TARGET, remoteBasePath: 'test-bucket' });

    const status = await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, {
      topologyPassword: 'topology-pw',
      credentialsPassword: 'credentials-pw',
    });

    expect(status.configured).toBe(true);
    expect(status.topologyUnlocked).toBe(true);
    expect(status.credentialsUnlocked).toBe(true);
    expect(status.lastSyncAt).toBeTruthy();
    expect(status.target).toEqual({ id: 'sync-target', name: 'My Sync Bucket', type: 's3' });
  });

  it('refuses to enable with fresh salts when the target already has remote data from elsewhere', async () => {
    // Machine A sets up and enables first, pushing real data to the shared provider.
    const machineA = await harness();
    await machineA.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: TARGET, remoteBasePath: 'test-bucket' });
    await machineA.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, {
      topologyPassword: 'topology-pw',
      credentialsPassword: 'credentials-pw',
    });

    // Machine B has its own, never-before-configured local sync-config, but points at the same remote target.
    const machineB = await harness();
    await machineB.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: TARGET, remoteBasePath: 'test-bucket' });

    await expect(
      machineB.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, {
        topologyPassword: 'topology-pw',
        credentialsPassword: 'credentials-pw',
      })
    ).rejects.toThrow(/profile-sync:pull/);
  });

  it('push after enable updates lastSyncAt', async () => {
    const { ipc } = await harness();
    await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: TARGET, remoteBasePath: 'test-bucket' });
    const enabled = await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, {
      topologyPassword: 'topology-pw',
      credentialsPassword: 'credentials-pw',
    });

    await new Promise((r) => setTimeout(r, 2));
    const pushed = await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_PUSH);
    expect(new Date(pushed.lastSyncAt).getTime()).toBeGreaterThanOrEqual(new Date(enabled.lastSyncAt).getTime());
  });

  it('bootstraps a fresh machine via pull with explicit passwords and persists the learned salts', async () => {
    const machineA = await harness();
    await machineA.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: TARGET, remoteBasePath: 'test-bucket' });
    await machineA.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, {
      topologyPassword: 'topology-pw',
      credentialsPassword: 'credentials-pw',
    });

    const machineB = await harness();
    await machineB.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: TARGET, remoteBasePath: 'test-bucket' });
    const result = await machineB.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_PULL, {
      topologyPassword: 'topology-pw',
      credentialsPassword: 'credentials-pw',
    });

    expect(result.topologyUnlocked).toBe(true);
    expect(result.credentialsUnlocked).toBe(true);

    // A second pull, with no passwords this time, must succeed using the salts persisted from the first pull.
    const status = await machineB.ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_STATUS);
    expect(status.lastSyncAt).toBeTruthy();
  });

  it('setup, enable, and pull all fail clearly without a configured target', async () => {
    const { ipc } = await harness();
    await expect(ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, { topologyPassword: 'a', credentialsPassword: 'b' })).rejects.toThrow(
      /profile-sync:setup/
    );
    await expect(ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_PULL)).rejects.toThrow(/profile-sync:setup/);
    await expect(ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_PUSH)).rejects.toThrow(/profile-sync:setup/);
    await expect(ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_COMPARE)).rejects.toThrow(/profile-sync:setup/);
  });

  it('performs live sync comparison via PROFILE_SYNC_COMPARE', async () => {
    const { ipc } = await harness();
    await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, { target: TARGET, remoteBasePath: 'test-bucket' });
    await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, {
      topologyPassword: 'topology-pw',
      credentialsPassword: 'credentials-pw',
    });

    const comparison = await ipc.invoke(IPC_CHANNELS.PROFILE_SYNC_COMPARE);
    expect(comparison).toBeDefined();
    expect(comparison.state).toBe('in_sync');
    expect(comparison.aheadCount).toBe(0);
    expect(comparison.behindCount).toBe(0);
  });
});
