import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as mockedExecFile } from 'node:child_process';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

function mockSpawnedAgent(socketPath: string, pid: number, delayMs = 0): void {
  vi.mocked(mockedExecFile).mockImplementation(((...args: any[]) => {
    const callback = args[args.length - 1];
    setTimeout(
      () => callback(null, { stdout: `SSH_AUTH_SOCK=${socketPath}; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=${pid}; export SSH_AGENT_PID;\n`, stderr: '' }),
      delayMs
    );
  }) as any);
}

describe('AgentLifecycleManager', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    AgentLifecycleManager._reset();
    process.env = { ...origEnv };
    mockSpawnedAgent('/tmp/default-mock-agent.sock', 99999);
  });

  afterEach(async () => {
    await AgentLifecycleManager.stopManagedAgent();
    process.env = { ...origEnv };
  });

  it('detects active agent when SSH_AUTH_SOCK points to existing file', async () => {
    // Create a temporary dummy socket file
    const tmpDir = os.tmpdir();
    const dummySock = path.join(tmpDir, `test-agent-${Date.now()}.sock`);
    fs.writeFileSync(dummySock, '');

    try {
      process.env.SSH_AUTH_SOCK = dummySock;
      const status = await AgentLifecycleManager.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.socketPath).toBe(dummySock);
      expect(status.isManaged).toBe(false);
    } finally {
      try {
        fs.unlinkSync(dummySock);
      } catch {
        // Ignore
      }
    }
  });

  it('reports not running when SSH_AUTH_SOCK is unset', async () => {
    delete process.env.SSH_AUTH_SOCK;
    const probeSpy = process.platform === 'win32'
      ? vi.spyOn(AgentLifecycleManager, 'probeSocket').mockResolvedValue(false)
      : null;
    try {
      const status = await AgentLifecycleManager.getStatus();
      if (process.platform === 'win32') {
        expect(status.isRunning).toBe(false);
        expect(status.instructions).toContain('Windows OpenSSH Authentication Agent');
      } else {
        expect(status.isRunning).toBe(false);
        expect(status.instructions).toContain('No active ssh-agent detected');
      }
    } finally {
      probeSpy?.mockRestore();
    }
  });

  it('probes listening sockets accurately', async () => {
    const tmpSock = path.join(os.tmpdir(), `probe-test-${Date.now()}.sock`);
    const server = net.createServer();

    try {
      if (process.platform !== 'win32') {
        await new Promise<void>((resolve) => server.listen(tmpSock, () => resolve()));
        const alive = await AgentLifecycleManager.probeSocket(tmpSock);
        expect(alive).toBe(true);
      }

      const nonExistent = await AgentLifecycleManager.probeSocket('/tmp/non-existent-probe-12345.sock');
      expect(nonExistent).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        if (fs.existsSync(tmpSock)) fs.unlinkSync(tmpSock);
      } catch {
        // Ignore
      }
    }
  });

  it('handles ensureAgent on current system', async () => {
    const status = await AgentLifecycleManager.ensureAgent();
    expect(typeof status.isRunning).toBe('boolean');
    expect(typeof status.platform).toBe('string');
    if (status.isRunning) {
      expect(status.socketPath).toBeDefined();
    }
  });

  it('lets concurrent ensureAgent() callers share the same in-flight spawn instead of a stale snapshot', async () => {
    delete process.env.SSH_AUTH_SOCK;
    mockSpawnedAgent('/tmp/managed-agent-race.sock', 4242, 50);

    // Simulates the app's own startup ensureAgent() call racing a local
    // shell tab (restored from session, or opened immediately) that also
    // calls ensureAgent() before the first spawn has resolved.
    const [first, second] = await Promise.all([AgentLifecycleManager.ensureAgent(), AgentLifecycleManager.ensureAgent()]);

    if (process.platform === 'win32') {
      // doEnsureAgent() never spawns on Windows (the shared OpenSSH agent
      // service can't be started on demand) — the race-sharing behavior
      // still applies, it just resolves to the same "not running" snapshot.
      expect(second).toEqual(first);
      expect(mockedExecFile).not.toHaveBeenCalled();
      return;
    }

    expect(first.isRunning).toBe(true);
    expect(first.socketPath).toBe('/tmp/managed-agent-race.sock');
    expect(second).toEqual(first);
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });

  it('cleans up managed agent state on stopManagedAgent', async () => {
    await AgentLifecycleManager.stopManagedAgent();
    expect(AgentLifecycleManager['spawnedPid']).toBeNull();
    expect(AgentLifecycleManager['spawnedSocket']).toBeNull();
  });

  describe('spawnPrivateAgent on Windows', () => {
    it('reuses the shared service pipe (sentinel pid) when it is reachable', async () => {
      if (process.platform !== 'win32') return;
      const spy = vi.spyOn(AgentLifecycleManager, 'probeSocket').mockResolvedValue(true);
      try {
        const result = await AgentLifecycleManager.spawnPrivateAgent();
        expect(result).toEqual({ pid: 0, socketPath: '\\\\.\\pipe\\openssh-ssh-agent' });
      } finally {
        spy.mockRestore();
      }
    });

    it('throws an actionable error when the service pipe is unreachable', async () => {
      if (process.platform !== 'win32') return;
      const spy = vi.spyOn(AgentLifecycleManager, 'probeSocket').mockResolvedValue(false);
      try {
        await expect(AgentLifecycleManager.spawnPrivateAgent()).rejects.toThrow('Set-Service ssh-agent');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('spawnPrivateAgent extraEnv', () => {
    it('merges extraEnv into the spawned ssh-agent process\'s own environment (non-Windows)', async () => {
      if (process.platform === 'win32') return;
      mockSpawnedAgent('/tmp/extra-env-agent.sock', 12345);

      await AgentLifecycleManager.spawnPrivateAgent({ SSH_ASKPASS: '/fake/askpass.sh', SSH_ASKPASS_REQUIRE: 'force' });

      const call = vi.mocked(mockedExecFile).mock.calls[0];
      const options = call[2] as { env?: Record<string, string> };
      expect(options.env?.SSH_ASKPASS).toBe('/fake/askpass.sh');
      expect(options.env?.SSH_ASKPASS_REQUIRE).toBe('force');
      // The rest of this process's own environment must still be present, not replaced by extraEnv alone.
      expect(options.env?.PATH).toBe(process.env.PATH);
    });

    it('spawns with the process\'s own environment, unmodified, when extraEnv is omitted', async () => {
      if (process.platform === 'win32') return;
      mockSpawnedAgent('/tmp/no-extra-env-agent.sock', 12346);

      await AgentLifecycleManager.spawnPrivateAgent();

      const call = vi.mocked(mockedExecFile).mock.calls[0];
      const options = call[2] as { env?: Record<string, string> };
      // Whatever this app process itself inherited for SSH_ASKPASS (e.g. the desktop's own
      // ksshaskpass/gnome-ssh-askpass, or nothing at all) passes through unchanged — this is
      // exactly the "falls back to the desktop's system dialog" case extraEnv exists to override.
      expect(options.env?.SSH_ASKPASS).toBe(process.env.SSH_ASKPASS);
    });
  });

  it('killPrivateAgent no-ops for sentinel/non-owned pids instead of signaling a process group', () => {
    expect(() => AgentLifecycleManager.killPrivateAgent(0)).not.toThrow();
    expect(() => AgentLifecycleManager.killPrivateAgent(-1)).not.toThrow();
  });

  it('tracks spawned private agents and terminates them on killAllPrivateAgents', async () => {
    if (process.platform === 'win32') return;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);

    mockSpawnedAgent('/tmp/agent-1.sock', 54321);
    await AgentLifecycleManager.spawnPrivateAgent();

    mockSpawnedAgent('/tmp/agent-2.sock', 54322);
    await AgentLifecycleManager.spawnPrivateAgent();

    AgentLifecycleManager.killAllPrivateAgents();

    expect(killSpy).toHaveBeenCalledWith(54321, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(54322, 'SIGTERM');

    killSpy.mockRestore();
  });

  it('unloadCard resolves even when the socket/module is unreachable (best-effort)', async () => {
    await expect(
      AgentLifecycleManager.unloadCard('\\\\.\\pipe\\definitely-not-a-real-pipe', 'C:\\nope.dll')
    ).resolves.toBeUndefined();
  });
});
