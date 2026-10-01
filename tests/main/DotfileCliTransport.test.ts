import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const { mockSpawn, mockExistsSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const customFs = {
    ...actual,
    existsSync: (p: string) => mockExistsSync(p),
  };
  return {
    ...customFs,
    default: customFs,
  };
});

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
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockExistsSync.mockReset();
    child = fakeChild();
    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  // Security escaping tests
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
    expect(child.stdin.end).toHaveBeenCalledWith('content', 'utf-8');
  });

  it('writes remote file without chmod when mode is omitted', async () => {
    const transport = new DotfileCliTransport(CONFIG);

    await transport.writeRemoteFile('.vimrc', 'syntax on');

    const [, args] = mockSpawn.mock.calls[0];
    const remoteCmd = args[args.length - 1] as string;
    expect(remoteCmd).not.toContain('chmod');
    expect(remoteCmd).toContain('cat >');
    expect(child.stdin.end).toHaveBeenCalledWith('syntax on', 'utf-8');
  });

  // Home directory resolution
  it('resolves remote home directory from stdout', async () => {
    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('/home/remoteuser\n'));
        child.emit('close', 0);
      });
      return child;
    });

    const transport = new DotfileCliTransport(CONFIG);
    const home = await transport.getHomeDir();
    expect(home).toBe('/home/remoteuser');
  });

  it('throws when remote home directory stdout is empty', async () => {
    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });

    const transport = new DotfileCliTransport(CONFIG);
    await expect(transport.getHomeDir()).rejects.toThrow('Failed to resolve remote home directory via SSH');
  });

  // ControlPath multiplexing & fallback
  // ControlPath multiplexing is POSIX-only (the transport uses plain ssh.exe without a control socket on Windows)
  it.skipIf(process.platform === 'win32')('uses control socket when controlPath exists', async () => {
    mockExistsSync.mockReturnValue(true);
    const transport = new DotfileCliTransport(CONFIG, '/tmp/master.sock');

    await transport.readRemoteFile('.bashrc');

    const [bin, args] = mockSpawn.mock.calls[0];
    expect(bin).toBe('ssh');
    expect(args).toContain('ControlPath=/tmp/master.sock');
    expect(args).toContain('BatchMode=yes');
    expect(args).toContain('alun@example.com');
  });

  it('uses target without username when username is missing on config with control socket', async () => {
    mockExistsSync.mockReturnValue(true);
    const noUserConfig = { ...CONFIG, username: undefined } as unknown as SSHConnectionConfig;
    const transport = new DotfileCliTransport(noUserConfig, '/tmp/master.sock');

    await transport.readRemoteFile('.bashrc');

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('example.com');
    expect(args).not.toContain('undefined@example.com');
  });

  it.skipIf(process.platform === 'win32')('waits for controlPath if not immediately present and uses it once created', async () => {
    let checkedCount = 0;
    mockExistsSync.mockImplementation(() => {
      checkedCount++;
      return checkedCount >= 2;
    });

    const transport = new DotfileCliTransport(CONFIG, '/tmp/delay.sock');
    await transport.readRemoteFile('.bashrc');

    expect(mockSpawn).toHaveBeenCalled();
    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('ControlPath=/tmp/delay.sock');
  });

  it('falls back to standard SSH arguments when controlPath does not exist after wait', async () => {
    vi.useFakeTimers();
    mockExistsSync.mockReturnValue(false);

    const transport = new DotfileCliTransport(CONFIG, '/tmp/never.sock');
    const promise = transport.readRemoteFile('.bashrc');

    await vi.advanceTimersByTimeAsync(4500);
    await promise;

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).not.toContain('ControlPath=/tmp/never.sock');
    vi.useRealTimers();
  });

  it('ignores controlPath on Windows and uses ssh.exe', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockExistsSync.mockReturnValue(true);

    const transport = new DotfileCliTransport(CONFIG, 'C:\\tmp\\master.sock');
    await transport.readRemoteFile('.bashrc');

    const [bin, args] = mockSpawn.mock.calls[0];
    expect(bin).toBe('ssh.exe');
    expect(args).not.toContain('ControlPath=C:\\tmp\\master.sock');
  });

  it('injects SSH_AUTH_SOCK into env when agentPath is configured', async () => {
    const agentConfig = { ...CONFIG, agentPath: '/tmp/custom-agent.sock' };
    const transport = new DotfileCliTransport(agentConfig);

    await transport.readRemoteFile('.profile');

    const [, , options] = mockSpawn.mock.calls[0];
    expect(options.env.SSH_AUTH_SOCK).toBe('/tmp/custom-agent.sock');
  });

  // Touch presence notification
  it('triggers onPresence and onPresenceCleared on presence prompt in stderr', async () => {
    const onPresence = vi.fn();
    const onPresenceCleared = vi.fn();

    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('Confirm user presence for key ED25519-SK\n'));
        child.emit('close', 0);
      });
      return child;
    });

    const transport = new DotfileCliTransport(CONFIG, undefined, onPresence, onPresenceCleared);
    await transport.readRemoteFile('.gitconfig');

    expect(onPresence).toHaveBeenCalledTimes(1);
    expect(onPresenceCleared).toHaveBeenCalledTimes(1);
  });

  it('triggers onPresenceCleared when child process errors during presence prompt', async () => {
    const onPresence = vi.fn();
    const onPresenceCleared = vi.fn();

    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('Confirm user presence for key\n'));
        child.emit('error', new Error('Spawn error'));
      });
      return child;
    });

    const transport = new DotfileCliTransport(CONFIG, undefined, onPresence, onPresenceCleared);
    await expect(transport.readRemoteFile('.gitconfig')).rejects.toThrow('Spawn error');

    expect(onPresence).toHaveBeenCalledTimes(1);
    expect(onPresenceCleared).toHaveBeenCalledTimes(1);
  });

  // Exit codes and error handling
  it('rejects with formatted error on non-zero exit code', async () => {
    mockSpawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('Permission denied (publickey)\n'));
        child.emit('close', 255);
      });
      return child;
    });

    const transport = new DotfileCliTransport(CONFIG);
    await expect(transport.readRemoteFile('.secret')).rejects.toThrow(
      'SSH command failed (exit code 255): Permission denied (publickey)'
    );
  });

  it('resolves disconnect cleanly without error', async () => {
    const transport = new DotfileCliTransport(CONFIG);
    await expect(transport.disconnect()).resolves.toBeUndefined();
  });
});
