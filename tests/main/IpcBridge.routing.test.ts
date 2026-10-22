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
import { WindowManager, type ManagedWindow } from '../../src/main/windows/WindowManager';

function fakeWindow(id: number) {
  const send = vi.fn();
  const frame = {};
  const win: ManagedWindow & { send: typeof send; frame: object } = {
    send,
    frame,
    webContents: { id, mainFrame: frame, isDestroyed: () => false, send },
    isDestroyed: () => false,
  };
  return win;
}

function makeBridge() {
  const windows = new WindowManager();
  const a = fakeWindow(1);
  const b = fakeWindow(2);
  windows.register(a);
  windows.register(b);
  windows.setFocused(1);
  const bridge = new IpcBridge({
    windows,
    isTrustedFrame: (frame) => windows.isTrustedFrame(frame),
    getWebContents: () => windows.focusedWebContents() as never,
  });
  return { bridge, windows, a, b };
}

describe('IpcBridge multi-window routing', () => {
  it('sends session events to the owning window only', () => {
    const { bridge, a, b } = makeBridge();
    bridge.assignSession(b.webContents as never, 'sess-1');

    bridge.sendToSession('sess-1', 'terminal:data', 'sess-1', 'hello');

    expect(b.send).toHaveBeenCalledWith('terminal:data', 'sess-1', 'hello');
    expect(a.send).not.toHaveBeenCalled();
  });

  it('only assigns sessions for senders that are registered windows', () => {
    const { bridge, windows } = makeBridge();
    bridge.assignSession({ id: 99 } as never, 'sess-x');
    bridge.assignSession(undefined, 'sess-y');
    expect(windows.ownerOf('sess-x')).toBeUndefined();
    expect(windows.ownerOf('sess-y')).toBeUndefined();
  });

  it('sends prompts and ownerless events to the focused window', () => {
    const { bridge, a, b } = makeBridge();
    bridge.sendToFocused('prompt');
    bridge.sendToSession(undefined, 'ownerless');
    expect(a.send).toHaveBeenCalledTimes(2);
    expect(b.send).not.toHaveBeenCalled();
  });

  it('broadcasts app-wide state to every window', () => {
    const { bridge, a, b } = makeBridge();
    bridge.broadcast('update:state', { s: 1 });
    expect(a.send).toHaveBeenCalledWith('update:state', { s: 1 });
    expect(b.send).toHaveBeenCalledWith('update:state', { s: 1 });
  });

  it('replies to the window that issued the request, even when it is not focused', () => {
    const { bridge, a, b } = makeBridge();
    bridge.sendToSender(b.webContents as never, 'search:result', { n: 1 });
    expect(b.send).toHaveBeenCalledWith('search:result', { n: 1 });
    expect(a.send).not.toHaveBeenCalled();
  });

  it('falls back to the focused window when the requesting window is gone', () => {
    const { bridge, a } = makeBridge();
    const gone = { isDestroyed: () => true, send: vi.fn() };
    bridge.sendToSender(gone as never, 'search:done');
    expect(gone.send).not.toHaveBeenCalled();
    expect(a.send).toHaveBeenCalledWith('search:done');
  });

  it('without a window router everything goes to the focused window', () => {
    const bridge = new IpcBridge({});
    const send = vi.fn();
    bridge.getWebContents = () => ({ isDestroyed: () => false, send }) as never;
    bridge.assignSession({ id: 1 } as never, 's');
    bridge.sendToSession('s', 'ch', 1);
    bridge.broadcast('ch2');
    expect(send).toHaveBeenCalledWith('ch', 1);
    expect(send).toHaveBeenCalledWith('ch2');
  });
});
