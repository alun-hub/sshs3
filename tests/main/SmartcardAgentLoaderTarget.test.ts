import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const execQueue: Array<{ stdout: string }> = [];
let spawnScript: (args: string[]) => { stderr?: string; code?: number } = () => ({ code: 0 });
const spawnCalls: Array<{ bin: string; args: string[]; env: Record<string, string> }> = [];

vi.mock('node:child_process', () => ({
  // `ssh-add -l` goes through execFile; hand out queued listings (the last one repeats).
  execFile: vi.fn((...args: any[]) => {
    const cb = args[args.length - 1];
    const next = execQueue.length > 1 ? execQueue.shift()! : execQueue[0] ?? { stdout: '' };
    cb(null, { stdout: next.stdout, stderr: '' });
  }),
  spawn: vi.fn((bin: string, args: string[], opts: any) => {
    spawnCalls.push({ bin, args, env: opts.env });
    const child: any = new EventEmitter();
    child.pid = 1234;
    child.stdin = { end: vi.fn() };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      const { stderr, code } = spawnScript(args);
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code ?? 0);
    });
    return child;
  }),
}));
vi.mock('../../src/main/ssh/AgentLifecycleManager', () => ({
  AgentLifecycleManager: { spawnPrivateAgent: vi.fn(), killPrivateAgent: vi.fn() },
}));

const tempServers: any[] = [];
vi.mock('../../src/main/smartcard/AskpassServer', () => ({
  AskpassServer: class {
    start = vi.fn().mockResolvedValue({ port: 0, scriptPath: '/tmp/askpass.sh' });
    stop = vi.fn().mockResolvedValue(undefined);
    getEnv = vi.fn().mockReturnValue({ SSH_ASKPASS: '/tmp/askpass.sh' });
    setPromptHandler = vi.fn();
    setOnPresence = vi.fn();
    constructor() {
      tempServers.push(this);
    }
  },
}));

import { addSmartcardToAgent, addFido2ResidentKeysToAgent } from '../../src/main/smartcard/SmartcardAgentLoader';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';

const list = (...fps: string[]) => ({
  stdout: fps.length
    ? fps.map((f) => `256 SHA256:${f} PIV AUTH pubkey (ECDSA)`).join('\n') + '\n'
    : 'The agent has no identities.\n',
});

const makeShared = () => ({
  setPromptHandler: vi.fn(),
  setOnPresence: vi.fn(),
  getEnv: vi.fn().mockReturnValue({ SSH_ASKPASS: '/shared/askpass.sh' }),
  stop: vi.fn().mockResolvedValue(undefined),
});

describe('adding identities to an already-running agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execQueue.length = 0;
    spawnCalls.length = 0;
    tempServers.length = 0;
    spawnScript = () => ({ stderr: 'Card added: /usr/lib/libykcs11.so\n', code: 0 });
  });

  it('runs ssh-add against the target socket without spawning or killing an agent', async () => {
    const shared = makeShared();
    execQueue.push(list('aaa'), list('aaa', 'bbb')); // before, after
    const res = await addSmartcardToAgent(
      { pid: 77, socketPath: '/run/sshs3/agent.sock', askpassServer: shared as any },
      '/usr/lib/libykcs11.so',
      async () => '123456',
      { retries: 0 }
    );

    expect(AgentLifecycleManager.spawnPrivateAgent).not.toHaveBeenCalled();
    expect(AgentLifecycleManager.killPrivateAgent).not.toHaveBeenCalled();
    expect(spawnCalls[0].args).toEqual(['-s', '/usr/lib/libykcs11.so']);
    expect(spawnCalls[0].env.SSH_AUTH_SOCK).toBe('/run/sshs3/agent.sock');
    expect(spawnCalls[0].env.SSH_ASKPASS).toBe('/shared/askpass.sh');
    expect(shared.setPromptHandler).toHaveBeenCalled();
    expect(shared.stop).not.toHaveBeenCalled();
    expect(res).toMatchObject({ pid: 77, socketPath: '/run/sshs3/agent.sock' });
  });

  it('does not mistake the existing identities for a successful add', async () => {
    const shared = makeShared();
    spawnScript = () => ({ stderr: 'agent refused operation\n', code: 0 });
    execQueue.push(list('aaa')); // unchanged before and after
    await expect(
      addSmartcardToAgent(
        { pid: 77, socketPath: '/s.sock', askpassServer: shared as any },
        '/lib.so',
        async () => '000000',
        { retries: 0, maxPinAttempts: 1 }
      )
    ).rejects.toThrow();
    expect(AgentLifecycleManager.killPrivateAgent).not.toHaveBeenCalled();
    expect(shared.stop).not.toHaveBeenCalled();
  });

  it('accepts re-adding a key the agent already holds when ssh-add reports no problem', async () => {
    execQueue.push(list('aaa'));
    await expect(
      addSmartcardToAgent({ pid: 1, socketPath: '/s.sock', askpassServer: makeShared() as any }, '/lib.so', async () => '1', {
        retries: 0,
      })
    ).resolves.toBeDefined();
  });

  it('uses a temporary askpass server and stops it when the target has none (Windows service)', async () => {
    execQueue.push(list(), list('aaa'));
    await addSmartcardToAgent({ pid: 0, socketPath: '\\\\.\\pipe\\openssh-ssh-agent' }, '/lib.so', async () => '1', {
      retries: 0,
    });
    expect(tempServers).toHaveLength(1);
    expect(tempServers[0].start).toHaveBeenCalled();
    expect(tempServers[0].stop).toHaveBeenCalled();
    expect(AgentLifecycleManager.spawnPrivateAgent).not.toHaveBeenCalled();
  });

  it('adds FIDO2 resident keys with -K and treats a textless failure as "no resident credentials"', async () => {
    spawnScript = () => ({ code: 1 });
    execQueue.push(list());
    await expect(
      addFido2ResidentKeysToAgent({ pid: 1, socketPath: '/s.sock', askpassServer: makeShared() as any }, async () => '1', {
        retries: 0,
      })
    ).resolves.toBeDefined();
    expect(spawnCalls[0].args).toEqual(['-K']);
  });
});
