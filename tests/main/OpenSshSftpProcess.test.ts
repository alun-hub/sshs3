import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { FXP } from '../../src/main/storage/sftp/SftpConstants';

const { mockSpawn, resetMockChild } = vi.hoisted(() => {
  let child: any = null;
  return {
    mockSpawn: vi.fn((_bin: string, _args: string[], _opts: any) => child),
    getMockChild: () => child,
    setMockChild: (c: any) => {
      child = c;
    },
    resetMockChild: () => {
      const c = new EventEmitter() as any;
      c.stdin = new PassThrough();
      c.stdout = new PassThrough();
      c.stderr = new PassThrough();
      c.kill = vi.fn();
      child = c;
      return c;
    },
  };
});

vi.mock('node:child_process', () => {
  return {
    spawn: mockSpawn,
    execFile: vi.fn(),
  };
});

vi.mock('../../src/main/smartcard/AskpassServer', () => {
  class MockAskpassServer {
    public start = vi.fn().mockResolvedValue(undefined);
    public stop = vi.fn().mockResolvedValue(undefined);
    public getEnv = vi.fn().mockReturnValue({ SSH_ASKPASS: '/tmp/askpass', SSH_ASKPASS_REQUIRE: 'force' });
  }
  return {
    AskpassServer: MockAskpassServer,
  };
});

import { OpenSshSftpProcess, resolveSshBinary, parseHostKeyPrompt } from '../../src/main/storage/sftp/OpenSshSftpProcess';

describe('OpenSshSftpProcess', () => {
  let mockChild: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChild = resetMockChild();
  });

  it('resolves correct ssh binary name', () => {
    const bin = resolveSshBinary();
    if (process.platform === 'win32') {
      expect(bin.endsWith('ssh.exe')).toBe(true);
    } else {
      expect(bin).toBe('ssh');
    }
  });

  it('spawns ssh with sftp subsystem arguments and initializes protocol', async () => {
    const proc = new OpenSshSftpProcess();

    const startPromise = proc.start({
      config: {
        id: 'test-1',
        host: 'myserver.com',
        port: 22,
        username: 'alice',
        authType: 'password',
        password: 'secretpassword', // pragma: allowlist secret
      },
    });

    // Simulate child sending VERSION 3 response
    setTimeout(() => {
      const resp = Buffer.alloc(9);
      resp.writeUInt32BE(5, 0);
      resp.writeUInt8(FXP.VERSION, 4);
      resp.writeUInt32BE(3, 5);
      mockChild.stdout.write(resp);
    }, 10);

    const protocol = await startPromise;
    expect(protocol).toBeDefined();

    // Subsystem name must come after the destination: `ssh ... -s -- user@host sftp`
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs.slice(-5)).toEqual(['BatchMode=no', '-s', '--', 'alice@myserver.com', 'sftp']);

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.stringMatching(/ssh(\.exe)?$/),
      expect.arrayContaining(['-o', 'BatchMode=no']),
      expect.objectContaining({
        env: expect.objectContaining({
          SSH_ASKPASS: '/tmp/askpass',
        }),
      })
    );

    await proc.close();
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('detects user presence prompt in stderr and triggers onPresence', async () => {
    const proc = new OpenSshSftpProcess();
    const onPresence = vi.fn();

    const startPromise = proc.start({
      config: {
        id: 'test-fido',
        host: 'fido.com',
        port: 22,
        username: 'bob',
        authType: 'fido2',
      },
      onPresence,
    });

    // Simulate stderr presence message
    mockChild.stderr.write('Confirm user presence for key ED25519-SK\n');

    setTimeout(() => {
      const resp = Buffer.alloc(9);
      resp.writeUInt32BE(5, 0);
      resp.writeUInt8(FXP.VERSION, 4);
      resp.writeUInt32BE(3, 5);
      mockChild.stdout.write(resp);
    }, 10);

    await startPromise;
    expect(onPresence).toHaveBeenCalledWith(expect.stringContaining('Confirm user presence'));
    await proc.close();
  });

  it('parses key type and fingerprint from the OpenSSH host key confirmation prompt', () => {
    const info = parseHostKeyPrompt(
      "The authenticity of host 'h (1.2.3.4)' can't be established.\nED25519 key fingerprint is SHA256:abc123+/=.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ",
      { host: 'h', port: 2222, username: 'u', authType: 'password' }
    );
    expect(info).toEqual({
      host: 'h',
      port: 2222,
      keyType: 'ED25519',
      fingerprint: 'SHA256:abc123+/=',
      status: 'unknown',
    });
  });
});
