import { describe, it, expect, vi } from 'vitest';

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
  };
  return {
    ...mockObj,
    default: mockObj,
  };
});

import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import { api as preloadApi, exposePreloadApi } from '../../src/preload/index';

// The renderer-facing API (src/preload/index.ts): each method must call the right channel with the right
// arguments, and each subscription must return a working unsubscribe. These tests live apart from the
// IpcBridge tests because they exercise the preload script, not the main-process bridge.

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

    await preloadApi.storageLookup('loc', '/f');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_LOOKUP, 'loc', '/f');

    await preloadApi.terminalHasSshClient('sess-1');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.TERMINAL_HAS_SSH_CLIENT, 'sess-1');

    await preloadApi.storageCreateFolder('loc', '/dir');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_CREATE_FOLDER, 'loc', '/dir');

    await preloadApi.storageDelete('loc', '/dir', true);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_DELETE, 'loc', '/dir', true);

    await preloadApi.storageRename('loc', '/old', '/new');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_RENAME, 'loc', '/old', '/new');

    await preloadApi.storageGetHomeDir('loc');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.STORAGE_GET_HOMEDIR, 'loc');
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

  it('key install methods invoke correct channels', async () => {
    const cfg = { id: 'p1', name: 'P', host: 'h', username: 'u', authType: 'password' as const };
    await preloadApi.listPublicKeys({ config: cfg, includeHardware: true });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SSH_LIST_PUBLIC_KEYS, {
      config: cfg,
      includeHardware: true,
    });

    await preloadApi.installPublicKeys({ config: cfg, publicKeys: ['k'], loginMethod: 'password' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SSH_INSTALL_PUBLIC_KEYS, {
      config: cfg,
      publicKeys: ['k'],
      loginMethod: 'password',
    });

    await preloadApi.sshProbeHost(cfg);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SSH_PROBE_HOST, cfg);

    await preloadApi.sshTestLogin(cfg);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SSH_TEST_LOGIN, cfg);

    await preloadApi.buildInstallCommand(['k']);
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.SSH_BUILD_INSTALL_COMMAND, ['k']);
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

    await preloadApi.checkX11Server('127.0.0.1:0.0');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.APP_CHECK_X11_SERVER, '127.0.0.1:0.0');

    await preloadApi.x11GetStatus('C:\\tools\\vcxsrv.exe', ':0');
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.X11_GET_STATUS,
      'C:\\tools\\vcxsrv.exe',
      ':0'
    );

    await preloadApi.x11StartServer({ customPath: 'C:\\tools\\vcxsrv.exe' });
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.X11_START_SERVER, {
      customPath: 'C:\\tools\\vcxsrv.exe',
    });

    await preloadApi.x11StopServer();
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.X11_STOP_SERVER);
  });

  it('preload profilesExportJson/profilesImportJson/profilesImportSshConfig take no arguments and forward none', async () => {
    await preloadApi.profilesImportSshConfig();
    expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.PROFILES_IMPORT_SSH_CONFIG);

    await preloadApi.profilesExportJson();
    expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.PROFILES_EXPORT_JSON);

    await preloadApi.profilesImportJson();
    expect(mockIpcRenderer.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.PROFILES_IMPORT_JSON);
  });
});
