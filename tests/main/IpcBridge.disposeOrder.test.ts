import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';
import { XServerManager } from '../../src/main/x11/XServerManager';
import { captureLogs } from './helpers/captureLogs';

// IpcBridge.dispose() is order-sensitive in ways the code only documents in comments. These tests pin
// those documented invariants as pairwise "A before B" facts (not the whole sequence, so unrelated
// steps can still be reordered), through public methods and injected fakes only.

/** Shared, ordered record of everything dispose() does to the fakes below. */
let calls: string[];
const log = (entry: string): void => {
  calls.push(entry);
};
const at = (entry: string): number => {
  const i = calls.indexOf(entry);
  if (i === -1) throw new Error(`"${entry}" never happened. Recorded: ${calls.join(', ')}`);
  return i;
};
const before = (a: string, b: string) => expect(at(a), `${a} must happen before ${b}`).toBeLessThan(at(b));

/** An EventEmitter that records every off() and the awaited stop call, in the shared order log. */
class RecordingEmitter extends EventEmitter {
  constructor(private readonly name: string) {
    super();
  }
  override off(event: string | symbol, listener: (...args: any[]) => void): this {
    log(`off:${this.name}:${String(event)}`);
    return super.off(event, listener);
  }
  /** An awaited stop that takes a macrotask, so "dispose() waited for it" is observable. */
  async stop(label: string): Promise<void> {
    log(`${this.name}.${label}`);
    await new Promise((r) => setImmediate(r));
    log(`${this.name}.${label}:done`);
  }
}

function makeBridge(overrides: { k8sTerminalKillAll?: () => Promise<void> } = {}) {
  const ipcMain = {
    handle: vi.fn(),
    removeHandler: vi.fn((channel: string) => log(`removeHandler:${channel}`)),
  };
  const pty = Object.assign(new RecordingEmitter('pty'), { killAll: () => pty.stop('killAll') });
  const transfer = Object.assign(new RecordingEmitter('transfer'), {
    cancelAll: () => log('transfer.cancelAll'),
    hasActiveTransfers: () => false,
    getActiveTransferCount: () => 0,
  });
  const k8sTerminalEmitter = new RecordingEmitter('k8sTerminal');
  const k8sTerminal = Object.assign(k8sTerminalEmitter, {
    killAll: overrides.k8sTerminalKillAll ?? (() => k8sTerminalEmitter.stop('killAll')),
  });
  const k8sLog = Object.assign(new RecordingEmitter('k8sLog'), { stopAll: () => k8sLog.stop('stopAll') });
  const k8sPortForward = Object.assign(new RecordingEmitter('k8sPortForward'), {
    stopAll: () => k8sPortForward.stop('stopAll'),
    setDiscoveryService: vi.fn(), // IpcBridge's constructor wires the discovery service into it
  });
  const sshTunnel = Object.assign(new RecordingEmitter('sshTunnel'), { stopAll: () => sshTunnel.stop('stopAll'), listActive: () => [] });

  const bridge = new IpcBridge({
    ipcMain: ipcMain as any,
    sshPtyManager: pty as any,
    transferQueue: transfer as any,
    k8sTerminalManager: k8sTerminal as any,
    k8sLogManager: k8sLog as any,
    k8sPortForwardManager: k8sPortForward as any,
    sshTunnelManager: sshTunnel as any,
    k8sDiscoveryService: {
      onConfigChanged: () => () => log('k8sConfig.unsubscribe'),
      consumePendingExecAuthWarning: () => undefined,
    } as any,
    settingsStore: { getSettings: vi.fn().mockResolvedValue({ clipboardHistoryClearOnExit: true }) } as any,
    clipboardHistoryStore: { clear: vi.fn(async () => log('clipboard.clear')) } as any,
    storageRegistry: { disconnectAll: vi.fn(async () => log('storage.disconnectAll')), disconnect: vi.fn() } as any,
    fileEditorService: { dispose: vi.fn(async () => log('fileEditor.dispose')) } as any,
    profileSyncService: { syncAgentBlockToLocalSshConfig: vi.fn().mockResolvedValue(undefined), autoSyncLocalSshConfig: vi.fn() } as any,
  });
  vi.spyOn(bridge.smartcard, 'dispose').mockImplementation(async () => log('smartcard.dispose'));
  vi.spyOn(bridge.sshCaService, 'logout').mockImplementation(async () => log('sshCa.logout'));
  bridge.register();
  return { bridge };
}

describe('IpcBridge.dispose() ordering invariants', () => {
  beforeEach(() => {
    calls = [];
    vi.spyOn(AgentLifecycleManager, 'killAllPrivateAgents').mockImplementation(() => log('agents.killAllPrivate'));
    vi.spyOn(AgentLifecycleManager, 'stopManagedAgent').mockImplementation(async () => log('agents.stopManaged'));
    vi.spyOn(XServerManager, 'stopServer').mockImplementation(async () => {
      log('xserver.stop');
      return { success: true };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes every IPC handler before it empties the clipboard history, so no late selection can be added behind the clear', async () => {
    const { bridge } = makeBridge();
    await bridge.dispose();

    const removed = calls.filter((c) => c.startsWith('removeHandler:'));
    expect(removed.length).toBeGreaterThan(50); // sanity: register() really installed the handler groups
    const lastRemoval = Math.max(...removed.map((c) => calls.indexOf(c)));
    expect(lastRemoval).toBeLessThan(at('clipboard.clear'));
  });

  it('detaches the PTY listeners before killing the sessions, so the exit handler never runs for them', async () => {
    const { bridge } = makeBridge();
    await bridge.dispose();

    for (const event of ['data', 'exit', 'askpass', 'presence', 'reconnecting', 'hostkey-changed']) {
      before(`off:pty:${event}`, 'pty.killAll');
    }
  });

  it("detaches each manager's listeners before stopping that manager", async () => {
    const { bridge } = makeBridge();
    await bridge.dispose();

    before('off:transfer:progress', 'transfer.cancelAll');
    before('off:k8sTerminal:data', 'k8sTerminal.killAll');
    before('off:k8sTerminal:exit', 'k8sTerminal.killAll');
    before('off:k8sLog:data', 'k8sLog.stopAll');
    before('off:k8sLog:end', 'k8sLog.stopAll');
    before('off:k8sPortForward:change', 'k8sPortForward.stopAll');
    before('off:sshTunnel:change', 'sshTunnel.stopAll');
  });

  it('ends the SSH CA session before the smartcard agents are shut down', async () => {
    const { bridge } = makeBridge();
    await bridge.dispose();
    before('sshCa.logout', 'smartcard.dispose');
  });

  it('shuts down smartcard state, then private agents, then the managed agent, and stops the X server last', async () => {
    const { bridge } = makeBridge();
    await bridge.dispose();

    before('smartcard.dispose', 'agents.killAllPrivate');
    before('agents.killAllPrivate', 'agents.stopManaged');
    before('agents.stopManaged', 'xserver.stop');
    expect(calls[calls.length - 1]).toBe('xserver.stop');
  });

  it('waits for the awaited stop steps (including every SSH tunnel process) before dispose() resolves', async () => {
    const { bridge } = makeBridge();
    await bridge.dispose();

    for (const done of ['pty.killAll:done', 'k8sTerminal.killAll:done', 'k8sLog.stopAll:done', 'k8sPortForward.stopAll:done', 'sshTunnel.stopAll:done']) {
      expect(calls, `${done} must have finished before dispose() resolved`).toContain(done);
    }
  });

  it('does not let one hanging manager block the rest of the shutdown (a step gets 5 s, then dispose moves on)', async () => {
    vi.useFakeTimers();
    const warn = captureLogs();
    try {
      const { bridge } = makeBridge({ k8sTerminalKillAll: () => new Promise<void>(() => {}) });
      const disposed = bridge.dispose();

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await disposed;

      expect(warn.text()).toContain('k8sTerminalManager.killAll did not finish');
      before('off:k8sTerminal:exit', 'sshTunnel.stopAll'); // ran after the hang
      expect(calls).toContain('sshTunnel.stopAll:done');
      expect(calls).toContain('sshCa.logout');
      expect(calls).toContain('smartcard.dispose');
      expect(calls[calls.length - 1]).toBe('xserver.stop');
    } finally {
      warn.restore();
      vi.useRealTimers();
    }
  });
});
