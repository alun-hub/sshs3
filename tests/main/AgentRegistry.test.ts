import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as AgentRegistry from '../../src/main/ssh/AgentRegistry';

/** Returns a PID that is guaranteed to no longer be alive. */
function deadPid(): number {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  const pid = result.pid;
  if (!pid) throw new Error('Failed to obtain a pid for the dead-process fixture');
  return pid;
}

describe('AgentRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-registry-test-'));
    AgentRegistry.configureRegistryDir(dir);
  });

  afterEach(async () => {
    AgentRegistry._resetRegistryDir();
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('is a no-op before configureRegistryDir has been called', async () => {
    AgentRegistry._resetRegistryDir();
    const id = await AgentRegistry.registerEntry({
      kind: 'agent',
      ownerPid: process.pid,
      pid: 123,
      createdAt: new Date().toISOString(),
    });
    expect(id).toBeNull();
    await expect(AgentRegistry.unregisterEntry(id)).resolves.toBeUndefined();
    await expect(
      AgentRegistry.cleanupOrphans({ onOrphanAgent: () => {}, onOrphanAskpass: () => {} })
    ).resolves.toBeUndefined();
  });

  it('registers an entry as a file on disk and unregisters removes it', async () => {
    const id = await AgentRegistry.registerEntry({
      kind: 'agent',
      ownerPid: process.pid,
      pid: 4242,
      createdAt: new Date().toISOString(),
    });
    expect(id).toBeTruthy();
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);

    await AgentRegistry.unregisterEntry(id);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('leaves entries owned by a still-alive process untouched', async () => {
    await AgentRegistry.registerEntry({
      kind: 'agent',
      ownerPid: process.pid, // this test process is alive
      pid: 4242,
      createdAt: new Date().toISOString(),
    });

    const orphanedAgents: number[] = [];
    await AgentRegistry.cleanupOrphans({
      onOrphanAgent: (pid) => { orphanedAgents.push(pid); },
      onOrphanAskpass: () => {},
    });

    expect(orphanedAgents).toEqual([]);
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it('cleans up an orphaned agent entry whose owner process has died', async () => {
    const owner = deadPid();
    await AgentRegistry.registerEntry({
      kind: 'agent',
      ownerPid: owner,
      pid: 9999,
      createdAt: new Date().toISOString(),
    });

    const orphanedAgents: number[] = [];
    await AgentRegistry.cleanupOrphans({
      onOrphanAgent: (pid) => { orphanedAgents.push(pid); },
      onOrphanAskpass: () => {},
    });

    expect(orphanedAgents).toEqual([9999]);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('cleans up an orphaned askpass tempdir entry whose owner process has died', async () => {
    const owner = deadPid();
    await AgentRegistry.registerEntry({
      kind: 'askpass',
      ownerPid: owner,
      tempDir: '/tmp/sshs3-askpass-fixture',
      createdAt: new Date().toISOString(),
    });

    const orphanedDirs: string[] = [];
    await AgentRegistry.cleanupOrphans({
      onOrphanAgent: () => {},
      onOrphanAskpass: (tempDir) => {
        orphanedDirs.push(tempDir);
      },
    });

    expect(orphanedDirs).toEqual(['/tmp/sshs3-askpass-fixture']);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('cleans up an orphaned ssh-mux socket entry whose owner process has died', async () => {
    const owner = deadPid();
    await AgentRegistry.registerEntry({
      kind: 'ssh-mux',
      ownerPid: owner,
      controlPath: '/tmp/s3m-fixture.sock',
      host: 'example.com',
      createdAt: new Date().toISOString(),
    });

    const orphanedMux: { controlPath: string; host: string }[] = [];
    await AgentRegistry.cleanupOrphans({
      onOrphanAgent: () => {},
      onOrphanAskpass: () => {},
      onOrphanSshMux: (controlPath, host) => {
        orphanedMux.push({ controlPath, host });
      },
    });

    expect(orphanedMux).toEqual([{ controlPath: '/tmp/s3m-fixture.sock', host: 'example.com' }]);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('removes malformed registry files instead of leaving them forever', async () => {
    fs.writeFileSync(path.join(dir, 'garbage.json'), 'not json', 'utf-8');

    await AgentRegistry.cleanupOrphans({ onOrphanAgent: () => {}, onOrphanAskpass: () => {} });

    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});
