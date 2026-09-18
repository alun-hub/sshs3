import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';

const { mockIpcRenderer, mockExposeInMainWorld } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  return {
    mockExposeInMainWorld: vi.fn(),
    mockIpcRenderer: {
      invoke: vi.fn().mockImplementation(async (channel: string, ...args: any[]) => {
        return { invoked: channel, args };
      }),
      on: vi.fn().mockImplementation((channel: string, listener: (...args: any[]) => void) => {
        if (!listeners.has(channel)) {
          listeners.set(channel, new Set());
        }
        listeners.get(channel)!.add(listener);
      }),
      removeListener: vi.fn().mockImplementation((channel: string, listener: (...args: any[]) => void) => {
        listeners.get(channel)?.delete(listener);
      }),
    },
  };
});

vi.mock('electron', () => {
  const mockObj = {
    ipcRenderer: mockIpcRenderer,
    contextBridge: {
      exposeInMainWorld: mockExposeInMainWorld,
    },
    ipcMain: {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    },
    app: {
      getVersion: vi.fn().mockReturnValue('0.1.0'),
      getPath: vi.fn().mockReturnValue('/tmp/user-data'),
    },
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/chosen/file.pem'] }),
    },
    shell: {
      openPath: vi.fn().mockResolvedValue(''),
    },
    BrowserWindow: vi.fn(),
  };
  return {
    ...mockObj,
    default: mockObj,
  };
});

import { IpcBridge } from '../../src/main/IpcBridge';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import { api as preloadApi, exposePreloadApi } from '../../src/preload/index';
import type { IStorageProvider, FileEntry } from '../../src/shared/types/storage';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

// Mock IpcMain implementation for main process testing
class MockIpcMain {
  handlers: Map<string, (...args: any[]) => any> = new Map();

  handle(channel: string, listener: (...args: any[]) => any) {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string) {
    this.handlers.delete(channel);
  }

  async invoke(channel: string, ...args: any[]): Promise<any> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for channel "${channel}"`);
    }
    return await handler({} as any, ...args);
  }
}

// Mock WebContents
class MockWebContents {
  events: Array<{ channel: string; args: any[] }> = [];
  destroyed = false;

  send(channel: string, ...args: any[]) {
    if (!this.destroyed) {
      this.events.push({ channel, args });
    }
  }

  isDestroyed() {
    return this.destroyed;
  }
}

describe('IpcBridge', () => {
  let mockIpc: MockIpcMain;
  let mockWebContents: MockWebContents;
  let mockPtyManager: any;
  let mockStorageRegistry: any;
  let mockTransferQueue: any;
  let mockProfileStore: any;
  let mockSessionStore: any;
  let mockSettingsStore: any;
  let bridge: IpcBridge;

  beforeEach(() => {
    mockIpc = new MockIpcMain();
    mockWebContents = new MockWebContents();

    const ptyEmitter = new EventEmitter();
    mockPtyManager = Object.assign(ptyEmitter, {
      createSession: vi.fn().mockResolvedValue({ sessionId: 'session-123' }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn().mockResolvedValue(undefined),
    });

    const mockProvider: IStorageProvider = {
      id: 'test-storage',
      name: 'Test Storage',
      type: 'local',
      list: vi.fn().mockResolvedValue([{ name: 'file.txt', path: '/file.txt', size: 100, isDirectory: false }]),
      stat: vi.fn().mockResolvedValue({ name: 'file.txt', path: '/file.txt', size: 100, isDirectory: false }),
      createFolder: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      chmod: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(),
      createWriteStream: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    mockStorageRegistry = {
      providers: new Map<string, IStorageProvider>([['test-storage', mockProvider]]),
      getOrCreate: vi.fn().mockImplementation(async (config: any) => {
        mockStorageRegistry.providers.set(config.id, mockProvider);
        return mockProvider;
      }),
      get: vi.fn().mockImplementation((id: string) => mockStorageRegistry.providers.get(id)),
      disconnect: vi.fn().mockResolvedValue(undefined),
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    };

    const transferEmitter = new EventEmitter();
    mockTransferQueue = Object.assign(transferEmitter, {
      addJob: vi.fn().mockReturnValue({ id: 'job-123' }),
      pauseJob: vi.fn(),
      resumeJob: vi.fn(),
      cancelJob: vi.fn(),
      getJobs: vi.fn().mockReturnValue([
        {
          id: 'job-123',
          progress: {
            jobId: 'job-123',
            fileName: 'file.txt',
            transferredBytes: 50,
            totalBytes: 100,
            percentage: 50,
            bytesPerSecond: 10,
            status: 'running',
          },
        },
      ]),
      clearCompleted: vi.fn(),
      cancelAll: vi.fn(),
      getActiveTransferCount: vi.fn().mockReturnValue(0),
      hasActiveTransfers: vi.fn().mockReturnValue(false),
    });

    mockProfileStore = {
      getProfiles: vi.fn().mockResolvedValue({ ssh: [], s3: [] }),
      saveSSH: vi.fn().mockResolvedValue(undefined),
      deleteSSH: vi.fn().mockResolvedValue(undefined),
      saveS3: vi.fn().mockResolvedValue(undefined),
      deleteS3: vi.fn().mockResolvedValue(undefined),
    };

    mockSessionStore = {
      getSession: vi.fn().mockResolvedValue({ tabs: [], activeTabId: 't1' }),
      saveSession: vi.fn().mockResolvedValue(undefined),
    };

    mockSettingsStore = {
      getSettings: vi.fn().mockResolvedValue({ theme: 'system', terminal: { fontSize: 14, fontFamily: 'monospace' }, defaultTabType: 'terminal' }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    };

    bridge = new IpcBridge({
      ipcMain: mockIpc as any,
      sshPtyManager: mockPtyManager,
      storageRegistry: mockStorageRegistry,
      transferQueue: mockTransferQueue,
      profileStore: mockProfileStore,
      sessionStore: mockSessionStore,
      settingsStore: mockSettingsStore,
      getWebContents: () => mockWebContents as any,
    });

    bridge.register();
  });

  afterEach(async () => {
    await bridge.dispose();
  });

  describe('Terminal IPC Handlers & Events', () => {
    it('handles terminalCreate', async () => {
      const config: SSHConnectionConfig = {
        id: 'conn-1',
        name: 'SSH 1',
        host: 'localhost',
        username: 'user',
        authType: 'password',
      };
      const res = await mockIpc.invoke(IPC_CHANNELS.TERMINAL_CREATE, { config, ptyOptions: { cols: 100, rows: 40 } });
      expect(mockPtyManager.createSession).toHaveBeenCalledWith(config, { cols: 100, rows: 40 });
      expect(res).toEqual({ sessionId: 'session-123' });
    });

    it('throws when creating terminal without config', async () => {
      await expect(mockIpc.invoke(IPC_CHANNELS.TERMINAL_CREATE, null as any)).rejects.toThrow();
    });

    it('handles terminalWrite, resize, and kill', async () => {
      await mockIpc.invoke(IPC_CHANNELS.TERMINAL_WRITE, 'session-123', 'ls -la\n');
      expect(mockPtyManager.write).toHaveBeenCalledWith('session-123', 'ls -la\n');

      await mockIpc.invoke(IPC_CHANNELS.TERMINAL_RESIZE, 'session-123', 120, 30);
      expect(mockPtyManager.resize).toHaveBeenCalledWith('session-123', 120, 30);

      await mockIpc.invoke(IPC_CHANNELS.TERMINAL_KILL, 'session-123');
      expect(mockPtyManager.kill).toHaveBeenCalledWith('session-123');
    });

    it('forwards pty data events to webContents', () => {
      mockPtyManager.emit('data', { sessionId: 'session-123', data: 'hello world' });
      expect(mockWebContents.events).toContainEqual({
        channel: IPC_CHANNELS.TERMINAL_DATA,
        args: ['session-123', 'hello world'],
      });
    });

    it('forwards pty exit events to webContents', () => {
      mockPtyManager.emit('exit', { sessionId: 'session-123', exitCode: 0, signal: undefined });
      expect(mockWebContents.events).toContainEqual({
        channel: IPC_CHANNELS.TERMINAL_EXIT,
        args: ['session-123', { exitCode: 0, signal: undefined }],
      });
    });

    it('does not send pty events if webContents is destroyed', () => {
      mockWebContents.destroyed = true;
      mockPtyManager.emit('data', { sessionId: 'session-123', data: 'dropped' });
      expect(mockWebContents.events).toHaveLength(0);
    });
  });

  describe('Smartcard & Askpass Handlers & Events', () => {
    it('handles smartcardDetect', async () => {
      const libs = await mockIpc.invoke(IPC_CHANNELS.SMARTCARD_DETECT);
      expect(Array.isArray(libs)).toBe(true);
    });

    it('handles smartcardValidate', async () => {
      const res = await mockIpc.invoke(IPC_CHANNELS.SMARTCARD_VALIDATE, '/non/existent/path.so');
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('handles askpass prompt and pin submission', async () => {
      let pinResolved: string | null = null;
      mockPtyManager.emit('askpass', {
        sessionId: 'session-123',
        prompt: 'Enter PIN for Smartcard:',
        callback: (pin: string) => {
          pinResolved = pin;
        },
      });

      const promptEvent = mockWebContents.events.find((e) => e.channel === IPC_CHANNELS.ASKPASS_PROMPT);
      expect(promptEvent).toBeDefined();
      expect(promptEvent?.args[0]).toHaveProperty('id');
      expect(promptEvent?.args[0].prompt).toBe('Enter PIN for Smartcard:');
      expect(promptEvent?.args[0].sessionId).toBe('session-123');

      const promptId = promptEvent?.args[0].id;
      await mockIpc.invoke(IPC_CHANNELS.ASKPASS_SUBMIT_PIN, promptId, '123456');
      expect(pinResolved).toBe('123456');

      await expect(mockIpc.invoke(IPC_CHANNELS.ASKPASS_SUBMIT_PIN, promptId, '123456')).rejects.toThrow();
    });

    it('pty exit removes pending askpass prompts for that sessionId', async () => {
      let pinResolved: string | null = null;
      mockPtyManager.emit('askpass', {
        sessionId: 'session-to-exit',
        prompt: 'Enter PIN:',
        callback: (pin: string) => {
          pinResolved = pin;
        },
      });

      const promptEvent = mockWebContents.events.find(
        (e) => e.channel === IPC_CHANNELS.ASKPASS_PROMPT && e.args[0].sessionId === 'session-to-exit'
      );
      expect(promptEvent).toBeDefined();
      const promptId = promptEvent?.args[0].id;

      // Session exits before submit
      mockPtyManager.emit('exit', { sessionId: 'session-to-exit', exitCode: 1 });
      expect(pinResolved).toBe('');

      // Trying to submit now should throw not found/expired
      await expect(mockIpc.invoke(IPC_CHANNELS.ASKPASS_SUBMIT_PIN, promptId, '1234')).rejects.toThrow();
    });
  });

  describe('Host key trust-on-first-use prompts', () => {
    it('sends a HOSTKEY_PROMPT event and resolves once HOSTKEY_RESPOND is invoked', async () => {
      const promptPromise = bridge.promptHostKeyTrust({
        host: 'unknown.example.com',
        port: 22,
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc123',
        status: 'unknown',
      });

      const promptEvent = mockWebContents.events.find((e) => e.channel === IPC_CHANNELS.HOSTKEY_PROMPT);
      expect(promptEvent).toBeDefined();
      expect(promptEvent?.args[0]).toMatchObject({
        host: 'unknown.example.com',
        port: 22,
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc123',
        status: 'unknown',
      });
      const promptId = promptEvent?.args[0].id;
      expect(promptId).toBeDefined();

      await mockIpc.invoke(IPC_CHANNELS.HOSTKEY_RESPOND, promptId, true);
      await expect(promptPromise).resolves.toBe(true);
    });

    it('responding to an unknown/expired prompt id throws', async () => {
      await expect(mockIpc.invoke(IPC_CHANNELS.HOSTKEY_RESPOND, 'no-such-id', true)).rejects.toThrow();
    });

    it('resolves to false without prompting when no webContents is available', async () => {
      const bridgeNoWindow = new IpcBridge({
        ipcMain: new MockIpcMain() as any,
        sshPtyManager: mockPtyManager,
        storageRegistry: mockStorageRegistry,
        transferQueue: mockTransferQueue,
        profileStore: mockProfileStore,
        getWebContents: () => null,
      });
      bridgeNoWindow.register();

      const result = await bridgeNoWindow.promptHostKeyTrust({
        host: 'no-window.example.com',
        port: 22,
        keyType: 'ssh-rsa',
        fingerprint: 'SHA256:xyz',
        status: 'unknown',
      });
      expect(result).toBe(false);

      await bridgeNoWindow.dispose();
    });

    it('dispose() rejects (resolves false) any pending host key prompts', async () => {
      const promptPromise = bridge.promptHostKeyTrust({
        host: 'pending.example.com',
        port: 22,
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:pending',
        status: 'unknown',
      });

      await bridge.dispose();
      await expect(promptPromise).resolves.toBe(false);
    });
  });

  describe('Storage Handlers', () => {
    it('handles storage connect and disconnect', async () => {
      const res = await mockIpc.invoke(IPC_CHANNELS.STORAGE_CONNECT, {
        id: 's1',
        name: 'Local',
        type: 'local',
      });
      expect(res).toEqual({ id: 's1' });
      expect(mockStorageRegistry.getOrCreate).toHaveBeenCalled();

      await mockIpc.invoke(IPC_CHANNELS.STORAGE_DISCONNECT, 's1');
      expect(mockStorageRegistry.disconnect).toHaveBeenCalledWith('s1');
    });

    it('handles storage operations (list, stat, createFolder, delete, rename)', async () => {
      const list: FileEntry[] = await mockIpc.invoke(IPC_CHANNELS.STORAGE_LIST, 'test-storage', '/');
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('file.txt');

      const stat: FileEntry = await mockIpc.invoke(IPC_CHANNELS.STORAGE_STAT, 'test-storage', '/file.txt');
      expect(stat.size).toBe(100);

      await mockIpc.invoke(IPC_CHANNELS.STORAGE_CREATE_FOLDER, 'test-storage', '/new-folder');
      await mockIpc.invoke(IPC_CHANNELS.STORAGE_DELETE, 'test-storage', '/file.txt', false);
      await mockIpc.invoke(IPC_CHANNELS.STORAGE_RENAME, 'test-storage', '/file.txt', '/renamed.txt');

      const provider = mockStorageRegistry.get('test-storage');
      expect(provider.createFolder).toHaveBeenCalledWith('/new-folder');
      expect(provider.delete).toHaveBeenCalledWith('/file.txt', false);
      expect(provider.rename).toHaveBeenCalledWith('/file.txt', '/renamed.txt');
    });

    it('throws error when storage provider is not found', async () => {
      await expect(mockIpc.invoke(IPC_CHANNELS.STORAGE_LIST, 'unknown-id', '/')).rejects.toThrow(
        'Storage provider not found: unknown-id'
      );
      await expect(mockIpc.invoke(IPC_CHANNELS.STORAGE_STAT, 'unknown-id', '/')).rejects.toThrow(
        'Storage provider not found: unknown-id'
      );
      await expect(mockIpc.invoke(IPC_CHANNELS.STORAGE_CREATE_FOLDER, 'unknown-id', '/')).rejects.toThrow(
        'Storage provider not found: unknown-id'
      );
      await expect(mockIpc.invoke(IPC_CHANNELS.STORAGE_DELETE, 'unknown-id', '/', false)).rejects.toThrow(
        'Storage provider not found: unknown-id'
      );
      await expect(mockIpc.invoke(IPC_CHANNELS.STORAGE_RENAME, 'unknown-id', '/a', '/b')).rejects.toThrow(
        'Storage provider not found: unknown-id'
      );
    });
  });

  describe('Transfer Handlers & Events', () => {
    it('handles transferAdd with valid providers', async () => {
      mockStorageRegistry.providers.set('target-storage', mockStorageRegistry.providers.get('test-storage'));

      const res = await mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'test-storage',
        sourcePath: '/src/file.txt',
        targetProviderId: 'target-storage',
        targetPath: '/dst/file.txt',
        conflictPolicy: 'overwrite',
      });

      expect(res).toMatchObject({ jobId: 'job-123' });
      expect(mockTransferQueue.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath: '/src/file.txt',
          targetPath: '/dst/file.txt',
          isDirectory: false,
          totalBytes: 100,
        })
      );
    });

    it('resolves targetPath when target is a directory in transferAdd', async () => {
      const dirProvider = {
        ...mockStorageRegistry.providers.get('test-storage'),
        stat: vi.fn().mockImplementation(async (p: string) => {
          if (p === '/dst/folder') {
            return { name: 'folder', path: '/dst/folder', size: 0, isDirectory: true };
          }
          return { name: 'photo.png', path: '/src/photo.png', size: 2048, isDirectory: false };
        }),
      };
      mockStorageRegistry.providers.set('target-dir-storage', dirProvider as any);
      mockStorageRegistry.providers.set('src-storage', dirProvider as any);

      const res = await mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'src-storage',
        sourcePath: '/src/photo.png',
        targetProviderId: 'target-dir-storage',
        targetPath: '/dst/folder',
        conflictPolicy: 'overwrite',
      });

      expect(res).toMatchObject({ jobId: 'job-123' });
      expect(mockTransferQueue.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath: '/src/photo.png',
          targetPath: path.join('/dst/folder', 'photo.png'),
          isDirectory: false,
          totalBytes: 2048,
        })
      );
    });

    it('detects isDirectory: true when source is a directory in transferAdd', async () => {
      const dirProvider = {
        ...mockStorageRegistry.providers.get('test-storage'),
        stat: vi.fn().mockImplementation(async (p: string) => {
          if (p === '/src/my-folder') {
            return { name: 'my-folder', path: '/src/my-folder', size: 0, isDirectory: true };
          }
          if (p === '/dst') {
            return { name: 'dst', path: '/dst', size: 0, isDirectory: true };
          }
          return { name: 'unknown', path: p, size: 0, isDirectory: false };
        }),
      };
      mockStorageRegistry.providers.set('target-dir-storage', dirProvider as any);
      mockStorageRegistry.providers.set('src-storage', dirProvider as any);

      const res = await mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'src-storage',
        sourcePath: '/src/my-folder',
        targetProviderId: 'target-dir-storage',
        targetPath: '/dst',
        conflictPolicy: 'overwrite',
      });

      expect(res).toMatchObject({ jobId: 'job-123' });
      expect(mockTransferQueue.addJob).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath: '/src/my-folder',
          targetPath: path.join('/dst', 'my-folder'),
          isDirectory: true,
        })
      );
    });

    it('throws error if transfer options or provider IDs are missing', async () => {
      await expect(mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, null as any)).rejects.toThrow(
        'sourceProviderId and targetProviderId are required'
      );

      await expect(
        mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
          sourceProviderId: '',
          sourcePath: '/src',
          targetProviderId: 'test-storage',
          targetPath: '/dst',
        })
      ).rejects.toThrow('sourceProviderId and targetProviderId are required');

      await expect(
        mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
          sourceProviderId: 'test-storage',
          sourcePath: '/src',
          targetProviderId: '',
          targetPath: '/dst',
        })
      ).rejects.toThrow('sourceProviderId and targetProviderId are required');
    });

    it('throws error if transfer source or target provider is missing in registry', async () => {
      await expect(
        mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
          sourceProviderId: 'missing-src',
          sourcePath: '/src',
          targetProviderId: 'test-storage',
          targetPath: '/dst',
        })
      ).rejects.toThrow('Source storage provider not found');

      await expect(
        mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
          sourceProviderId: 'test-storage',
          sourcePath: '/src',
          targetProviderId: 'missing-target',
          targetPath: '/dst',
        })
      ).rejects.toThrow('Target storage provider not found');
    });

    it('handles transfer controls (pause, resume, cancel, getJobs, clearCompleted)', async () => {
      await mockIpc.invoke(IPC_CHANNELS.TRANSFER_PAUSE, 'job-123');
      expect(mockTransferQueue.pauseJob).toHaveBeenCalledWith('job-123');

      await mockIpc.invoke(IPC_CHANNELS.TRANSFER_RESUME, 'job-123');
      expect(mockTransferQueue.resumeJob).toHaveBeenCalledWith('job-123');

      await mockIpc.invoke(IPC_CHANNELS.TRANSFER_CANCEL, 'job-123');
      expect(mockTransferQueue.cancelJob).toHaveBeenCalledWith('job-123');

      const jobs = await mockIpc.invoke(IPC_CHANNELS.TRANSFER_GET_JOBS);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe('job-123');

      await mockIpc.invoke(IPC_CHANNELS.TRANSFER_CLEAR_COMPLETED);
      expect(mockTransferQueue.clearCompleted).toHaveBeenCalled();
    });

    it('forwards transfer progress events to webContents', () => {
      const progress = {
        jobId: 'job-123',
        fileName: 'test.zip',
        transferredBytes: 500,
        totalBytes: 1000,
        percentage: 50,
        bytesPerSecond: 100,
        status: 'running' as const,
      };
      mockTransferQueue.emit('progress', progress);
      expect(mockWebContents.events).toContainEqual({
        channel: IPC_CHANNELS.TRANSFER_PROGRESS,
        args: [progress],
      });
    });
  });

  describe('Transfer conflict resolution', () => {
    function makeConflictProvider() {
      return {
        id: 'conflict-target',
        name: 'Conflict Target',
        type: 'local',
        stat: vi.fn().mockImplementation(async (p: string) => {
          const normalized = p.replace(/\\/g, '/');
          if (normalized === '/dst/exists.txt') {
            return { name: 'exists.txt', path: p, size: 10, isDirectory: false };
          }
          if (normalized === '/dst/exists (1).txt') {
            return { name: 'exists (1).txt', path: p, size: 5, isDirectory: false };
          }
          throw new Error('ENOENT');
        }),
        list: vi.fn(),
        createFolder: vi.fn(),
        delete: vi.fn(),
        rename: vi.fn(),
        createReadStream: vi.fn(),
        createWriteStream: vi.fn(),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
    }

    async function flushMicrotasks() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('does not prompt and adds the job directly when the target does not exist', async () => {
      mockStorageRegistry.providers.set('conflict-target', makeConflictProvider() as any);

      const res = await mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'test-storage',
        sourcePath: '/src/file.txt',
        targetProviderId: 'conflict-target',
        targetPath: '/dst/new-file.txt',
      });

      expect(res).toMatchObject({ jobId: 'job-123' });
      expect(res.resolvedPolicy).toBeUndefined();
      expect(mockWebContents.events.some((e) => e.channel === IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT)).toBe(false);
    });

    it('prompts for a conflicting target and applies "overwrite"', async () => {
      mockStorageRegistry.providers.set('conflict-target', makeConflictProvider() as any);

      const resultPromise = mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'test-storage',
        sourcePath: '/src/file.txt',
        targetProviderId: 'conflict-target',
        targetPath: '/dst/exists.txt',
      });

      await flushMicrotasks();
      const promptEvent = mockWebContents.events.find((e) => e.channel === IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT);
      expect(promptEvent).toBeDefined();
      expect(promptEvent?.args[0]).toMatchObject({
        targetPath: '/dst/exists.txt',
        fileName: 'file.txt',
        isDirectory: false,
      });
      const promptId = promptEvent?.args[0].id;

      await mockIpc.invoke(IPC_CHANNELS.TRANSFER_CONFLICT_RESPOND, promptId, 'overwrite', false);

      const res = await resultPromise;
      expect(res).toMatchObject({ jobId: 'job-123', resolvedPolicy: 'overwrite', appliedToAll: false });
      expect(mockTransferQueue.addJob).toHaveBeenCalledWith(
        expect.objectContaining({ targetPath: '/dst/exists.txt' })
      );
    });

    it('prompts for a conflicting target and applies "skip" without adding a job', async () => {
      mockStorageRegistry.providers.set('conflict-target', makeConflictProvider() as any);
      mockTransferQueue.addJob.mockClear();

      const resultPromise = mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'test-storage',
        sourcePath: '/src/file.txt',
        targetProviderId: 'conflict-target',
        targetPath: '/dst/exists.txt',
      });

      await flushMicrotasks();
      const promptEvent = mockWebContents.events.find((e) => e.channel === IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT);
      const promptId = promptEvent?.args[0].id;

      await mockIpc.invoke(IPC_CHANNELS.TRANSFER_CONFLICT_RESPOND, promptId, 'skip', true);

      const res = await resultPromise;
      expect(res).toEqual({ jobId: null, skipped: true, resolvedPolicy: 'skip', appliedToAll: true });
      expect(mockTransferQueue.addJob).not.toHaveBeenCalled();
    });

    it('prompts for a conflicting target and applies "rename" to a non-conflicting path', async () => {
      mockStorageRegistry.providers.set('conflict-target', makeConflictProvider() as any);

      const resultPromise = mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'test-storage',
        sourcePath: '/src/file.txt',
        targetProviderId: 'conflict-target',
        targetPath: '/dst/exists.txt',
      });

      await flushMicrotasks();
      const promptEvent = mockWebContents.events.find((e) => e.channel === IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT);
      const promptId = promptEvent?.args[0].id;

      await mockIpc.invoke(IPC_CHANNELS.TRANSFER_CONFLICT_RESPOND, promptId, 'rename', false);

      const res = await resultPromise;
      expect(res).toMatchObject({ jobId: 'job-123', resolvedPolicy: 'rename' });
      // "exists.txt" and "exists (1).txt" both already exist on this fake
      // provider, so the resolver should have skipped to "exists (2).txt".
      expect(mockTransferQueue.addJob).toHaveBeenCalledWith(
        expect.objectContaining({ targetPath: path.join('/dst', 'exists (2).txt') })
      );
    });

    it('skips prompting when an explicit conflictPolicy is given', async () => {
      mockStorageRegistry.providers.set('conflict-target', makeConflictProvider() as any);

      const res = await mockIpc.invoke(IPC_CHANNELS.TRANSFER_ADD, {
        sourceProviderId: 'test-storage',
        sourcePath: '/src/file.txt',
        targetProviderId: 'conflict-target',
        targetPath: '/dst/exists.txt',
        conflictPolicy: 'overwrite',
      });

      expect(res).toMatchObject({ jobId: 'job-123', resolvedPolicy: 'overwrite' });
      expect(mockWebContents.events.some((e) => e.channel === IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT)).toBe(false);
    });

    it('resolves to a safe "skip" without prompting when no webContents is available', async () => {
      const bridgeNoWindow = new IpcBridge({
        ipcMain: new MockIpcMain() as any,
        sshPtyManager: mockPtyManager,
        storageRegistry: mockStorageRegistry,
        transferQueue: mockTransferQueue,
        profileStore: mockProfileStore,
        getWebContents: () => null,
      });
      bridgeNoWindow.register();

      const result = await bridgeNoWindow.promptTransferConflict({
        sourcePath: '/src/file.txt',
        targetPath: '/dst/exists.txt',
        fileName: 'file.txt',
        isDirectory: false,
      });
      expect(result).toEqual({ resolution: 'skip', applyToAll: false });

      await bridgeNoWindow.dispose();
    });

    it('dispose() resolves any pending transfer conflict prompts to "skip"', async () => {
      const promptPromise = bridge.promptTransferConflict({
        sourcePath: '/src/file.txt',
        targetPath: '/dst/exists.txt',
        fileName: 'file.txt',
        isDirectory: false,
      });

      await bridge.dispose();
      await expect(promptPromise).resolves.toEqual({ resolution: 'skip', applyToAll: false });
    });
  });

  describe('Profiles Handlers', () => {
    it('handles profiles get, saveSSH, deleteSSH, saveS3, deleteS3', async () => {
      await mockIpc.invoke(IPC_CHANNELS.PROFILES_GET);
      expect(mockProfileStore.getProfiles).toHaveBeenCalled();

      const sshConfig: SSHConnectionConfig = {
        id: 'ssh-1',
        name: 'SSH',
        host: 'host',
        username: 'user',
        authType: 'password',
      };
      await mockIpc.invoke(IPC_CHANNELS.PROFILES_SAVE_SSH, sshConfig);
      expect(mockProfileStore.saveSSH).toHaveBeenCalledWith(sshConfig);

      await mockIpc.invoke(IPC_CHANNELS.PROFILES_DELETE_SSH, 'ssh-1');
      expect(mockProfileStore.deleteSSH).toHaveBeenCalledWith('ssh-1');

      const s3Config = {
        id: 's3-1',
        name: 'S3',
        region: 'us-east-1',
        accessKeyId: 'k',
        secretAccessKey: 's',
      };
      await mockIpc.invoke(IPC_CHANNELS.PROFILES_SAVE_S3, s3Config);
      expect(mockProfileStore.saveS3).toHaveBeenCalledWith(s3Config);

      await mockIpc.invoke(IPC_CHANNELS.PROFILES_DELETE_S3, 's3-1');
      expect(mockProfileStore.deleteS3).toHaveBeenCalledWith('s3-1');
    });
  });

  describe('General Handlers', () => {
    it('handles app getVersion', async () => {
      const version = await mockIpc.invoke(IPC_CHANNELS.APP_GET_VERSION);
      expect(version).toBe('0.1.0');
    });

    it('returns the chosen path from the native open-file dialog', async () => {
      const path = await mockIpc.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, { title: 'Välj fil' });
      expect(path).toBe('/chosen/file.pem');
    });

    it('returns null when the open-file dialog is cancelled', async () => {
      const { dialog } = await import('electron');
      (dialog.showOpenDialog as any).mockResolvedValueOnce({ canceled: true, filePaths: [] });

      const path = await mockIpc.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE);
      expect(path).toBeNull();
    });
  });

  describe('Disposal', () => {
    it('cleans up handlers and calls killAll / disconnectAll', async () => {
      await bridge.dispose();
      expect(mockIpc.handlers.size).toBe(0);
      expect(mockPtyManager.killAll).toHaveBeenCalled();
      expect(mockStorageRegistry.disconnectAll).toHaveBeenCalled();
    });
  });

  describe('Preload Bridge API (MultiSSHApi)', () => {
    it('exposes api in main world', () => {
      mockExposeInMainWorld.mockClear();
      exposePreloadApi();
      expect(mockExposeInMainWorld).toHaveBeenCalledWith('sshs3', preloadApi);
      expect(mockExposeInMainWorld).toHaveBeenCalledWith('multissh', preloadApi);
    });

    it('terminal methods invoke correct channels', async () => {
      await preloadApi.terminalCreate({
        config: { id: 'c1', name: 'C1', host: 'h', username: 'u', authType: 'password' },
      });
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.TERMINAL_CREATE,
        expect.anything()
      );

      await preloadApi.terminalWrite('s1', 'ls\n');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TERMINAL_WRITE, 's1', 'ls\n');

      await preloadApi.terminalResize('s1', 80, 24);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TERMINAL_RESIZE, 's1', 80, 24);

      await preloadApi.terminalKill('s1');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TERMINAL_KILL, 's1');
    });

    it('terminal listener subscription returns unsubscribe function', () => {
      const cb = vi.fn();
      const unsub = preloadApi.onTerminalData(cb);
      expect(mockIpcRenderer.on).toHaveBeenCalledWith(IPC_CHANNELS.TERMINAL_DATA, expect.any(Function));

      unsub();
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        IPC_CHANNELS.TERMINAL_DATA,
        expect.any(Function)
      );

      const exitCb = vi.fn();
      const exitUnsub = preloadApi.onTerminalExit(exitCb);
      expect(mockIpcRenderer.on).toHaveBeenCalledWith(IPC_CHANNELS.TERMINAL_EXIT, expect.any(Function));

      exitUnsub();
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        IPC_CHANNELS.TERMINAL_EXIT,
        expect.any(Function)
      );
    });

    it('smartcard and askpass methods invoke correct channels', async () => {
      await preloadApi.smartcardDetect();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SMARTCARD_DETECT);

      await preloadApi.smartcardValidate('/lib/test.so');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.SMARTCARD_VALIDATE,
        '/lib/test.so'
      );

      await preloadApi.submitAskpassPin('p1', '1234');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.ASKPASS_SUBMIT_PIN, 'p1', '1234');

      const askpassCb = vi.fn();
      const unsub = preloadApi.onAskpassPrompt(askpassCb);
      expect(mockIpcRenderer.on).toHaveBeenCalledWith(IPC_CHANNELS.ASKPASS_PROMPT, expect.any(Function));
      unsub();
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        IPC_CHANNELS.ASKPASS_PROMPT,
        expect.any(Function)
      );
    });

    it('storage methods invoke correct channels', async () => {
      await preloadApi.connectStorage({ id: 'loc', name: 'Loc', type: 'local' });
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_CONNECT, expect.anything());

      await preloadApi.disconnectStorage('loc');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_DISCONNECT, 'loc');

      await preloadApi.storageList('loc', '/');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_LIST, 'loc', '/');

      await preloadApi.storageStat('loc', '/f');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_STAT, 'loc', '/f');

      await preloadApi.storageCreateFolder('loc', '/dir');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_CREATE_FOLDER, 'loc', '/dir');

      await preloadApi.storageDelete('loc', '/dir', true);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_DELETE, 'loc', '/dir', true);

      await preloadApi.storageRename('loc', '/old', '/new');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_RENAME, 'loc', '/old', '/new');
    });

    it('transfer methods invoke correct channels and handle subscription', async () => {
      await preloadApi.transferAdd({
        sourceProviderId: 's1',
        sourcePath: '/a',
        targetProviderId: 's2',
        targetPath: '/b',
      });
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TRANSFER_ADD, expect.anything());

      await preloadApi.transferPause('j1');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TRANSFER_PAUSE, 'j1');

      await preloadApi.transferResume('j1');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TRANSFER_RESUME, 'j1');

      await preloadApi.transferCancel('j1');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TRANSFER_CANCEL, 'j1');

      await preloadApi.transferGetJobs();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TRANSFER_GET_JOBS);

      await preloadApi.transferClearCompleted();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TRANSFER_CLEAR_COMPLETED);

      const progressCb = vi.fn();
      const unsub = preloadApi.onTransferProgress(progressCb);
      expect(mockIpcRenderer.on).toHaveBeenCalledWith(IPC_CHANNELS.TRANSFER_PROGRESS, expect.any(Function));
      unsub();
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        IPC_CHANNELS.TRANSFER_PROGRESS,
        expect.any(Function)
      );
    });

    it('profile methods invoke correct channels', async () => {
      await preloadApi.profilesGet();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.PROFILES_GET);

      const ssh = { id: 's1', name: 'S1', host: 'h', username: 'u', authType: 'password' as const };
      await preloadApi.profilesSaveSSH(ssh);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.PROFILES_SAVE_SSH, ssh);

      await preloadApi.profilesDeleteSSH('s1');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.PROFILES_DELETE_SSH, 's1');

      const s3 = { id: 's3', name: 'S3', region: 'r', accessKeyId: 'k', secretAccessKey: 's' };
      await preloadApi.profilesSaveS3(s3);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.PROFILES_SAVE_S3, s3);

      await preloadApi.profilesDeleteS3('s3');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.PROFILES_DELETE_S3, 's3');
    });

    it('connection test methods invoke correct channels', async () => {
      const ssh = { id: 's1', name: 'S1', host: 'h', username: 'u', authType: 'password' as const };
      await preloadApi.testSSHConnection(ssh);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.CONNECTION_TEST_SSH, ssh);

      const s3 = { id: 's3', name: 'S3', region: 'r', accessKeyId: 'k', secretAccessKey: 's' };
      await preloadApi.testS3Connection(s3);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.CONNECTION_TEST_S3, s3);
    });

    it('getVersion invokes correct channel', async () => {
      await preloadApi.getVersion();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.APP_GET_VERSION);
    });

    it('storageChmod invokes correct channel', async () => {
      await preloadApi.storageChmod('test-storage', '/test/file.txt', '755');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
        IPC_CHANNELS.STORAGE_CHMOD,
        'test-storage',
        '/test/file.txt',
        '755'
      );
    });

    it('session get and save invoke correct channels', async () => {
      await preloadApi.sessionGet();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_GET);

      const session = { tabs: [], activeTabId: 't1' };
      await preloadApi.sessionSave(session);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SESSION_SAVE, session);
    });

    it('settings get and save invoke correct channels', async () => {
      await preloadApi.settingsGet();
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SETTINGS_GET);

      const settings = { theme: 'dark' as const, terminal: { fontSize: 16, fontFamily: 'monospace' }, defaultTabType: 'terminal' as const };
      await preloadApi.settingsSave(settings);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SETTINGS_SAVE, settings);
    });

    it('dialogOpenFile invokes correct channel with options', async () => {
      const options = { title: 'Välj fil', filters: [{ name: 'Nycklar', extensions: ['pem'] }] };
      await preloadApi.dialogOpenFile(options);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.DIALOG_OPEN_FILE, options);
    });

    it('file editor methods invoke correct channels', async () => {
      await preloadApi.fileRead('p1', '/path/file.txt', 1000);
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.FILE_READ, 'p1', '/path/file.txt', 1000);

      await preloadApi.fileSave('p1', '/path/file.txt', 'hello');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.FILE_SAVE, 'p1', '/path/file.txt', 'hello');

      await preloadApi.fileOpenExternal('p1', '/path/file.txt');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.FILE_OPEN_EXTERNAL, 'p1', '/path/file.txt');

      await preloadApi.fileCloseExternal('token-123');
      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.FILE_CLOSE_EXTERNAL, 'token-123');

      const cb = vi.fn();
      const unsub = preloadApi.onExternalFileStatus(cb);
      expect(mockIpcRenderer.on).toHaveBeenCalledWith(IPC_CHANNELS.FILE_EXTERNAL_STATUS, expect.any(Function));
      unsub();
      expect(mockIpcRenderer.removeListener).toHaveBeenCalledWith(
        IPC_CHANNELS.FILE_EXTERNAL_STATUS,
        expect.any(Function)
      );
    });
  });

  describe('Storage Chmod Handler', () => {
    it('successfully calls provider chmod', async () => {
      const provider = mockStorageRegistry.providers.get('test-storage');
      await mockIpc.invoke(IPC_CHANNELS.STORAGE_CHMOD, 'test-storage', '/var/log/app.log', '644');
      expect(provider.chmod).toHaveBeenCalledWith('/var/log/app.log', '644');
    });

    it('throws error if provider not found or chmod unsupported', async () => {
      await expect(
        mockIpc.invoke(IPC_CHANNELS.STORAGE_CHMOD, 'non-existent', '/file', '755')
      ).rejects.toThrow();
    });
  });

  describe('Session Handlers', () => {
    it('retrieves session data', async () => {
      const data = await mockIpc.invoke(IPC_CHANNELS.SESSION_GET);
      expect(data).toEqual({ tabs: [], activeTabId: 't1' });
      expect(mockSessionStore.getSession).toHaveBeenCalled();
    });

    it('saves session data', async () => {
      const session = { tabs: [{ id: 'tab-1', title: 'SSH', type: 'terminal' }], activeTabId: 'tab-1' };
      await mockIpc.invoke(IPC_CHANNELS.SESSION_SAVE, session);
      expect(mockSessionStore.saveSession).toHaveBeenCalledWith(session);
    });
  });

  describe('Settings Handlers', () => {
    it('retrieves settings data', async () => {
      const settings = await mockIpc.invoke(IPC_CHANNELS.SETTINGS_GET);
      expect(settings).toEqual({ theme: 'system', terminal: { fontSize: 14, fontFamily: 'monospace' }, defaultTabType: 'terminal' });
      expect(mockSettingsStore.getSettings).toHaveBeenCalled();
    });

    it('saves settings data', async () => {
      const settings = { theme: 'light', terminal: { fontSize: 18, fontFamily: 'Fira Code' }, defaultTabType: 'files' };
      await mockIpc.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings);
      expect(mockSettingsStore.saveSettings).toHaveBeenCalledWith(settings);
    });
  });

  describe('Connection Test Handlers', () => {
    it('validates required fields for SSH test', async () => {
      const res1 = await mockIpc.invoke(IPC_CHANNELS.CONNECTION_TEST_SSH, { host: '', username: 'u' });
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('Värdnamn');

      const res2 = await mockIpc.invoke(IPC_CHANNELS.CONNECTION_TEST_SSH, { host: 'h', username: '' });
      expect(res2.success).toBe(false);
      expect(res2.error).toContain('Användarnamn');
    });

    it('validates required fields for S3 test', async () => {
      const res = await mockIpc.invoke(IPC_CHANNELS.CONNECTION_TEST_S3, { region: '', accessKeyId: 'k', secretAccessKey: 's' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Region');
    });
  });

  describe('File Editor Handlers', () => {
    it('delegates fileRead to fileEditorService', async () => {
      vi.spyOn(bridge.fileEditorService, 'readFile').mockResolvedValue({
        content: 'data',
        size: 4,
        isBinary: false,
        truncated: false,
      });

      const res = await mockIpc.invoke(IPC_CHANNELS.FILE_READ, 'test-storage', '/file.txt', 500);
      expect(bridge.fileEditorService.readFile).toHaveBeenCalledWith(
        bridge.storageRegistry,
        'test-storage',
        '/file.txt',
        500
      );
      expect(res.content).toBe('data');
    });

    it('delegates fileSave to fileEditorService', async () => {
      vi.spyOn(bridge.fileEditorService, 'saveFile').mockResolvedValue();

      await mockIpc.invoke(IPC_CHANNELS.FILE_SAVE, 'test-storage', '/file.txt', 'updated');
      expect(bridge.fileEditorService.saveFile).toHaveBeenCalledWith(
        bridge.storageRegistry,
        'test-storage',
        '/file.txt',
        'updated'
      );
    });

    it('delegates fileOpenExternal and fileCloseExternal', async () => {
      vi.spyOn(bridge.fileEditorService, 'openInExternalEditor').mockResolvedValue({
        sessionToken: 'tok-1',
        localPath: '/tmp/f.txt',
      });
      vi.spyOn(bridge.fileEditorService, 'closeExternalEditor').mockResolvedValue();

      const res = await mockIpc.invoke(IPC_CHANNELS.FILE_OPEN_EXTERNAL, 'test-storage', '/file.txt');
      expect(res).toEqual({ sessionToken: 'tok-1', localPath: '/tmp/f.txt' });

      await mockIpc.invoke(IPC_CHANNELS.FILE_CLOSE_EXTERNAL, 'tok-1');
      expect(bridge.fileEditorService.closeExternalEditor).toHaveBeenCalledWith('tok-1');
    });
  });
});
