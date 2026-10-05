import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile as mockedExecFile } from 'node:child_process';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('../../src/main/ssh/AgentLifecycleManager', () => ({
  AgentLifecycleManager: {
    probeSocket: vi.fn(),
    spawnPrivateAgent: vi.fn(),
    killPrivateAgent: vi.fn(),
    unloadCard: vi.fn(),
  },
}));
vi.mock('../../src/main/smartcard/SmartcardAgentLoader', () => ({
  listAgentIdentities: vi.fn(),
  addSmartcardToAgent: vi.fn(),
  addFido2ResidentKeysToAgent: vi.fn(),
}));

const askpassInstances: Array<{ options: any; start: any; stop: any; getEnv: any }> = [];
vi.mock('../../src/main/smartcard/AskpassServer', () => ({
  AskpassServer: class {
    start = vi.fn().mockResolvedValue({ port: 0, scriptPath: '/fake/askpass.sh' });
    stop = vi.fn().mockResolvedValue(undefined);
    getEnv = vi.fn().mockReturnValue({ SSH_ASKPASS: '/fake/askpass.sh', SSH_ASKPASS_REQUIRE: 'force' });
    setPromptHandler = vi.fn();
    setOnPresence = vi.fn();
    constructor(public options: any) {
      askpassInstances.push(this as any);
    }
  },
}));

import { AppAgent, resolveAppAgentDir } from '../../src/main/ssh/AppAgent';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';
import {
  listAgentIdentities,
  addSmartcardToAgent,
  addFido2ResidentKeysToAgent,
} from '../../src/main/smartcard/SmartcardAgentLoader';

const lifecycle = vi.mocked(AgentLifecycleManager);

describe('AppAgent', () => {
  const origEnv = { ...process.env };
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let runtimeDir: string;
  let dir: string;
  let nextPid: number;

  const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value });

  beforeEach(() => {
    vi.clearAllMocks();
    askpassInstances.length = 0;
    runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-appagent-'));
    process.env = { ...origEnv, XDG_RUNTIME_DIR: runtimeDir };
    dir = resolveAppAgentDir();
    nextPid = 4000;
    lifecycle.probeSocket.mockResolvedValue(false);
    lifecycle.spawnPrivateAgent.mockImplementation(async (_env, options) => {
      const socketPath = options?.socketPath ?? '/nope';
      fs.writeFileSync(socketPath, '');
      return { pid: nextPid++, socketPath };
    });
    vi.mocked(mockedExecFile).mockImplementation(((...args: any[]) => {
      args[args.length - 1](null, { stdout: '', stderr: '' });
    }) as any);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', origPlatform);
    process.env = { ...origEnv };
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  it('starts one agent on a stable socket in a private directory, sharing concurrent starts', async () => {
    const agent = new AppAgent();
    const [a, b] = await Promise.all([agent.ensure(), agent.ensure()]);

    expect(a).toBe(path.join(dir, 'agent.sock'));
    expect(b).toBe(a);
    expect(lifecycle.spawnPrivateAgent).toHaveBeenCalledTimes(1);
    expect(lifecycle.spawnPrivateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ SSH_ASKPASS: '/fake/askpass.sh' }),
      { socketPath: a }
    );
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(agent.getSocketPath()).toBe(a);
  });

  it('reuses a running agent without respawning', async () => {
    const agent = new AppAgent();
    const first = await agent.ensure();
    lifecycle.probeSocket.mockResolvedValue(true);
    expect(await agent.ensure()).toBe(first);
    expect(lifecycle.spawnPrivateAgent).toHaveBeenCalledTimes(1);
  });

  it('restarts a dead agent, cleans up and notifies the owner', async () => {
    const agent = new AppAgent();
    const onExit = vi.fn();
    agent.setOnExit(onExit);
    const first = await agent.ensure();

    lifecycle.probeSocket.mockResolvedValue(false);
    const second = await agent.ensure();

    expect(lifecycle.killPrivateAgent).toHaveBeenCalledWith(4000);
    expect(askpassInstances[0].stop).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(lifecycle.spawnPrivateAgent).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  it('refuses a socket directory that others can access', async () => {
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    await expect(new AppAgent().ensure()).rejects.toThrow(/accessible by group\/others/);
    expect(lifecycle.spawnPrivateAgent).not.toHaveBeenCalled();
  });

  it('refuses a socket directory that is a symlink', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-elsewhere-'));
    fs.symlinkSync(elsewhere, dir);
    try {
      await expect(new AppAgent().ensure()).rejects.toThrow(/not a plain directory/);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses to replace a non-socket file at the socket path', async () => {
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'agent.sock'), 'precious');
    await expect(new AppAgent().ensure()).rejects.toThrow(/not a socket/);
    expect(fs.readFileSync(path.join(dir, 'agent.sock'), 'utf8')).toBe('precious');
  });

  it('removes a stale socket and takes agent.sock', async () => {
    fs.mkdirSync(dir, { mode: 0o700 });
    const sockPath = path.join(dir, 'agent.sock');
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));
    try {
      lifecycle.probeSocket.mockResolvedValue(false); // nobody answers => stale
      lifecycle.spawnPrivateAgent.mockImplementationOnce(async (_env, options) => {
        expect(fs.existsSync(options!.socketPath!)).toBe(false); // stale file removed before spawning
        return { pid: 1, socketPath: options!.socketPath! };
      });
      expect(await new AppAgent().ensure()).toBe(sockPath);
    } finally {
      server.close();
    }
  });

  it('uses a pid-suffixed socket when another live instance owns agent.sock', async () => {
    fs.mkdirSync(dir, { mode: 0o700 });
    const primary = path.join(dir, 'agent.sock');
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(primary, resolve));
    try {
      lifecycle.probeSocket.mockImplementation(async (p: string) => p === primary);
      expect(await new AppAgent().ensure()).toBe(path.join(dir, `agent-${process.pid}.sock`));
    } finally {
      server.close();
    }
  });

  it('routes agent-raised prompts to the handlers set by the owner', async () => {
    const agent = new AppAgent();
    await agent.ensure();
    const { options } = askpassInstances[0];

    expect(await options.promptHandler('Enter PIN:')).toBe('');

    const promptHandler = vi.fn().mockResolvedValue('123456');
    const onPresence = vi.fn();
    agent.setHandlers({ promptHandler, onPresence });
    expect(await options.promptHandler('Enter PIN:', undefined)).toBe('123456');
    options.onPresence('Confirm user presence');
    expect(onPresence).toHaveBeenCalledWith('Confirm user presence');
  });

  it('adds a PKCS#11 key to the agent without involving the agent\'s own askpass server, and tracks the library', async () => {
    const agent = new AppAgent();
    const ownerPrompt = vi.fn().mockResolvedValue('owner');
    agent.setHandlers({ promptHandler: ownerPrompt });
    vi.mocked(addSmartcardToAgent).mockImplementation(async (target) => ({
      pid: target.pid,
      socketPath: target.socketPath,
    }));

    await agent.addPkcs11('/usr/lib/libykcs11.so', async () => '123456');

    const [target, lib] = vi.mocked(addSmartcardToAgent).mock.calls[0];
    expect(lib).toBe('/usr/lib/libykcs11.so');
    expect(target).toEqual({ pid: 4000, socketPath: path.join(dir, 'agent.sock') });
    // Signature-time prompts keep going to the owner: the shared server's handlers are never swapped.
    const server = askpassInstances[0] as any;
    expect(server.setPromptHandler).not.toHaveBeenCalled();
    expect(server.setOnPresence).not.toHaveBeenCalled();
    await server.options.promptHandler('Enter PIN for authenticator:');
    expect(ownerPrompt).toHaveBeenCalled();

    // Tracked for Windows-style eviction.
    await agent.remove('/usr/lib/libykcs11.so');
    expect(lifecycle.unloadCard).toHaveBeenCalled();
  });

  it('keeps the agent when an add fails; adds run one at a time', async () => {
    const agent = new AppAgent();
    await agent.ensure();
    lifecycle.probeSocket.mockResolvedValue(true); // agent stays alive between adds
    const order: string[] = [];
    vi.mocked(addSmartcardToAgent).mockImplementationOnce(async () => {
      order.push('first-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('first-end');
      throw new Error('wrong PIN');
    });
    vi.mocked(addFido2ResidentKeysToAgent).mockImplementationOnce(async (target) => {
      order.push('second');
      return { pid: target.pid, socketPath: target.socketPath };
    });

    const first = agent.addPkcs11('/lib.so', async () => '1');
    const second = agent.addFido2Resident(async () => '1');
    await expect(first).rejects.toThrow('wrong PIN');
    await second;

    expect(order).toEqual(['first-start', 'first-end', 'second']);
    expect(lifecycle.killPrivateAgent).not.toHaveBeenCalled();
    expect(agent.getSocketPath()).not.toBeNull();
  });

  it('lists identities from the agent, and nothing before it started', async () => {
    const agent = new AppAgent();
    expect(await agent.list()).toEqual([]);
    const sock = await agent.ensure();
    vi.mocked(listAgentIdentities).mockResolvedValue([{ bits: '256', fingerprint: 'SHA256:x', comment: 'c', keyType: 'ED25519' }]);
    expect(await agent.list()).toHaveLength(1);
    expect(listAgentIdentities).toHaveBeenCalledWith(sock);
  });

  it('lockAll runs ssh-add -D against the agent socket on Unix and keeps the agent running', async () => {
    const agent = new AppAgent();
    const sock = await agent.ensure();
    await agent.lockAll();

    const call = vi.mocked(mockedExecFile).mock.calls.find((c) => c[0] === 'ssh-add')!;
    expect(call[1]).toEqual(['-D']);
    expect((call[2] as any).env.SSH_AUTH_SOCK).toBe(sock);
    expect(lifecycle.killPrivateAgent).not.toHaveBeenCalled();
    expect(agent.getSocketPath()).toBe(sock);
  });

  it('remove evicts one library via ssh-add -e', async () => {
    const agent = new AppAgent();
    const sock = await agent.ensure();
    await agent.remove('/usr/lib/libykcs11.so');
    expect(lifecycle.unloadCard).toHaveBeenCalledWith(sock, '/usr/lib/libykcs11.so');
  });

  it('shutdown stops askpass, kills the agent and removes the socket; calling it again is harmless', async () => {
    const agent = new AppAgent();
    const sock = await agent.ensure();
    expect(fs.existsSync(sock)).toBe(true);

    await agent.shutdown();
    expect(askpassInstances[0].stop).toHaveBeenCalled();
    expect(lifecycle.killPrivateAgent).toHaveBeenCalledWith(4000);
    expect(fs.existsSync(sock)).toBe(false);
    expect(agent.getSocketPath()).toBeNull();

    await expect(agent.shutdown()).resolves.toBeUndefined();
    expect(lifecycle.killPrivateAgent).toHaveBeenCalledTimes(1);
  });

  describe('Windows (shared OpenSSH service)', () => {
    beforeEach(() => {
      setPlatform('win32');
      lifecycle.spawnPrivateAgent.mockResolvedValue({ pid: 0, socketPath: '\\\\.\\pipe\\openssh-ssh-agent' });
    });

    it('uses the service pipe without an askpass server or socket directory', async () => {
      const agent = new AppAgent();
      expect(await agent.ensure()).toBe('\\\\.\\pipe\\openssh-ssh-agent');
      expect(askpassInstances).toHaveLength(0);
      expect(fs.existsSync(dir)).toBe(false);
    });

    it('lockAll and shutdown evict only the libraries it loaded and never kill or ssh-add -D', async () => {
      const agent = new AppAgent();
      const pipe = await agent.ensure();
      agent.noteLoadedLibrary('C:/OpenSC/opensc-pkcs11.dll');

      await agent.lockAll();
      expect(lifecycle.unloadCard).toHaveBeenCalledWith(pipe, 'C:/OpenSC/opensc-pkcs11.dll');
      expect(vi.mocked(mockedExecFile)).not.toHaveBeenCalled();

      await agent.shutdown();
      expect(lifecycle.killPrivateAgent).not.toHaveBeenCalled();
    });
  });
});
