import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: any[]) => mockSpawn(...args),
  };
});

import { DotfileCliTransport } from '../../src/main/dotfiles/DotfileCliTransport';

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn() };
  return child;
}

const CONFIG: SSHConnectionConfig = {
  id: 'test',
  name: 'Test',
  host: 'example.com',
  port: 22,
  username: 'alun',
  authType: 'password',
} as SSHConnectionConfig;

describe('DotfileCliTransport', () => {
  let child: ReturnType<typeof fakeChild>;

  beforeEach(() => {
    vi.restoreAllMocks();
    child = fakeChild();
    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
  });

  // Regression tests for the C2 finding (code review): remotePath/mode used
  // to be interpolated via JSON.stringify (double-quoted) or raw string
  // concatenation into a command string executed by the REMOTE host's shell.
  // Double quotes still allow $(...) and backtick expansion, and `mode` was
  // completely unquoted, so a malicious dotfile-pool entry (synced from a
  // compromised target, paired device, or leaked master password) could run
  // arbitrary commands on every server the user later syncs dotfiles to.

  it('single-quotes a path containing command substitution for readRemoteFile', async () => {
    const transport = new DotfileCliTransport(CONFIG);
    const malicious = '$(touch /tmp/pwned)';

    await transport.readRemoteFile(malicious);

    const [, args] = mockSpawn.mock.calls[0];
    const remoteCmd = args[args.length - 1] as string;
    expect(remoteCmd).toBe(`cat -- '$(touch /tmp/pwned)'`);
  });

  it('single-quotes a path containing a literal single quote for readRemoteFile', async () => {
    const transport = new DotfileCliTransport(CONFIG);
    const tricky = `foo'; rm -rf ~; echo '`;

    await transport.readRemoteFile(tricky);

    const [, args] = mockSpawn.mock.calls[0];
    const remoteCmd = args[args.length - 1] as string;
    // quoteShellArg's escaping: each embedded ' becomes '\''
    expect(remoteCmd).toBe(`cat -- 'foo'\\''; rm -rf ~; echo '\\'''`);
  });

  it('rejects a chmod mode that is not a plain octal permission string', async () => {
    const transport = new DotfileCliTransport(CONFIG);

    await expect(
      transport.writeRemoteFile('.bashrc', 'content', '644; rm -rf ~')
    ).rejects.toThrow(/invalid chmod mode/i);

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('accepts a valid octal chmod mode and single-quotes the path in writeRemoteFile', async () => {
    const transport = new DotfileCliTransport(CONFIG);

    await transport.writeRemoteFile('$(whoami)', 'content', '600');

    const [, args] = mockSpawn.mock.calls[0];
    const remoteCmd = args[args.length - 1] as string;
    expect(remoteCmd).toContain(`chmod 600 -- '$(whoami)'`);
  });
});
