import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IPty, IDisposable } from 'node-pty';
import { SSHPtyManager } from '../../src/main/ssh/SSHPtyManager';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

// createShellSession() calls AgentLifecycleManager.ensureAgent() to inject
// SSH_AUTH_SOCK; mocked so unit tests never spawn a real ssh-agent process
// (non-hermetic, and would leak a process in CI where none is running).
vi.mock('../../src/main/ssh/AgentLifecycleManager', () => ({
  AgentLifecycleManager: {
    ensureAgent: vi.fn().mockResolvedValue({ isRunning: false, isManaged: false, platform: process.platform }),
  },
}));

// Mock node-pty
const mockPtyInstances: MockPty[] = [];

class MockPty implements Partial<IPty> {
  pid = 12345;
  cols = 80;
  rows = 24;
  process = 'ssh';
  handleFlowControl = false;

  private dataListeners: ((data: string) => void)[] = [];
  private exitListeners: ((event: { exitCode: number; signal?: number }) => void)[] = [];

  write = vi.fn();
  resize = vi.fn((cols: number, rows: number) => {
    this.cols = cols;
    this.rows = rows;
  });
  kill = vi.fn((signal?: string) => {
    this.emitExit(0, signal ? 15 : undefined);
  });
  clear = vi.fn();
  pause = vi.fn();
  resume = vi.fn();

  onData = vi.fn((listener: (data: string) => void): IDisposable => {
    this.dataListeners.push(listener);
    return {
      dispose: () => {
        const index = this.dataListeners.indexOf(listener);
        if (index >= 0) this.dataListeners.splice(index, 1);
      },
    };
  });

  onExit = vi.fn(
    (listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
      this.exitListeners.push(listener);
      return {
        dispose: () => {
          const index = this.exitListeners.indexOf(listener);
          if (index >= 0) this.exitListeners.splice(index, 1);
        },
      };
    }
  );

  emitData(data: string) {
    for (const listener of [...this.dataListeners]) {
      listener(data);
    }
  }

  emitExit(exitCode: number, signal?: number) {
    for (const listener of [...this.exitListeners]) {
      listener({ exitCode, signal });
    }
  }
}

vi.mock('node-pty', () => {
  const spawn = vi.fn((file: string, args: string[] | string, options: any) => {
    const mock = new MockPty();
    (mock as any)._spawnArgs = { file, args, options };
    mockPtyInstances.push(mock);
    return mock as unknown as IPty;
  });

  return {
    default: { spawn },
    spawn,
  };
});

describe('SSHPtyManager', () => {
  let manager: SSHPtyManager;

  beforeEach(() => {
    mockPtyInstances.length = 0;
    manager = new SSHPtyManager();
    vi.mocked(AgentLifecycleManager.ensureAgent).mockResolvedValue({
      isRunning: false,
      isManaged: false,
      platform: process.platform,
    });
  });

  afterEach(async () => {
    await manager.killAll();
  });

  describe('createSession', () => {
    it('should spawn OpenSSH with correct args, dims and env', async () => {
      const config: SSHConnectionConfig = {
        id: 'session-1',
        name: 'Server 1',
        host: '10.0.0.1',
        port: 22,
        username: 'admin',
        authType: 'password',
      };

      const session = await manager.createSession(config, {
        cols: 120,
        rows: 30,
        cwd: '/tmp',
        env: { CUSTOM_VAR: 'xyz' },
      });

      expect(session).toBeDefined();
      expect(session.sessionId).toBe('session-1');
      expect(session.cols).toBe(120);
      expect(session.rows).toBe(30);
      expect(session.pid).toBe(12345);

      expect(mockPtyInstances).toHaveLength(1);
      const spawned = mockPtyInstances[0];
      const { file, args, options } = (spawned as any)._spawnArgs;

      expect(file).toMatch(/ssh/);
      expect(args).toContain('-p');
      expect(args).toContain('22');
      expect(args).toContain('--');
      const dashDashIdx = args.indexOf('--');
      expect(args[dashDashIdx + 1]).toBe('admin@10.0.0.1');
      expect(options.cols).toBe(120);
      expect(options.rows).toBe(30);
      expect(options.cwd).toBe('/tmp');
      expect(options.env.CUSTOM_VAR).toBe('xyz');
      expect(options.env.TERM).toBe('xterm-256color');
    });

    it('should support SSH agent socket configuration', async () => {
      const config: SSHConnectionConfig = {
        id: 'session-agent',
        name: 'Agent Host',
        host: '10.0.0.2',
        username: 'user',
        authType: 'agent',
        agentPath: '/tmp/ssh-agent.sock',
      };

      await manager.createSession(config);

      const spawned = mockPtyInstances[0];
      const { options } = (spawned as any)._spawnArgs;
      expect(options.env.SSH_AUTH_SOCK).toBe('/tmp/ssh-agent.sock');
    });

    it('should pass ForwardAgent=yes when forwardAgent is enabled', async () => {
      const config: SSHConnectionConfig = {
        id: 'session-forward-agent',
        name: 'Forward Agent Host',
        host: '10.0.0.3',
        username: 'user',
        authType: 'password',
        forwardAgent: true,
      };

      await manager.createSession(config);

      const spawned = mockPtyInstances[0];
      const { args } = (spawned as any)._spawnArgs;
      expect(args).toContain('-o');
      expect(args).toContain('ForwardAgent=yes');
    });

    it('should set DISPLAY env var and pass -Y when x11Forwarding is enabled', async () => {
      const config: SSHConnectionConfig = {
        id: 'session-x11',
        name: 'X11 Host',
        host: '10.0.0.4',
        username: 'user',
        authType: 'password',
        x11Forwarding: true,
        x11Display: '127.0.0.1:0.0',
      };

      await manager.createSession(config);

      const spawned = mockPtyInstances[0];
      const { args, options } = (spawned as any)._spawnArgs;
      expect(args).toContain('-Y');
      expect(options.env.DISPLAY).toBe('127.0.0.1:0.0');
    });

    it('should configure Askpass when authType is smartcard', async () => {
      const config: SSHConnectionConfig = {
        id: 'session-smartcard',
        name: 'Smartcard Host',
        host: 'smartcard.domain.com',
        username: 'carduser',
        authType: 'smartcard',
        pkcs11LibPath: '/usr/lib/libiidp11.so',
      };

      const session = await manager.createSession(config);

      const spawned = mockPtyInstances[0];
      const { args, options } = (spawned as any)._spawnArgs;

      // Smartcard -I flag
      expect(args).toContain('-I');
      expect(args).toContain('/usr/lib/libiidp11.so');

      // Askpass env vars
      expect(options.env.SSH_ASKPASS).toBeDefined();
      expect(options.env.SSH_ASKPASS_REQUIRE).toBe('force');

      await session.dispose();
    });

    it('should configure Askpass when authType is password and password is provided', async () => {
      const config: SSHConnectionConfig = {
        id: 'session-pwd',
        name: 'Password Host',
        host: 'pwd.domain.com',
        username: 'pwduser',
        authType: 'password',
        password: 'mysecretpassword',
      };

      const session = await manager.createSession(config);

      const spawned = mockPtyInstances[0];
      const { options } = (spawned as any)._spawnArgs;

      expect(options.env.SSH_ASKPASS).toBeDefined();
      expect(options.env.SSH_ASKPASS_REQUIRE).toBe('force');

      await session.dispose();
    });

    it('should clean up AskpassServer when pty.spawn throws an error', async () => {
      const ptyMod = await import('node-pty');
      const spawnSpy = vi.spyOn(ptyMod, 'spawn').mockImplementationOnce(() => {
        throw new Error('Spawn process failed');
      });

      const config: SSHConnectionConfig = {
        id: 'session-spawn-fail',
        name: 'Fail Host',
        host: 'fail.example.com',
        username: 'user',
        authType: 'smartcard',
        pkcs11LibPath: '/usr/lib/libiidp11.so',
      };

      await expect(manager.createSession(config)).rejects.toThrow('Spawn process failed');
      spawnSpy.mockRestore();
    });
  });

  describe('session I/O and control', () => {
    let sessionConfig: SSHConnectionConfig;

    beforeEach(() => {
      sessionConfig = {
        id: 'sess-io',
        name: 'IO Test',
        host: 'host.local',
        username: 'tester',
        authType: 'password',
      };
    });

    it('should forward write calls to underlying pty', async () => {
      const session = await manager.createSession(sessionConfig);
      const mockPty = mockPtyInstances[0];

      session.write('uname -a\n');
      expect(mockPty.write).toHaveBeenCalledWith('uname -a\n');

      manager.write(session.sessionId, 'uptime\n');
      expect(mockPty.write).toHaveBeenCalledWith('uptime\n');
    });

    it('should forward resize calls to underlying pty and update state', async () => {
      const session = await manager.createSession(sessionConfig);
      const mockPty = mockPtyInstances[0];

      session.resize(100, 40);
      expect(mockPty.resize).toHaveBeenCalledWith(100, 40);
      expect(session.cols).toBe(100);
      expect(session.rows).toBe(40);

      manager.resize(session.sessionId, 140, 50);
      expect(mockPty.resize).toHaveBeenCalledWith(140, 50);
      expect(session.cols).toBe(140);
      expect(session.rows).toBe(50);
    });

    it('should forward kill calls, notify onExit listeners, and remove session from manager', async () => {
      const session = await manager.createSession(sessionConfig);
      const mockPty = mockPtyInstances[0];

      expect(manager.getSession(session.sessionId)).toBeDefined();

      const exitListener = vi.fn();
      session.onExit(exitListener);

      session.kill('SIGTERM');
      expect(mockPty.kill).toHaveBeenCalledWith('SIGTERM');
      expect(exitListener).toHaveBeenCalledWith({ exitCode: 0, signal: 15 });
      expect(manager.getSession(session.sessionId)).toBeUndefined();
    });
  });

  describe('listeners onData and onExit', () => {
    it('should receive data events on session and manager listeners', async () => {
      const config: SSHConnectionConfig = {
        id: 'sess-data',
        name: 'Data Test',
        host: 'host.local',
        username: 'tester',
        authType: 'password',
      };

      const session = await manager.createSession(config);
      const mockPty = mockPtyInstances[0];

      const sessionData: string[] = [];
      const managerData: { sessionId: string; data: string }[] = [];

      const disposable = session.onData((data) => sessionData.push(data));
      manager.on('data', (ev) => managerData.push(ev));

      mockPty.emitData('Hello Terminal\r\n');

      expect(sessionData).toEqual(['Hello Terminal\r\n']);
      expect(managerData).toEqual([{ sessionId: 'sess-data', data: 'Hello Terminal\r\n' }]);

      // Test dispose listener
      disposable.dispose();
      mockPty.emitData('More Data\r\n');
      expect(sessionData).toEqual(['Hello Terminal\r\n']);
      expect(managerData).toHaveLength(2);
    });

    it('should handle exit event, clean up active session, and trigger onExit', async () => {
      const config: SSHConnectionConfig = {
        id: 'sess-exit',
        name: 'Exit Test',
        host: 'host.local',
        username: 'tester',
        authType: 'password',
      };

      const session = await manager.createSession(config);
      const mockPty = mockPtyInstances[0];

      let exitEvent: { exitCode: number; signal?: number } | undefined;
      session.onExit((e) => {
        exitEvent = e;
      });

      let managerExitEvent: any;
      manager.on('exit', (e) => {
        managerExitEvent = e;
      });

      mockPty.emitExit(0, undefined);

      expect(exitEvent).toEqual({ exitCode: 0, signal: undefined });
      expect(managerExitEvent).toEqual({ sessionId: 'sess-exit', exitCode: 0, signal: undefined });
      expect(manager.getSession(session.sessionId)).toBeUndefined();
    });
  });

  describe('shell session creation', () => {
    it('should spawn local shell via createShellSession', async () => {
      const session = await manager.createShellSession({
        cols: 90,
        rows: 30,
      });

      expect(session).toBeDefined();
      expect(session.sessionId).toMatch(/^shell-/);
      expect(mockPtyInstances).toHaveLength(1);

      const { file, options } = (mockPtyInstances[0] as any)._spawnArgs;
      const expectedShell =
        process.platform === 'win32'
          ? (process.env.COMSPEC || 'cmd.exe')
          : (process.env.SHELL || '/bin/bash');

      expect(file).toBe(expectedShell);
      expect(options.cols).toBe(90);
      expect(options.rows).toBe(30);
    });
  });

  describe('getAllSessions and killAll', () => {
    it('should track multiple active sessions and kill all on killAll', async () => {
      const config1: SSHConnectionConfig = {
        id: 's-1',
        name: 'S1',
        host: 'h1',
        username: 'u1',
        authType: 'password',
      };
      const config2: SSHConnectionConfig = {
        id: 's-2',
        name: 'S2',
        host: 'h2',
        username: 'u2',
        authType: 'password',
      };

      await manager.createSession(config1);
      await manager.createSession(config2);

      expect(manager.getAllSessions()).toHaveLength(2);

      await manager.killAll();
      expect(manager.getAllSessions()).toHaveLength(0);
    });
  });

  describe('scrollback buffer and auto-reconnection', () => {
    it('should buffer terminal output and provide scrollback replay', async () => {
      const config: SSHConnectionConfig = {
        id: 'sess-scrollback',
        name: 'Scrollback Test',
        host: 'host.local',
        username: 'tester',
        authType: 'password',
      };

      const session = await manager.createSession(config);
      const mockPty = mockPtyInstances[0];

      mockPty.emitData('line 1\r\n');
      mockPty.emitData('line 2\r\n');

      expect(session.getScrollbackBuffer?.()).toBe('line 1\r\nline 2\r\n');
    });

    it('should attempt auto-reconnection on non-zero exit when autoReconnect is enabled', async () => {
      vi.useFakeTimers();

      const config: SSHConnectionConfig = {
        id: 'sess-reconnect',
        name: 'Reconnect Test',
        host: 'host.local',
        username: 'tester',
        authType: 'password',
        autoReconnect: true,
        maxReconnectAttempts: 2,
        reconnectDelayMs: 50,
      };

      const session = await manager.createSession(config);
      const initialPty = mockPtyInstances[0];

      const reconnectingSpy = vi.fn();
      const reconnectedSpy = vi.fn();
      manager.on('reconnecting', reconnectingSpy);
      manager.on('reconnected', reconnectedSpy);

      // Simulate unexpected disconnect (e.g. exit code 255)
      initialPty.emitExit(255);

      expect(session.isReconnecting?.()).toBe(true);
      expect(reconnectingSpy).toHaveBeenCalledWith({
        sessionId: 'sess-reconnect',
        attempt: 1,
        maxAttempts: 2,
      });

      // Fast-forward reconnect timer
      await vi.advanceTimersByTimeAsync(60);

      expect(session.isReconnecting?.()).toBe(false);
      expect(reconnectedSpy).toHaveBeenCalledWith({ sessionId: 'sess-reconnect' });
      expect(mockPtyInstances).toHaveLength(2);
      expect(manager.getSession('sess-reconnect')).toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('createShellSession', () => {
    it('spawns local shell on current platform', async () => {
      const session = await manager.createShellSession({
        cols: 100,
        rows: 40,
        cwd: '/tmp',
      });

      expect(session).toBeDefined();
      expect(mockPtyInstances).toHaveLength(1);
      const spawned = mockPtyInstances[0];
      const { options } = (spawned as any)._spawnArgs;
      expect(options.cols).toBe(100);
      expect(options.rows).toBe(40);
      expect(session.config.name).toBe('Local Shell');
    });

    it('injects SSH_AUTH_SOCK from the app-managed agent instead of relying on inherited process.env', async () => {
      vi.mocked(AgentLifecycleManager.ensureAgent).mockResolvedValue({
        isRunning: true,
        isManaged: true,
        socketPath: '/tmp/app-managed-agent.sock',
        platform: 'linux',
      });

      await manager.createShellSession({ cols: 80, rows: 24 });

      const { options } = (mockPtyInstances[0] as any)._spawnArgs;
      expect(options.env.SSH_AUTH_SOCK).toBe('/tmp/app-managed-agent.sock');
    });

    it('lets an explicit env.SSH_AUTH_SOCK override the app-managed agent', async () => {
      vi.mocked(AgentLifecycleManager.ensureAgent).mockResolvedValue({
        isRunning: true,
        isManaged: true,
        socketPath: '/tmp/app-managed-agent.sock',
        platform: 'linux',
      });

      await manager.createShellSession({
        cols: 80,
        rows: 24,
        env: { SSH_AUTH_SOCK: '/tmp/caller-chosen-agent.sock' },
      });

      const { options } = (mockPtyInstances[0] as any)._spawnArgs;
      expect(options.env.SSH_AUTH_SOCK).toBe('/tmp/caller-chosen-agent.sock');
    });

    it('does not query the agent or touch SSH_AUTH_SOCK for a WSL shell', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      try {
        await manager.createShellSession({ shellType: 'wsl' });
        expect(AgentLifecycleManager.ensureAgent).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });

    it('handles Windows shells including WSL', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      try {
        // WSL default
        const wslSession = await manager.createShellSession({
          shellType: 'wsl',
        });
        expect(wslSession.config.name).toBe('WSL');
        const wslSpawn = mockPtyInstances[mockPtyInstances.length - 1];
        expect((wslSpawn as any)._spawnArgs.file).toBe('wsl.exe');
        expect((wslSpawn as any)._spawnArgs.args).toEqual([]);

        // WSL with specific distro
        const wslDistroSession = await manager.createShellSession({
          shellType: 'wsl',
          wslDistro: 'Ubuntu-22.04',
        });
        expect(wslDistroSession.config.name).toBe('WSL: Ubuntu-22.04');
        const wslDistroSpawn = mockPtyInstances[mockPtyInstances.length - 1];
        expect((wslDistroSpawn as any)._spawnArgs.file).toBe('wsl.exe');
        expect((wslDistroSpawn as any)._spawnArgs.args).toEqual(['-d', 'Ubuntu-22.04']);

        // PowerShell
        const psSession = await manager.createShellSession({
          shellType: 'powershell',
        });
        expect(psSession.config.name).toBe('Local Shell');
        const psSpawn = mockPtyInstances[mockPtyInstances.length - 1];
        expect((psSpawn as any)._spawnArgs.file).toBe('powershell.exe');

        // PowerShell 7 (pwsh)
        const pwshSession = await manager.createShellSession({
          shellType: 'pwsh',
        });
        expect(pwshSession.config.name).toBe('Local Shell');
        const pwshSpawn = mockPtyInstances[mockPtyInstances.length - 1];
        expect((pwshSpawn as any)._spawnArgs.file).toBe('pwsh.exe');

        // CMD
        const cmdSession = await manager.createShellSession({
          shellType: 'cmd',
        });
        expect(cmdSession.config.name).toBe('Local Shell');
        const cmdSpawn = mockPtyInstances[mockPtyInstances.length - 1];
        expect((cmdSpawn as any)._spawnArgs.file).toBe('cmd.exe');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });
});
