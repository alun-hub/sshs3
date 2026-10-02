import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { execState } = vi.hoisted(() => ({ execState: { stdout: '', fail: false, calls: [] as any[] } }));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((bin: string, args: string[], opts: any, cb: (err: Error | null, res?: { stdout: string }) => void) => {
    execState.calls.push({ bin, args, env: opts?.env });
    if (execState.fail) cb(new Error('agent not running'));
    else cb(null, { stdout: execState.stdout });
  }),
}));

import { listFilePublicKeys, listAgentPublicKeys } from '../../src/main/ssh/PublicKeyDiscovery';

function blob(fill: number): string {
  const type = Buffer.from('ssh-ed25519');
  const len = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return Buffer.concat([len(type.length), type, len(32), Buffer.alloc(32, fill)]).toString('base64');
}
const KEY_A = `ssh-ed25519 ${blob(1)} a@host`;
const KEY_B = `ssh-ed25519 ${blob(2)} b@host`;

describe('listFilePublicKeys', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 's3m-disc-'));
    fs.mkdirSync(path.join(home, '.ssh'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reads valid *.pub files, remembers the private key next to them, and skips junk', async () => {
    fs.writeFileSync(path.join(home, '.ssh', 'id_a.pub'), `${KEY_A}\n`);
    fs.writeFileSync(path.join(home, '.ssh', 'id_a'), 'PRIVATE');
    fs.writeFileSync(path.join(home, '.ssh', 'id_b.pub'), `${KEY_B}\n`); // no private file
    fs.writeFileSync(path.join(home, '.ssh', 'broken.pub'), 'not a key');
    fs.writeFileSync(path.join(home, '.ssh', 'huge.pub'), `${KEY_A}\n${'x'.repeat(20 * 1024)}`);
    fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), 'ignored');
    fs.mkdirSync(path.join(home, '.ssh', 'dir.pub'));

    const keys = await listFilePublicKeys();
    const byLabel = Object.fromEntries(keys.map((k) => [k.label, k]));

    expect(Object.keys(byLabel).sort()).toEqual(['id_a.pub', 'id_b.pub']);
    expect(byLabel['id_a.pub']).toMatchObject({ source: 'file', comment: 'a@host', privateKeyPath: path.join(home, '.ssh', 'id_a') });
    expect(byLabel['id_a.pub'].fingerprint).toMatch(/^SHA256:/);
    expect(byLabel['id_b.pub'].privateKeyPath).toBeUndefined();
  });

  it('includes the .pub next to a profile key file outside ~/.ssh', async () => {
    const other = path.join(home, 'keys');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'work.pub'), `${KEY_B}\n`);
    fs.writeFileSync(path.join(other, 'work'), 'PRIVATE');

    const keys = await listFilePublicKeys(path.join(other, 'work'));
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ label: 'work.pub', privateKeyPath: path.join(other, 'work') });
  });

  it('returns an empty list when there is no ~/.ssh and no extra key', async () => {
    fs.rmSync(path.join(home, '.ssh'), { recursive: true });
    expect(await listFilePublicKeys('   ')).toEqual([]);
  });

  it('takes the first key of a multi-key .pub file only', async () => {
    fs.writeFileSync(path.join(home, '.ssh', 'two.pub'), `${KEY_A}\n${KEY_B}\n`);
    const keys = await listFilePublicKeys();
    expect(keys.map((k) => k.comment)).toEqual(['a@host']);
  });
});

describe('listAgentPublicKeys', () => {
  beforeEach(() => {
    execState.stdout = '';
    execState.fail = false;
    execState.calls = [];
    delete process.env.SSH_AUTH_SOCK;
  });

  it('parses ssh-add -L output against the given socket and labels the source', async () => {
    execState.stdout = `${KEY_A}\n${KEY_B}\nnot a key line\n`;
    const keys = await listAgentPublicKeys('fido2', 'Security key', '/tmp/agent.sock');

    expect(keys.map((k) => [k.comment, k.source])).toEqual([
      ['a@host', 'fido2'],
      ['b@host', 'fido2'],
    ]);
    expect(execState.calls[0].args).toEqual(['-L']);
    expect(execState.calls[0].env.SSH_AUTH_SOCK).toBe('/tmp/agent.sock');
  });

  it('uses the label for keys without a comment', async () => {
    execState.stdout = `ssh-ed25519 ${blob(3)}\n`;
    const keys = await listAgentPublicKeys('smartcard', 'Smartcard key', '/tmp/a');
    expect(keys[0].label).toBe('Smartcard key');
  });

  it('returns nothing without a socket (no agent to ask)', async () => {
    expect(await listAgentPublicKeys('agent', 'Cached key')).toEqual([]);
    expect(execState.calls).toHaveLength(0);
  });

  it('falls back to the default agent socket from the environment', async () => {
    process.env.SSH_AUTH_SOCK = '/run/user/1000/ssh-agent.socket';
    execState.stdout = `${KEY_A}\n`;
    const keys = await listAgentPublicKeys('agent', 'Cached key');
    expect(keys).toHaveLength(1);
    expect(execState.calls[0].env.SSH_AUTH_SOCK).toBe('/run/user/1000/ssh-agent.socket');
    delete process.env.SSH_AUTH_SOCK;
  });

  it('treats a failing or empty agent as no keys', async () => {
    execState.fail = true;
    expect(await listAgentPublicKeys('agent', 'x', '/tmp/a')).toEqual([]);
    execState.fail = false;
    execState.stdout = 'The agent has no identities.\n';
    expect(await listAgentPublicKeys('agent', 'x', '/tmp/a')).toEqual([]);
  });
});
