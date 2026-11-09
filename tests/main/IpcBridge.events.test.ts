import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => {
  const mockObj = {
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    app: { getPath: vi.fn().mockReturnValue('/tmp/user-data-unused'), getVersion: vi.fn().mockReturnValue('1.2.3'), isPackaged: false },
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

// Characterization: how IpcBridge forwards manager events to the renderer, which window gets what, and
// how it exposes the update service and the multi-window helpers. Public methods and injected fakes only.

interface Sent {
  channel: string;
  args: unknown[];
}

function makeWebContents(id = 1) {
  const sent: Sent[] = [];
  const webContents = { id, isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => void sent.push({ channel, args }) };
  return { webContents, sent };
}

function makeBridge(extra: Record<string, unknown> = {}) {
  const pty = Object.assign(new EventEmitter(), { killAll: vi.fn().mockResolvedValue(undefined) });
  const transfer = Object.assign(new EventEmitter(), { cancelAll: vi.fn(), hasActiveTransfers: () => false, getActiveTransferCount: () => 0 });
  const k8sTerminal = Object.assign(new EventEmitter(), { killAll: vi.fn().mockResolvedValue(undefined) });
  const k8sLog = Object.assign(new EventEmitter(), { stopAll: vi.fn().mockResolvedValue(undefined) });
  const k8sPortForward = Object.assign(new EventEmitter(), { stopAll: vi.fn().mockResolvedValue(undefined), setDiscoveryService: vi.fn() });
  const sshTunnel = Object.assign(new EventEmitter(), { stopAll: vi.fn().mockResolvedValue(undefined), listActive: () => [] });
  let configChanged: (() => void) | undefined;
  const k8sDiscovery = {
    onConfigChanged: (cb: () => void) => {
      configChanged = cb;
      return () => {};
    },
    consumePendingExecAuthWarning: vi.fn().mockReturnValue(undefined),
  };
  const { webContents, sent } = makeWebContents();
  const bridge = new IpcBridge({
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } as any,
    sshPtyManager: pty as any,
    transferQueue: transfer as any,
    k8sTerminalManager: k8sTerminal as any,
    k8sLogManager: k8sLog as any,
    k8sPortForwardManager: k8sPortForward as any,
    sshTunnelManager: sshTunnel as any,
    k8sDiscoveryService: k8sDiscovery as any,
    syncConfigStore: { getConfig: vi.fn().mockResolvedValue({}) } as any,
    profileSyncService: { syncAgentBlockToLocalSshConfig: vi.fn().mockResolvedValue(undefined), autoSyncLocalSshConfig: vi.fn() } as any,
    getWebContents: () => webContents as any,
    ...extra,
  });
  bridge.register();
  return { bridge, sent, webContents, pty, transfer, k8sTerminal, k8sLog, k8sPortForward, sshTunnel, k8sDiscovery, fireConfigChanged: () => configChanged?.() };
}

describe('IpcBridge event forwarding', () => {
  let bridges: IpcBridge[];
  const track = <T extends { bridge: IpcBridge }>(h: T): T => {
    bridges.push(h.bridge);
    return h;
  };
  beforeEach(() => {
    bridges = [];
  });
  afterEach(async () => {
    for (const b of bridges) await b.dispose();
  });

  it('forwards Kubernetes terminal output to the focused window and keeps it as scrollback', () => {
    const { sent, k8sTerminal, bridge } = track(makeBridge());

    k8sTerminal.emit('data', { sessionId: 's1', data: 'hello ' });
    k8sTerminal.emit('data', { sessionId: 's1', data: 'world' });

    expect(sent).toEqual([
      { channel: IPC_CHANNELS.K8S_TERMINAL_DATA, args: ['s1', 'hello '] },
      { channel: IPC_CHANNELS.K8S_TERMINAL_DATA, args: ['s1', 'world'] },
    ]);
    expect(bridge.scrollback.get('s1')).toBe('hello world');
  });

  it('reports a Kubernetes terminal exit with its status and drops that session\'s scrollback', () => {
    const { sent, k8sTerminal, bridge } = track(makeBridge());
    k8sTerminal.emit('data', { sessionId: 's1', data: 'x' });

    k8sTerminal.emit('exit', { sessionId: 's1', status: 'Succeeded' });

    expect(sent.at(-1)).toEqual({ channel: IPC_CHANNELS.K8S_TERMINAL_EXIT, args: ['s1', { status: 'Succeeded' }] });
    expect(bridge.scrollback.get('s1')).toBe('');
  });

  it('forwards Kubernetes log data and end-of-stream', () => {
    const { sent, k8sLog } = track(makeBridge());

    k8sLog.emit('data', { sessionId: 'l1', data: 'line' });
    k8sLog.emit('end', { sessionId: 'l1' });

    expect(sent).toEqual([
      { channel: IPC_CHANNELS.K8S_LOG_DATA, args: ['l1', 'line'] },
      { channel: IPC_CHANNELS.K8S_LOG_END, args: ['l1'] },
    ]);
  });

  it('broadcasts port-forward and SSH tunnel changes, and transfer progress', () => {
    const { sent, k8sPortForward, sshTunnel, transfer } = track(makeBridge());
    const forwards = [{ id: 'pf' }];
    const tunnels = [{ id: 'tn' }];
    const progress = { jobId: 'j1', percentage: 10 };

    k8sPortForward.emit('change', forwards);
    sshTunnel.emit('change', tunnels);
    transfer.emit('progress', progress);

    expect(sent).toEqual([
      { channel: IPC_CHANNELS.K8S_PORT_FORWARD_EVENT, args: [forwards] },
      { channel: IPC_CHANNELS.SSH_TUNNEL_EVENT, args: [tunnels] },
      { channel: IPC_CHANNELS.TRANSFER_PROGRESS, args: [progress] },
    ]);
  });

  it('tells the renderer when an SSH session is reconnecting', () => {
    const { sent, pty } = track(makeBridge());

    pty.emit('reconnecting', { sessionId: 's1', attempt: 2, maxAttempts: 5 });

    expect(sent).toEqual([{ channel: IPC_CHANNELS.TERMINAL_RECONNECTING, args: ['s1', { attempt: 2, maxAttempts: 5 }] }]);
  });

  describe('Kubernetes config change', () => {
    it('without a window router: notifies the focused window and passes along a pending exec-auth warning', () => {
      const { sent, k8sDiscovery, fireConfigChanged } = track(makeBridge());
      k8sDiscovery.consumePendingExecAuthWarning.mockReturnValue({ user: 'eks-user' });

      fireConfigChanged();

      expect(sent).toEqual([{ channel: IPC_CHANNELS.K8S_CONFIG_CHANGED, args: [{ user: 'eks-user' }] }]);
    });

    it('with a window router: every other window just reloads, only the focused one gets the warning', () => {
      const broadcastExcept = vi.fn();
      const windows = {
        sendToSession: vi.fn(),
        broadcast: vi.fn(),
        broadcastExcept,
        assign: vi.fn(),
        windowIdOfSender: vi.fn(),
        keyOfSender: vi.fn(),
      };
      const { sent, k8sDiscovery, fireConfigChanged } = track(makeBridge({ windows }));
      k8sDiscovery.consumePendingExecAuthWarning.mockReturnValue({ user: 'eks-user' });

      fireConfigChanged();

      expect(broadcastExcept).toHaveBeenCalledWith(1, IPC_CHANNELS.K8S_CONFIG_CHANGED);
      expect(sent).toEqual([{ channel: IPC_CHANNELS.K8S_CONFIG_CHANGED, args: [{ user: 'eks-user' }] }]);
    });
  });

  it('stops forwarding manager events after dispose(): those listeners are gone', async () => {
    const { sent, bridge, k8sTerminal, k8sLog, k8sPortForward, sshTunnel, transfer } = makeBridge();

    await bridge.dispose();
    sent.length = 0; // dispose() itself announces e.g. the SSH CA session ending
    k8sTerminal.emit('data', { sessionId: 's1', data: 'x' });
    k8sLog.emit('data', { sessionId: 's1', data: 'x' });
    k8sPortForward.emit('change', []);
    sshTunnel.emit('change', []);
    transfer.emit('progress', {});

    expect(sent).toEqual([]);
    for (const emitter of [k8sTerminal, k8sLog, k8sPortForward, sshTunnel, transfer]) {
      expect(emitter.eventNames(), 'listeners left behind after dispose()').toEqual([]);
    }
  });

  it('detaches the PTY data/exit/askpass/presence listeners on dispose()', async () => {
    const { bridge, pty } = makeBridge();
    await bridge.dispose();
    for (const event of ['data', 'exit', 'askpass', 'presence']) {
      expect(pty.listenerCount(event), `pty "${event}" listeners left behind`).toBe(0);
    }
  });

  // Regression: 'reconnecting' and 'hostkey-changed' used to be anonymous listeners that dispose() never detached,
  // so the PTY manager kept calling into a disposed bridge.
  it('detaches ALL PTY listeners on dispose(), including "reconnecting" and "hostkey-changed"', async () => {
    const { bridge, pty } = makeBridge();
    await bridge.dispose();
    expect(pty.eventNames()).toEqual([]);
  });
});

describe('IpcBridge window helpers', () => {
  it('sends to whichever window the getter returns now, after setWebContentsGetter()', () => {
    const first = makeWebContents(1);
    const second = makeWebContents(2);
    const bridge = new IpcBridge({ getWebContents: () => first.webContents as any });

    bridge.setWebContentsGetter(() => second.webContents as any);
    expect(bridge.sendToFocused('ch', 'x')).toBe(true);

    expect(first.sent).toEqual([]);
    expect(second.sent).toEqual([{ channel: 'ch', args: ['x'] }]);
  });

  it('reports false (and sends nothing) when there is no window', () => {
    const bridge = new IpcBridge({ getWebContents: () => null });
    expect(bridge.sendToFocused('ch')).toBe(false);
  });

  it('opens a new window through the window actions, and is a no-op without them', () => {
    const open = vi.fn();
    const withActions = new IpcBridge({ windowActions: { open, adopt: vi.fn(), takeHandoff: vi.fn(), list: vi.fn() } });
    withActions.openWindow();
    expect(open).toHaveBeenCalledWith();

    expect(() => new IpcBridge({}).openWindow()).not.toThrow();
  });

  it("lists the windows as seen from the calling window, and an empty list without window actions", () => {
    const list = vi.fn().mockReturnValue([{ id: 1, title: 'Main' }]);
    const windows = { sendToSession: vi.fn(), broadcast: vi.fn(), broadcastExcept: vi.fn(), assign: vi.fn(), windowIdOfSender: vi.fn().mockReturnValue(7), keyOfSender: vi.fn() };
    const bridge = new IpcBridge({ windows, windowActions: { open: vi.fn(), adopt: vi.fn(), takeHandoff: vi.fn(), list } });
    const sender = { id: 7 } as any;

    expect(bridge.listWindows(sender)).toEqual([{ id: 1, title: 'Main' }]);
    expect(list).toHaveBeenCalledWith(7);

    expect(new IpcBridge({}).listWindows(sender)).toEqual([]);
  });
});

describe('IpcBridge update service', () => {
  const savedEnv = process.env.SSHS3_DISABLE_UPDATES;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SSHS3_DISABLE_UPDATES;
    else process.env.SSHS3_DISABLE_UPDATES = savedEnv;
    vi.restoreAllMocks();
  });

  it('creates the update service once and hands out the same instance', () => {
    const bridge = new IpcBridge({});
    expect(bridge.getUpdateService()).toBe(bridge.getUpdateService());
  });

  it('turns the service off when the administrator switch (SSHS3_DISABLE_UPDATES=1) is set', () => {
    process.env.SSHS3_DISABLE_UPDATES = '1';
    const state = new IpcBridge({}).getUpdateService().getState();
    expect(state).toMatchObject({ status: 'unsupported', unsupportedReason: 'disabled' });
  });

  it('starts the periodic update poll through startUpdateChecks(), and stops it on dispose()', async () => {
    const bridge = new IpcBridge({
      syncConfigStore: { getConfig: vi.fn().mockResolvedValue({}) } as any,
      profileSyncService: { syncAgentBlockToLocalSshConfig: vi.fn().mockResolvedValue(undefined) } as any,
    });
    const service = bridge.getUpdateService();
    const start = vi.spyOn(service, 'start').mockImplementation(() => {});
    const dispose = vi.spyOn(service, 'dispose');

    bridge.startUpdateChecks();
    expect(start).toHaveBeenCalledTimes(1);

    await bridge.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
