import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => {
  const mockObj = { app: { getPath: vi.fn().mockReturnValue('/tmp/user-data') } };
  return { ...mockObj, default: mockObj };
});

import * as SmartcardCertificateReader from '../../src/main/smartcard/SmartcardCertificateReader';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';
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
    expect(coordinator.hasGlobalCard(LIB)).toBe(true);
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
    expect(coordinator.lastLoadFailureAt(LIB)).toBeTypeOf('number');
    expect(coordinator.hasGlobalCard(LIB)).toBe(false);

    await expect(coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => 'again')).rejects.toThrow(/cooling down/);
    expect(agent.addPkcs11).toHaveBeenCalledTimes(1);
  });

  it('forgets a card after a failed use, but not when a private agent was involved', async () => {
    const { coordinator, agent, deps } = build();
    await coordinator.getOrLoadGlobalSmartcardAgent(LIB, async () => '123456');
    (coordinator as any).globalSmartcardCerts.set(LIB, new Map());

    coordinator.forgetGlobalCardAfterFailure(LIB, 4242);
    expect(coordinator.hasGlobalCard(LIB)).toBe(true);

    coordinator.forgetGlobalCardAfterFailure(LIB, undefined);
    expect(coordinator.hasGlobalCard(LIB)).toBe(false);
    expect((coordinator as any).globalSmartcardCerts.has(LIB)).toBe(false);
    expect(agent.remove).toHaveBeenCalledWith(LIB);
    await (coordinator as any).agentConfigRefresh;
    expect(deps.syncAgentBlock).toHaveBeenCalled();
  });

  describe('awaitStartupUnlock', () => {
    it('returns at once when no startup unlock is running', async () => {
      const { coordinator } = build();
      await expect(coordinator.awaitStartupUnlock()).resolves.toBeUndefined();
      expect(coordinator.hasStartupUnlock()).toBe(false);
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
      expect(coordinator.hasGlobalCard(LIB)).toBe(false);
      expect(agent.shutdown).toHaveBeenCalledTimes(1);
      expect(calls.indexOf('syncAgentBlock:null')).toBeGreaterThan(calls.indexOf('killPrivateAgent'));
      expect(calls.indexOf('appAgent.shutdown')).toBeGreaterThan(calls.indexOf('syncAgentBlock:null'));
    });
  });

  it('lists the session agents without exposing the entries', () => {
    const { coordinator } = build();
    (coordinator as any).smartcardSessionAgents.set('a', { pid: 1, socketPath: '/tmp/a.sock', kind: 'fido2' });
    expect(coordinator.listSessionAgents()).toEqual([{ kind: 'fido2', socketPath: '/tmp/a.sock' }]);
  });
});
