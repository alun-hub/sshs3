import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';

describe('AgentLifecycleManager', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    AgentLifecycleManager._reset();
    process.env = { ...origEnv };
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
    const status = await AgentLifecycleManager.getStatus();
    if (process.platform === 'win32') {
      expect(status.isRunning).toBe(false);
      expect(status.instructions).toContain('Windows OpenSSH Authentication Agent');
    } else {
      expect(status.isRunning).toBe(false);
      expect(status.instructions).toContain('No active ssh-agent detected');
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

  it('cleans up managed agent state on stopManagedAgent', async () => {
    await AgentLifecycleManager.stopManagedAgent();
    expect(AgentLifecycleManager['spawnedPid']).toBeNull();
    expect(AgentLifecycleManager['spawnedSocket']).toBeNull();
  });
});
