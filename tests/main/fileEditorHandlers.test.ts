import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import { registerFileEditorHandlers, type FileEditorHost } from '../../src/main/ipc/fileEditorHandlers';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

describe('FileEditor IPC handlers', () => {
  const handlers = new Map<string, Handler>();

  const storageRegistry = {
    has: vi.fn(),
    getOrCreate: vi.fn(),
  };

  const fileEditorService = {
    readFile: vi.fn(),
    saveFile: vi.fn(),
    openInExternalEditor: vi.fn(),
    closeExternalEditor: vi.fn(),
  };

  const fileTailService = {
    startTail: vi.fn(),
    stopTail: vi.fn(),
  };

  const host: FileEditorHost = {
    fileEditorService: fileEditorService as any,
    fileTailService: fileTailService as any,
    storageRegistry: storageRegistry as any,
    getWebContents: () => null,
    registerHandler: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerFileEditorHandlers(host);
  });

  it('registers all expected IPC handlers', () => {
    expect(handlers.has(IPC_CHANNELS.FILE_READ)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.FILE_SAVE)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.FILE_OPEN_EXTERNAL)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.FILE_CLOSE_EXTERNAL)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.FILE_TAIL_START)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.FILE_TAIL_STOP)).toBe(true);
  });

  it('auto-connects local provider when providerId is "local" and not registered', async () => {
    storageRegistry.has.mockReturnValue(false);
    fileEditorService.readFile.mockResolvedValue({ content: 'hello', size: 5, isBinary: false });

    const readHandler = handlers.get(IPC_CHANNELS.FILE_READ)!;
    const res = await readHandler({}, 'local', '/etc/hosts');

    expect(storageRegistry.getOrCreate).toHaveBeenCalledWith({
      id: 'local',
      name: 'Local Disk',
      type: 'local',
    });
    expect(fileEditorService.readFile).toHaveBeenCalledWith(
      storageRegistry,
      'local',
      '/etc/hosts',
      undefined
    );
    expect(res).toEqual({ content: 'hello', size: 5, isBinary: false });
  });

  it('does not auto-connect remote providers directly (relies on proper connectStorage)', async () => {
    storageRegistry.has.mockReturnValue(false);
    fileEditorService.readFile.mockResolvedValue({ content: 'server-data', size: 11, isBinary: false });

    const readHandler = handlers.get(IPC_CHANNELS.FILE_READ)!;
    await readHandler({}, 'sftp-srv1', '/var/log/syslog', 1024);

    expect(storageRegistry.getOrCreate).not.toHaveBeenCalled();
    expect(fileEditorService.readFile).toHaveBeenCalledWith(
      storageRegistry,
      'sftp-srv1',
      '/var/log/syslog',
      1024
    );
  });

  it('does not re-register local provider if already present in storageRegistry', async () => {
    storageRegistry.has.mockReturnValue(true);

    const readHandler = handlers.get(IPC_CHANNELS.FILE_READ)!;
    await readHandler({}, 'local', '/etc/hosts');

    expect(storageRegistry.getOrCreate).not.toHaveBeenCalled();
  });

  it('delegates saveFile, openInExternalEditor and closeExternalEditor', async () => {
    storageRegistry.has.mockReturnValue(true);
    const saveHandler = handlers.get(IPC_CHANNELS.FILE_SAVE)!;
    await saveHandler({}, 'local', '/tmp/test.txt', 'new-content');
    expect(fileEditorService.saveFile).toHaveBeenCalledWith(storageRegistry, 'local', '/tmp/test.txt', 'new-content');

    const openHandler = handlers.get(IPC_CHANNELS.FILE_OPEN_EXTERNAL)!;
    fileEditorService.openInExternalEditor.mockResolvedValue({ sessionToken: 'tok-123' });
    const openRes = await openHandler({}, 'local', '/tmp/test.txt');
    expect(openRes).toEqual({ sessionToken: 'tok-123' });

    const closeHandler = handlers.get(IPC_CHANNELS.FILE_CLOSE_EXTERNAL)!;
    await closeHandler({}, 'tok-123');
    expect(fileEditorService.closeExternalEditor).toHaveBeenCalledWith('tok-123');
  });

  it('delegates startTail and stopTail', async () => {
    storageRegistry.has.mockReturnValue(true);
    fileTailService.startTail.mockResolvedValue({ tailId: 'tail-99' });

    const tailStartHandler = handlers.get(IPC_CHANNELS.FILE_TAIL_START)!;
    const tailRes = await tailStartHandler({}, 'local', '/var/log/app.log');
    expect(tailRes).toEqual({ tailId: 'tail-99' });

    const tailStopHandler = handlers.get(IPC_CHANNELS.FILE_TAIL_STOP)!;
    await tailStopHandler({}, 'tail-99');
    expect(fileTailService.stopTail).toHaveBeenCalledWith('tail-99');
  });
});
