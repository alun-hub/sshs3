import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => {
  const mockObj = { app: { getPath: vi.fn().mockReturnValue('/tmp/user-data') } };
  return { ...mockObj, default: mockObj };
});

import * as SmartcardCertificateReader from '../../src/main/smartcard/SmartcardCertificateReader';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';
import { AppAgent } from '../../src/main/ssh/AppAgent';
import { SmartcardCoordinator, type SmartcardDeps } from '../../src/main/smartcard/SmartcardCoordinator';

const LIB = '/usr/lib/opensc-pkcs11.so';

function makeDeps(calls: string[] = []): SmartcardDeps {
  return {
    settingsStore: { getSettings: vi.fn().mockResolvedValue({ smartcardAuthMode: 'agent-global' }) } as any,
    profileStore: { getProfiles: vi.fn().mockResolvedValue({ ssh: [], s3: [] }) } as any,
    sessionStore: {} as any,
    syncConfigStore: { getConfig: vi.fn().mockResolvedValue({}) } as any,
    sshPtyManager: {} as any,
    getWebContents: () => null,
    promptForPin: vi.fn().mockResolvedValue('123456'),
    makePresenceNotifier: vi.fn().mockReturnValue({ onPresenceRequested: vi.fn(), onPresenceCleared: vi.fn() }),
    clearPresence: vi.fn((id: string) => void calls.push(`clearPresence:${id}`)),
    syncAgentBlock: vi.fn(async (entries: unknown) => void calls.push(`syncAgentBlock:${entries === null ? 'null' : 'entries'}`)),
  };
}

function makeFakeAgent(calls: string[] = []) {
  return {
    setHandlers: vi.fn(),
    setOnExit: vi.fn(),
    ensure: vi.fn().mockResolvedValue('/run/sshs3/agent.sock'),
    getSocketPath: vi.fn().mockReturnValue('/run/sshs3/agent.sock'),
    list: vi.fn().mockResolvedValue([]),
    addPkcs11: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removeIdentities: vi.fn().mockResolvedValue(0),
    shutdown: vi.fn(async () => void calls.push('appAgent.shutdown')),
  };
}

function build(calls: string[] = []) {
  const deps = makeDeps(calls);
  const coordinator = new SmartcardCoordinator(deps);
  const agent = makeFakeAgent(calls);
  // White-box: the app agent is private state; swap it for a fake after construction.
  (coordinator as any).appAgent = agent;
  return { coordinator, deps, agent };
}

describe('SmartcardCoordinator', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(SmartcardCertificateReader, 'readSmartcardCertificates').mockResolvedValue(new Map());
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads a card into the app agent once and records it as unlocked', async () => {
    const { coordinator, agent } = build();

    const socket = await coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => '123456');

    expect(socket).toBe('/run/sshs3/agent.sock');
    expect(agent.addPkcs11).toHaveBeenCalledTimes(1);
    await expect(coordinator.getUnlockedCardSocket(LIB)).resolves.toBe('/run/sshs3/agent.sock');
    expect(coordinator.appAgentSocketIfUnlocked()).toBe('/run/sshs3/agent.sock');
    expect(coordinator.unlockedPivSocket()).toBe('/run/sshs3/agent.sock');
  });

  it('shares one in-flight load between concurrent connections to the same card', async () => {
    const { coordinator, agent } = build();
    let release!: () => void;
    agent.addPkcs11.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));

    const first = coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => 'pin');
    const second = coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => 'pin');
    await vi.waitFor(() => expect(agent.addPkcs11).toHaveBeenCalledTimes(1));
    release();

    await expect(Promise.all([first, second])).resolves.toEqual(['/run/sshs3/agent.sock', '/run/sshs3/agent.sock']);
    expect(agent.addPkcs11).toHaveBeenCalledTimes(1);
  });

  it('cools down for 30 s after a failed load instead of prompting for the PIN again', async () => {
    const { coordinator, agent } = build();
    agent.addPkcs11.mockRejectedValueOnce(new Error('wrong PIN'));

    await expect(coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => 'bad')).rejects.toThrow('wrong PIN');
    expect(coordinator.isInLoadCooldown(LIB)).toBe(true);
    await expect(coordinator.getUnlockedCardSocket(LIB)).resolves.toBeUndefined();

    await expect(coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => 'again')).rejects.toThrow(/cooling down/);
    expect(agent.addPkcs11).toHaveBeenCalledTimes(1);
  });

  it('forgets a card after a failed use, but not when a private agent was involved', async () => {
    const { coordinator, agent, deps } = build();
    await coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => '123456');
    (coordinator as any).globalSmartcardCerts.set(LIB, new Map());

    coordinator.forgetGlobalCardAfterFailure(LIB, 4242);
    await expect(coordinator.getUnlockedCardSocket(LIB)).resolves.toBe('/run/sshs3/agent.sock');

    coordinator.forgetGlobalCardAfterFailure(LIB, undefined);
    await expect(coordinator.getUnlockedCardSocket(LIB)).resolves.toBeUndefined();
    expect((coordinator as any).globalSmartcardCerts.has(LIB)).toBe(false);
    expect(agent.remove).toHaveBeenCalledWith(LIB);
    await (coordinator as any).agentConfigRefresh;
    expect(deps.syncAgentBlock).toHaveBeenCalled();
  });

  describe('awaitStartupUnlock', () => {
    it('returns at once when no startup unlock is running', async () => {
      const { coordinator } = build();
      await expect(coordinator.awaitStartupUnlock()).resolves.toBeUndefined();
    });

    it('waits for a running startup unlock and ignores its failure', async () => {
      const { coordinator } = build();
      let done = false;
      (coordinator as any).startupUnlockPromise = new Promise<void>((_, reject) =>
        setTimeout(() => {
          done = true;
          reject(new Error('card not present'));
        }, 5)
      );

      await expect(coordinator.awaitStartupUnlock()).resolves.toBeUndefined();
      expect(done).toBe(true);
    });
  });

  describe('dispose', () => {
    it('ends session agents, forgets the cards, removes the agent block and only then shuts the app agent down', async () => {
      const calls: string[] = [];
      const { coordinator, agent } = build(calls);
      const unload = vi.spyOn(AgentLifecycleManager, 'unloadCard').mockResolvedValue(undefined as any);
      const kill = vi.spyOn(AgentLifecycleManager, 'killPrivateAgent').mockImplementation(() => {
        calls.push('killPrivateAgent');
      });
      (coordinator as any).smartcardSessionAgents.set('sess-1', {
        pid: 99,
        socketPath: '/tmp/agent-sess-1.sock',
        kind: 'pkcs11',
        pkcs11LibPath: LIB,
      });
      await coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => '123456');
      calls.length = 0;

      await coordinator.dispose();

      expect(unload).toHaveBeenCalledWith('/tmp/agent-sess-1.sock', LIB);
      expect(kill).toHaveBeenCalledWith(99);
      expect(coordinator.listSessionAgents()).toEqual([]);
      await expect(coordinator.getUnlockedCardSocket(LIB)).resolves.toBeUndefined();
      expect(agent.shutdown).toHaveBeenCalledTimes(1);
      expect(calls.indexOf('syncAgentBlock:null')).toBeGreaterThan(calls.indexOf('killPrivateAgent'));
      expect(calls.indexOf('appAgent.shutdown')).toBeGreaterThan(calls.indexOf('syncAgentBlock:null'));
    });
  });

  describe('dispose waits for card eviction', () => {
    it('does not shut the app agent down before a pending unloadCard has finished', async () => {
      const calls: string[] = [];
      const { coordinator } = build(calls);
      let finishUnload!: () => void;
      vi.spyOn(AgentLifecycleManager, 'unloadCard').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishUnload = () => {
              calls.push('unloadCard:done');
              resolve();
            };
          })
      );
      vi.spyOn(AgentLifecycleManager, 'killPrivateAgent').mockImplementation(() => {});
      (coordinator as any).smartcardSessionAgents.set('sess-1', {
        pid: 0,
        socketPath: '\\\\.\\pipe\\openssh-ssh-agent',
        kind: 'pkcs11',
        pkcs11LibPath: LIB,
      });

      let disposed = false;
      const pending = coordinator.dispose().then(() => {
        disposed = true;
      });
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(false);
      expect(calls).not.toContain('appAgent.shutdown');

      finishUnload();
      await pending;
      expect(calls.indexOf('appAgent.shutdown')).toBeGreaterThan(calls.indexOf('unloadCard:done'));
    });
  });

  it('lists the session agents without exposing the entries', () => {
    const { coordinator } = build();
    (coordinator as any).smartcardSessionAgents.set('a', { pid: 1, socketPath: '/tmp/a.sock', kind: 'fido2' });
    expect(coordinator.listSessionAgents()).toEqual([{ kind: 'fido2', socketPath: '/tmp/a.sock' }]);
  });

  describe('constructor wiring of the app agent', () => {
    it('routes the agent\'s own PIN prompts to the renderer with the "App ssh-agent" context', async () => {
      const setHandlers = vi.spyOn(AppAgent.prototype, 'setHandlers').mockImplementation(() => {});
      vi.spyOn(AppAgent.prototype, 'setOnExit').mockImplementation(() => {});
      const deps = makeDeps();
      new SmartcardCoordinator(deps);

      const handlers = setHandlers.mock.calls[0][0] as any;
      await handlers.promptHandler('Enter PIN for authenticator ED25519-SK  ', undefined);

      expect(deps.promptForPin).toHaveBeenCalledWith('Enter PIN for authenticator ED25519-SK', 'fido2', 'App ssh-agent', undefined);
    });

    it('shows and auto-clears a touch banner when the agent asks for presence', () => {
      vi.useFakeTimers();
      const setHandlers = vi.spyOn(AppAgent.prototype, 'setHandlers').mockImplementation(() => {});
      vi.spyOn(AppAgent.prototype, 'setOnExit').mockImplementation(() => {});
      const requested = vi.fn();
      const cleared = vi.fn();
      const deps = makeDeps();
      (deps.makePresenceNotifier as any).mockReturnValue({ onPresenceRequested: requested, onPresenceCleared: cleared });
      new SmartcardCoordinator(deps);

      (setHandlers.mock.calls[0][0] as any).onPresence();
      expect(requested).toHaveBeenCalledTimes(1);
      expect(cleared).not.toHaveBeenCalled();
      vi.advanceTimersByTime(20_000);
      expect(cleared).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('forgets all cards and refreshes the ssh config block when the agent exits', async () => {
      vi.spyOn(AppAgent.prototype, 'setHandlers').mockImplementation(() => {});
      const setOnExit = vi.spyOn(AppAgent.prototype, 'setOnExit').mockImplementation(() => {});
      const calls: string[] = [];
      const deps = makeDeps(calls);
      const coordinator = new SmartcardCoordinator(deps);
      (coordinator as any).globalCards.set(LIB, { fingerprints: new Set() });
      (coordinator as any).globalSmartcardCerts.set(LIB, new Map());

      (setOnExit.mock.calls[0][0] as () => void)();
      await (coordinator as any).agentConfigRefresh;

      expect((coordinator as any).globalCards.size).toBe(0);
      expect((coordinator as any).globalSmartcardCerts.size).toBe(0);
      expect(deps.syncAgentBlock).toHaveBeenCalled();
    });
  });

  describe('getUnlockedCardSocket', () => {
    it('answers undefined, without starting the agent, for a card that is not unlocked', async () => {
      const { coordinator, agent } = build();
      await expect(coordinator.getUnlockedCardSocket(LIB)).resolves.toBeUndefined();
      expect(agent.ensure).not.toHaveBeenCalled();
    });

    it('re-checks after ensure(): an agent that had to be restarted lost its cards', async () => {
      const { coordinator, agent } = build();
      await coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => '123456');
      // ensure() restarting a dead agent triggers onExit, which clears the card state.
      agent.ensure.mockImplementationOnce(async () => {
        (coordinator as any).globalCards.clear();
        return '/run/sshs3/new-agent.sock';
      });

      await expect(coordinator.getUnlockedCardSocket(LIB)).resolves.toBeUndefined();
    });
  });

  describe('load cooldown', () => {
    it('ends after 30 seconds', async () => {
      const { coordinator, agent } = build();
      agent.addPkcs11.mockRejectedValueOnce(new Error('wrong PIN'));
      await expect(coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => 'bad')).rejects.toThrow('wrong PIN');
      expect(coordinator.isInLoadCooldown(LIB)).toBe(true);

      const realNow = Date.now;
      vi.spyOn(Date, 'now').mockReturnValue(realNow() + 31_000);
      expect(coordinator.isInLoadCooldown(LIB)).toBe(false);
      await expect(coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => 'good')).resolves.toBe('/run/sshs3/agent.sock');
    });

    it('is tracked separately for the FIDO2 key and for each card', () => {
      const { coordinator } = build();
      expect(coordinator.isInLoadCooldown(LIB)).toBe(false);
      (coordinator as any).globalSmartcardAgentFailures.set('__fido2__', Date.now());
      expect(coordinator.isInLoadCooldown('__fido2__')).toBe(true);
      expect(coordinator.isInLoadCooldown(LIB)).toBe(false);
    });
  });

  describe('after dispose', () => {
    it('does not respawn the app agent for a prompt that resolves during quit, and writes no agent block', async () => {
      const { coordinator, agent, deps } = build();
      let release!: () => void;
      agent.addPkcs11.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
      const pending = coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => '123456');
      await vi.waitFor(() => expect(agent.addPkcs11).toHaveBeenCalledTimes(1));

      await coordinator.dispose();
      agent.ensure.mockClear();
      (deps.syncAgentBlock as any).mockClear();
      release();

      await expect(pending).rejects.toThrow(/disposed/);
      expect(agent.ensure).not.toHaveBeenCalled();
      coordinator.refreshAgentSshConfig();
      await (coordinator as any).agentConfigRefresh;
      expect(deps.syncAgentBlock).not.toHaveBeenCalled();
    });
  });
});
