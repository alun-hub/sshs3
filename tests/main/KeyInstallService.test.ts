import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const { mockSpawn, state } = vi.hoisted(() => {
  const state: { child: any; queue: any[]; askpassHandler?: (p: string) => Promise<string> | string } = {
    child: null,
    queue: [],
  };
  return { mockSpawn: vi.fn(() => (state.queue.length > 0 ? state.queue.shift() : state.child)), state };
});

vi.mock('node:child_process', () => ({ spawn: mockSpawn, execFile: vi.fn() }));

vi.mock('../../src/main/smartcard/AskpassServer', () => {
  class MockAskpassServer {
    constructor(opts: { promptHandler: (p: string) => Promise<string> | string }) {
      state.askpassHandler = opts.promptHandler;
    }
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    getEnv = vi.fn().mockReturnValue({ SSH_ASKPASS: '/tmp/askpass', SSH_ASKPASS_REQUIRE: 'force' });
  }
  return { AskpassServer: MockAskpassServer };
});

import { installPublicKeys, buildKeyInstallArgs, probeHost, testLogin } from '../../src/main/ssh/KeyInstallService';
import { REMOTE_INSTALL_COMMAND } from '../../src/main/ssh/PublicKeyUtils';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

function blob(fill: number): string {
  const type = Buffer.from('ssh-ed25519');
  const len = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return Buffer.concat([len(type.length), type, len(32), Buffer.alloc(32, fill)]).toString('base64');
}
const KEY_A = `ssh-ed25519 ${blob(1)} a@b`;
const KEY_B = `ssh-ed25519 ${blob(2)}`;

const baseConfig: SSHConnectionConfig = {
  id: 'p1',
  name: 'prod',
  host: 'db.internal',
  username: 'alice',
  authType: 'password',
  password: 'hunter2', // pragma: allowlist secret
  proxyJump: 'bastion@jump.example.com',
  forwardAgent: true,
  x11Forwarding: true,
  tunnels: [{ id: 't', name: 't', type: 'local', localPort: 8080, remoteHost: 'x', remotePort: 80, enabled: true } as any],
};

function makeChild() {
  const c = new EventEmitter() as any;
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.stdinData = '';
  c.stdin.on('data', (d: Buffer) => (c.stdinData += d.toString()));
  return c;
}

function newChild() {
  const c = makeChild();
  state.child = c;
  return c;
}

/** Ett barn per spawn-anrop, i ordning; gör att flera inloggningsförsök kan scriptas. */
function queueChildren(...scripts: Array<{ stdout?: string; stderr?: string; code?: number }>) {
  const children = scripts.map((sc) => {
    const c = makeChild();
    c.script = sc;
    return c;
  });
  state.queue = [...children];
  return children;
}

async function settle(child: any) {
  const sc = child.script ?? {};
  // spawn() körs efter ett await (askpass.start); vänta tills barnet har plockats ur kön.
  while (state.queue.includes(child)) await new Promise((r) => setImmediate(r));
  if (sc.stderr) child.stderr.write(sc.stderr);
  if (sc.stdout) child.stdout.write(sc.stdout);
  setImmediate(() => child.emit('close', sc.code ?? 0));
}

function finish(child: any, stdout: string, code = 0, stderr = '') {
  // spawn() körs efter ett await (askpass.start), så vänta tills den har anropats.
  const tick = () => {
    if (mockSpawn.mock.calls.length === 0) return setImmediate(tick);
    if (stderr) child.stderr.write(stderr);
    child.stdout.write(stdout);
    setImmediate(() => child.emit('close', code));
  };
  tick();
}

describe('buildKeyInstallArgs', () => {
  it('keeps the jump host, drops forwarding/tunnels and puts the remote command last', () => {
    const args = buildKeyInstallArgs(baseConfig);
    expect(args).toContain('-J');
    expect(args).toContain('bastion@jump.example.com');
    expect(args).not.toContain('-Y');
    expect(args.join(' ')).not.toContain('ForwardAgent=yes');
    expect(args).not.toContain('-L');
    expect(args).toContain('-T');
    expect(args).toContain('NumberOfPasswordPrompts=1');
    expect(args).not.toContain('BatchMode=yes');
    expect(args[args.length - 1]).toBe(REMOTE_INSTALL_COMMAND);
    expect(args[args.length - 3]).toBe('--');
    expect(args[args.length - 2]).toBe('alice@db.internal');
  });
});

describe('installPublicKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.askpassHandler = undefined;
    state.queue = [];
  });

  it('sends keys on stdin only (never in argv) and maps per-key status', async () => {
    const child = newChild();
    finish(child, 'S3M:1:installed\nS3M:2:present\n');
    const out = await installPublicKeys({ config: baseConfig, publicKeys: [KEY_A, KEY_B] });

    expect(out.success).toBe(true);
    expect(out.results.map((r) => r.status)).toEqual(['installed', 'present']);
    expect(child.stdinData).toBe(`${KEY_A}\n${KEY_B}\n`);
    const argv = (mockSpawn.mock.calls[0] as any[])[1] as string[];
    expect(argv.join(' ')).not.toContain(blob(1));
  });

  it('numbers only valid keys and marks invalid ones without sending them', async () => {
    const child = newChild();
    finish(child, 'S3M:1:installed\n');
    const out = await installPublicKeys({ config: baseConfig, publicKeys: ['garbage', KEY_A] });

    expect(out.results.map((r) => r.status)).toEqual(['invalid', 'installed']);
    expect(child.stdinData).toBe(`${KEY_A}\n`);
  });

  it('fails without spawning when no key is valid', async () => {
    const out = await installPublicKeys({ config: baseConfig, publicKeys: ['nope'] });
    expect(out.success).toBe(false);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('reports ssh diagnostics when the command fails', async () => {
    const child = newChild();
    finish(child, '', 255, 'alice@db.internal: Permission denied (publickey,password).\n');
    const out = await installPublicKeys({ config: baseConfig, publicKeys: [KEY_A] });

    expect(out.success).toBe(false);
    expect(out.error).toContain('Permission denied');
    expect(out.results[0].status).toBe('unknown');
  });

  it('fails when the script exits 0 but did not confirm every key', async () => {
    const child = newChild();
    finish(child, 'S3M:1:installed\n');
    const out = await installPublicKeys({ config: baseConfig, publicKeys: [KEY_A, KEY_B] });
    expect(out.success).toBe(false);
    expect(out.results.map((r) => r.status)).toEqual(['installed', 'unknown']);
  });

  describe('askpass handler', () => {
    async function handler(opts: Partial<Parameters<typeof installPublicKeys>[0]> = {}) {
      const child = newChild();
      finish(child, 'S3M:1:installed\n');
      await installPublicKeys({ config: baseConfig, publicKeys: [KEY_A], ...opts });
      return state.askpassHandler!;
    }

    it('answers the saved password once, then asks the user', async () => {
      const ask = vi.fn().mockResolvedValue('typed');
      const h = await handler({ pinPromptHandler: ask });
      expect(await h("alice@db.internal's password: ")).toBe('hunter2');
      expect(await h("alice@db.internal's password: ")).toBe('typed');
    });

    it('never answers a PIN or passphrase prompt with the saved password', async () => {
      const ask = vi.fn().mockResolvedValue('1234');
      const h = await handler({ pinPromptHandler: ask });
      expect(await h('Enter PIN for authenticator: ')).toBe('1234');
      expect(ask).toHaveBeenCalledWith('Enter PIN for authenticator: ');
    });

    it('rejects an unknown host key when there is no handler (fail closed)', async () => {
      const h = await handler();
      expect(await h('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toBe('no');
    });

    it('asks the user about host keys and never answers them with a password', async () => {
      const hostKey = vi.fn().mockResolvedValue(true);
      const h = await handler({ hostKeyPromptHandler: hostKey });
      const prompt =
        'The authenticity of host can\'t be established.\nED25519 key fingerprint is SHA256:abc.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ';
      expect(await h(prompt)).toBe('yes');
      expect(hostKey).toHaveBeenCalledWith(expect.objectContaining({ host: 'db.internal', port: 22 }));

      hostKey.mockResolvedValueOnce(false);
      expect(await h(prompt)).toBe('no');
    });
  });
});

describe('buildKeyInstallArgs leading options', () => {
  it('puts leading options before the builder options so they win (first -o wins in OpenSSH)', () => {
    const args = buildKeyInstallArgs(baseConfig, 'true', ['-o', 'PreferredAuthentications=none']);
    const lead = args.indexOf('PreferredAuthentications=none');
    const builder = args.indexOf('PreferredAuthentications=password,keyboard-interactive');
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(builder).toBeGreaterThan(lead);
    expect(args[args.length - 1]).toBe('true');
  });
});

describe('installPublicKeys login order', () => {
  const smartcard: SSHConnectionConfig = {
    ...baseConfig,
    authType: 'smartcard',
    pkcs11LibPath: '/lib/x.so',
    password: undefined,
    proxyJump: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state.queue = [];
  });

  async function run(children: ReturnType<typeof queueChildren>, opts: Partial<Parameters<typeof installPublicKeys>[0]> = {}) {
    const p = installPublicKeys({ config: smartcard, publicKeys: [KEY_A], ...opts });
    await Promise.all(children.map(settle));
    return p;
  }

  it('installing only the card\'s own key logs in with the password and never loads the card (no PIN)', async () => {
    const prepare = vi.fn();
    const out = await run(queueChildren({ stdout: 'S3M:1:installed\n' }), { installsOwnKeyOnly: true, prepareProfileConfig: prepare });

    expect(out).toMatchObject({ success: true, loginMethod: 'password' });
    expect(prepare).not.toHaveBeenCalled();
    const argv = (mockSpawn.mock.calls[0] as any[])[1] as string[];
    expect(argv).toContain('PubkeyAuthentication=no');
    expect(argv).not.toContain('-I');
  });

  it('installing other keys logs in with the profile first (loading the card), then falls back to password if denied', async () => {
    const prepare = vi.fn().mockImplementation(async (c: SSHConnectionConfig) => ({ ...c, agentPath: '/tmp/agent.sock' }));
    const out = await run(
      queueChildren(
        { stderr: 'alice@h: Permission denied (publickey,password).\n', code: 255 },
        { stdout: 'S3M:1:installed\n' }
      ),
      { prepareProfileConfig: prepare }
    );

    expect(out).toMatchObject({ success: true, loginMethod: 'password' });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(((mockSpawn.mock.calls[0] as any[])[2] as any).env.SSH_AUTH_SOCK).toBe('/tmp/agent.sock');
  });

  it('does not retry another method after a network failure', async () => {
    const out = await run(queueChildren({ stderr: 'ssh: connect to host h port 22: Connection timed out\n', code: 255 }), {
      prepareProfileConfig: async (c) => c,
    });
    expect(out.success).toBe(false);
    expect(out.error).toContain('timed out');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('explains a keys-only host when only the own key is selected, without spawning', async () => {
    const out = await installPublicKeys({
      config: smartcard,
      publicKeys: [KEY_A],
      installsOwnKeyOnly: true,
      serverMethods: ['publickey'],
    });
    expect(out.success).toBe(false);
    expect(out.error).toContain('only accepts keys');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('a forced password login never touches the card', async () => {
    const prepare = vi.fn();
    const out = await run(queueChildren({ stdout: 'S3M:1:present\n' }), { loginMethod: 'password', prepareProfileConfig: prepare });
    expect(out).toMatchObject({ success: true, loginMethod: 'password' });
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('probeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.queue = [];
  });

  async function probe(script: { stderr?: string; code?: number }, handlers: Parameters<typeof probeHost>[1] = {}) {
    const [child] = queueChildren(script);
    const p = probeHost({ ...baseConfig, authType: 'smartcard', pkcs11LibPath: '/lib/x.so', agentPath: '/tmp/a' } as SSHConnectionConfig, handlers);
    await settle(child);
    return p;
  }

  it('returns the allowed methods and sends no identity or password, only the jump host', async () => {
    const res = await probe({ stderr: 'alice@h: Permission denied (publickey,password).\n', code: 255 });
    expect(res).toMatchObject({ reachable: true, hostKey: 'trusted', methods: ['publickey', 'password'] });

    const argv = (mockSpawn.mock.calls[0] as any[])[1] as string[];
    expect(argv.slice(0, 4)).toEqual(['-o', 'PreferredAuthentications=none', '-o', 'PubkeyAuthentication=no']);
    expect(argv).toContain('-J');
    expect(argv).not.toContain('-I');
    expect(argv[argv.length - 1]).toBe('true');
    expect(((mockSpawn.mock.calls[0] as any[])[2] as any).env.SSH_AUTH_SOCK).not.toBe('/tmp/a');
  });

  it('reports why the host cannot be reached', async () => {
    const res = await probe({ stderr: 'ssh: Could not resolve hostname db.internal\n', code: 255 });
    expect(res).toMatchObject({ reachable: false, errorKind: 'dns' });
  });

  it('reports a changed host key', async () => {
    const res = await probe({ stderr: '@@@ REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\n', code: 255 });
    expect(res).toMatchObject({ hostKey: 'changed', errorKind: 'hostkey-changed' });
  });

  it('records that the user trusted a new host key during the probe', async () => {
    const hostKeyPromptHandler = vi.fn().mockResolvedValue(true);
    const [child] = queueChildren({ stderr: 'alice@h: Permission denied (password).\n', code: 255 });
    const p = probeHost(baseConfig, { hostKeyPromptHandler });
    // Låt ssh "fråga" via askpass innan processen avslutas.
    while (state.queue.includes(child)) await new Promise((r) => setImmediate(r));
    await state.askpassHandler!('Are you sure you want to continue connecting (yes/no/[fingerprint])? ');
    await settle(child);
    expect(await p).toMatchObject({ hostKey: 'accepted', reachable: true, methods: ['password'] });
  });

  it('a host key the user refuses is not "reachable for login"', async () => {
    const [child] = queueChildren({ stderr: 'Host key verification failed.\n', code: 255 });
    const p = probeHost(baseConfig, { hostKeyPromptHandler: vi.fn().mockResolvedValue(false) });
    while (state.queue.includes(child)) await new Promise((r) => setImmediate(r));
    await state.askpassHandler!('Are you sure you want to continue connecting (yes/no/[fingerprint])? ');
    await settle(child);
    expect(await p).toMatchObject({ hostKey: 'rejected', reachable: false, errorKind: 'hostkey-rejected' });
  });
});

describe('testLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.queue = [];
  });

  it('succeeds on exit 0 and runs a harmless command', async () => {
    const [child] = queueChildren({ code: 0 });
    const p = testLogin(baseConfig);
    await settle(child);
    expect(await p).toEqual({ success: true });
    expect(((mockSpawn.mock.calls[0] as any[])[1] as string[]).slice(-1)).toEqual(['true']);
  });

  it('key profiles must prove their own key: password fallback is switched off', async () => {
    const [child] = queueChildren({ code: 0 });
    const p = testLogin({ ...baseConfig, authType: 'privateKey', privateKeyPath: '/k' });
    await settle(child);
    await p;
    const argv = (mockSpawn.mock.calls[0] as any[])[1] as string[];
    expect(argv.slice(0, 4)).toEqual(['-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no']);
  });

  it('password profiles keep password auth enabled', async () => {
    const [child] = queueChildren({ code: 0 });
    const p = testLogin(baseConfig);
    await settle(child);
    await p;
    expect(((mockSpawn.mock.calls[0] as any[])[1] as string[]).join(' ')).not.toContain('PasswordAuthentication=no');
  });

  it('returns the ssh diagnostics on failure', async () => {
    const [child] = queueChildren({ stderr: 'alice@h: Permission denied (publickey).\n', code: 255 });
    const p = testLogin(baseConfig);
    await settle(child);
    const res = await p;
    expect(res.success).toBe(false);
    expect(res.error).toContain('Permission denied');
  });
});

describe('installPublicKeys: switched from PIV to FIDO2 (the card is still in the profile)', () => {
  const fido: SSHConnectionConfig = {
    ...baseConfig,
    authType: 'fido2',
    fido2Resident: true,
    pkcs11LibPath: '/usr/lib64/p11-kit-proxy.so',
    password: undefined,
    proxyJump: undefined,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state.queue = [];
  });

  async function run(children: ReturnType<typeof queueChildren>, opts: Partial<Parameters<typeof installPublicKeys>[0]> = {}) {
    const p = installPublicKeys({ config: fido, publicKeys: [KEY_A], ...opts });
    await Promise.all(children.map(settle));
    return p;
  }

  it('installing the FIDO2 key logs in with the card (already trusted by the host) instead of the password', async () => {
    const prepare = vi.fn().mockImplementation(async (c: SSHConnectionConfig) => ({ ...c, agentPath: '/tmp/card.sock' }));
    const out = await run(queueChildren({ stdout: 'S3M:1:installed\n' }), { installsOwnKeyOnly: true, prepareProfileConfig: prepare });

    expect(out).toMatchObject({ success: true, loginMethod: 'smartcard' });
    expect(prepare).toHaveBeenCalledTimes(1);
    const prepared = prepare.mock.calls[0][0] as SSHConnectionConfig;
    expect(prepared).toMatchObject({ authType: 'smartcard', pkcs11LibPath: '/usr/lib64/p11-kit-proxy.so' });
    expect(prepared.fido2Resident).toBeUndefined();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the password only if the card is rejected', async () => {
    const prepare = vi.fn().mockImplementation(async (c: SSHConnectionConfig) => ({ ...c, agentPath: '/tmp/card.sock' }));
    const out = await run(
      queueChildren(
        { stderr: 'alice@h: Permission denied (publickey,password).\n', code: 255 },
        { stdout: 'S3M:1:installed\n' }
      ),
      { installsOwnKeyOnly: true, prepareProfileConfig: prepare }
    );
    expect(out).toMatchObject({ success: true, loginMethod: 'password' });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('a forced smartcard login uses the card even for other keys, and never the password', async () => {
    const prepare = vi.fn().mockImplementation(async (c: SSHConnectionConfig) => c);
    const out = await run(queueChildren({ stdout: 'S3M:1:present\n' }), { loginMethod: 'smartcard', prepareProfileConfig: prepare });
    expect(out).toMatchObject({ success: true, loginMethod: 'smartcard' });
    expect((prepare.mock.calls[0][0] as SSHConnectionConfig).authType).toBe('smartcard');
  });

  it('a forced smartcard login without a library explains what is missing, without spawning', async () => {
    const out = await installPublicKeys({
      config: { ...fido, pkcs11LibPath: undefined },
      publicKeys: [KEY_A],
      loginMethod: 'smartcard',
    });
    expect(out.success).toBe(false);
    expect(out.error).toContain('PKCS#11');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('"already-unlocked keys" uses the ssh-agent without loading any card, key file or password', async () => {
    const prepare = vi.fn();
    const out = await run(queueChildren({ stdout: 'S3M:1:installed\n' }), { loginMethod: 'agent', prepareProfileConfig: prepare });

    expect(out).toMatchObject({ success: true, loginMethod: 'agent' });
    expect(prepare).not.toHaveBeenCalled();
    const argv = (mockSpawn.mock.calls[0] as any[])[1] as string[];
    expect(argv).not.toContain('-I');
    expect(argv).not.toContain('PubkeyAuthentication=no');
  });
});
