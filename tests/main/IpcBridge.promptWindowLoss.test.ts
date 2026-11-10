import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

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

function makeBridge() {
  const webContents = Object.assign(new EventEmitter(), {
    id: 1,
    send: vi.fn(),
    isDestroyed: () => false,
  });
  const bridge = new IpcBridge({ getWebContents: () => webContents as never });
  return { bridge, webContents };
}

const hostKeyInfo = { host: 'h', port: 22, fingerprint: 'SHA256:x', keyType: 'ssh-ed25519', status: 'unknown' } as never;

/** The id of the prompt that was just sent to the window. */
const sentId = (webContents: { send: ReturnType<typeof vi.fn> }): string => {
  const payload = webContents.send.mock.calls.at(-1)![1] as { id: string };
  return payload.id;
};

describe('prompts whose window goes away', () => {
  it.each(['render-process-gone', 'destroyed'])(
    'settles every pending prompt with its safe answer when the window reports "%s"',
    async (event) => {
      const { bridge, webContents } = makeBridge();

      const hostKey = bridge.promptHostKeyTrust(hostKeyInfo);
      const pin = bridge.promptForPinDirect('PIN:', 'smartcard');
      const conflict = bridge.promptTransferConflict({ fileName: 'a', targetPath: '/a' } as never);
      const quit = bridge.promptQuitConfirm({ kind: 'confirm-before-quit' } as never);
      const dotfiles = (bridge as unknown as { promptDotfilesSync: (i: never) => Promise<string> }).promptDotfilesSync({} as never);

      webContents.emit(event);

      await expect(hostKey).resolves.toBe(false); // fail closed
      await expect(pin).resolves.toBe('');
      await expect(conflict).resolves.toEqual({ resolution: 'skip', applyToAll: false });
      await expect(quit).resolves.toBe(true); // nobody left to ask: the app can quit
      await expect(dotfiles).resolves.toBe('ignore');
      expect(bridge.pendingHostKeyPrompts.size).toBe(0);
      expect(bridge.pendingAskpass.size).toBe(0);
      expect(bridge.pendingTransferConflicts.size).toBe(0);
      expect(bridge.pendingQuitConfirms.size).toBe(0);
      expect(bridge.pendingDotfilesSyncPrompts.size).toBe(0);
    }
  );

  it('answers at once, with the safe answer, when the window had already crashed before the prompt', async () => {
    const { bridge, webContents } = makeBridge();
    (webContents as unknown as { isCrashed: () => boolean }).isCrashed = () => true;

    await expect(bridge.promptHostKeyTrust(hostKeyInfo)).resolves.toBe(false);
    await expect(bridge.promptQuitConfirm({ kind: 'confirm-before-quit' } as never)).resolves.toBe(true);
    await expect(bridge.promptForPinDirect('PIN:', 'smartcard')).resolves.toBe('');
    expect(bridge.pendingHostKeyPrompts.size).toBe(0);
    expect(bridge.pendingQuitConfirms.size).toBe(0);
    // Nothing is sent to the dead window: a reloaded renderer would otherwise show a dialog nobody can answer.
    expect(webContents.send).not.toHaveBeenCalled();
  });

  it('keeps the user\'s answer, and stops watching the window once a prompt has been answered', async () => {
    const { bridge, webContents } = makeBridge();

    const quit = bridge.promptQuitConfirm({ kind: 'confirm-before-quit' } as never);
    const id = sentId(webContents);
    bridge.pendingQuitConfirms.get(id)!.callback(false); // the user chose not to quit

    await expect(quit).resolves.toBe(false);
    webContents.emit('render-process-gone'); // a crash later must not change that or throw
    expect(webContents.listenerCount('render-process-gone')).toBe(0);
    expect(webContents.listenerCount('destroyed')).toBe(0);
  });
});

describe('SSH askpass prompts whose window goes away', () => {
  function makeAskpassBridge(options: { webContents?: unknown; windows?: unknown } = {}) {
    const webContents = Object.assign(new EventEmitter(), { id: 1, send: vi.fn(), isDestroyed: () => false });
    const bridge = new IpcBridge({
      getWebContents: () => (options.webContents === undefined ? webContents : options.webContents) as never,
      windows: options.windows as never,
      syncConfigStore: { getConfig: vi.fn().mockResolvedValue({}) } as never,
      profileSyncService: { syncAgentBlockToLocalSshConfig: vi.fn().mockResolvedValue(undefined), autoSyncLocalSshConfig: vi.fn() } as never,
    });
    bridge.register();
    const callback = vi.fn();
    const ask = (sessionId = 's1', cb = callback) => bridge.sshPtyManager.emit('askpass', { sessionId, prompt: 'Passphrase:', callback: cb });
    return { bridge, webContents, callback, ask };
  }

  it('shows the prompt in the window and keeps it pending, remembering which session asked', () => {
    const { bridge, webContents, ask, callback } = makeAskpassBridge();

    ask();

    const [channel, payload] = webContents.send.mock.calls.at(-1)!;
    expect(channel).toBe(IPC_CHANNELS.ASKPASS_PROMPT);
    expect(payload).toMatchObject({ prompt: 'Passphrase:', sessionId: 's1' });
    expect(bridge.pendingAskpass.size).toBe(1);
    expect([...bridge.pendingAskpass.values()][0].sessionId).toBe('s1');
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(['render-process-gone', 'destroyed'])('answers with nothing (cancelling the login) when the window reports "%s"', (event) => {
    const { bridge, webContents, ask, callback } = makeAskpassBridge();
    ask();

    webContents.emit(event);

    expect(callback).toHaveBeenCalledExactlyOnceWith('');
    expect(bridge.pendingAskpass.size).toBe(0);
  });

  it('answers at once, and sends nothing, when the window had already crashed', () => {
    const { bridge, webContents, ask, callback } = makeAskpassBridge();
    (webContents as unknown as { isCrashed: () => boolean }).isCrashed = () => true;

    ask();

    expect(callback).toHaveBeenCalledExactlyOnceWith('');
    expect(webContents.send).not.toHaveBeenCalled();
    expect(bridge.pendingAskpass.size).toBe(0);
  });

  it('answers at once, and sends nothing, when the window has already been destroyed', () => {
    const { bridge, webContents, ask, callback } = makeAskpassBridge();
    (webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true;

    ask();

    expect(callback).toHaveBeenCalledExactlyOnceWith('');
    expect(webContents.send).not.toHaveBeenCalled();
    expect(bridge.pendingAskpass.size).toBe(0);
  });

  it('answers at once when there is no window to ask in', () => {
    const { bridge, ask, callback } = makeAskpassBridge({ webContents: null });

    ask();

    expect(callback).toHaveBeenCalledExactlyOnceWith('');
    expect(bridge.pendingAskpass.size).toBe(0);
  });

  it("passes the user's answer on, and stops watching the window once it has been given", () => {
    const { bridge, webContents, ask, callback } = makeAskpassBridge();
    ask();
    const id = [...bridge.pendingAskpass.keys()][0];

    bridge.pendingAskpass.get(id)!.callback('hunter2');
    webContents.emit('render-process-gone'); // a crash afterwards must not answer a second time

    expect(callback).toHaveBeenCalledExactlyOnceWith('hunter2');
    expect(webContents.listenerCount('render-process-gone')).toBe(0);
    expect(webContents.listenerCount('destroyed')).toBe(0);
  });

  it("cancels only that session's prompts when its SSH session ends, and stops watching for them", () => {
    const { bridge, webContents, ask } = makeAskpassBridge();
    const first = vi.fn();
    const other = vi.fn();
    ask('s1', first);
    ask('s2', other);

    bridge.sshPtyManager.emit('exit', { sessionId: 's1', exitCode: 0 });

    expect(first).toHaveBeenCalledExactlyOnceWith('');
    expect(other).not.toHaveBeenCalled();
    expect(bridge.pendingAskpass.size).toBe(1);
    expect(webContents.listenerCount('destroyed')).toBe(1); // only s2's prompt is still watching
  });

  it('is settled by dispose() too, without leaving a watcher on the window', async () => {
    const { bridge, webContents, ask, callback } = makeAskpassBridge();
    ask();

    await bridge.dispose();

    expect(callback).toHaveBeenCalledExactlyOnceWith('');
    expect(webContents.listenerCount('destroyed')).toBe(0);
    expect(webContents.listenerCount('render-process-gone')).toBe(0);
  });

  describe('with several windows', () => {
    function twoWindows() {
      const owner = Object.assign(new EventEmitter(), { id: 2, send: vi.fn(), isDestroyed: () => false });
      const focused = Object.assign(new EventEmitter(), { id: 1, send: vi.fn(), isDestroyed: () => false });
      const windows = {
        sendToSession: vi.fn(),
        broadcast: vi.fn(),
        broadcastExcept: vi.fn(),
        assign: vi.fn(),
        windowIdOfSender: vi.fn(),
        keyOfSender: vi.fn(),
        webContentsOfSession: vi.fn((sessionId: string) => (sessionId === 's-owned' ? owner : focused)),
      };
      return { owner, focused, windows };
    }

    it("asks in the session's own window and watches that window, not the focused one", () => {
      const { owner, focused, windows } = twoWindows();
      const { ask, callback, bridge } = makeAskpassBridge({ webContents: focused, windows });

      ask('s-owned');

      expect(owner.send).toHaveBeenCalledWith(IPC_CHANNELS.ASKPASS_PROMPT, expect.objectContaining({ sessionId: 's-owned' }));
      expect(focused.send).not.toHaveBeenCalled();

      focused.emit('render-process-gone'); // another window crashing does not cancel this login
      expect(callback).not.toHaveBeenCalled();
      expect(bridge.pendingAskpass.size).toBe(1);

      owner.emit('render-process-gone');
      expect(callback).toHaveBeenCalledExactlyOnceWith('');
    });
  });
});
