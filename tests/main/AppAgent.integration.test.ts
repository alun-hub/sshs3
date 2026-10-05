import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppAgent } from '../../src/main/ssh/AppAgent';

const hasSshAgent =
  process.platform !== 'win32' &&
  !spawnSync('ssh-agent', ['-k'], { stdio: 'ignore' }).error &&
  !spawnSync('ssh-add', ['-l'], { stdio: 'ignore' }).error;

describe.skipIf(!hasSshAgent)('AppAgent with a real ssh-agent', () => {
  const origRuntimeDir = process.env.XDG_RUNTIME_DIR;
  let runtimeDir: string;

  beforeAll(() => {
    runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-it-'));
    process.env.XDG_RUNTIME_DIR = runtimeDir;
  });

  afterAll(() => {
    if (origRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = origRuntimeDir;
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });

  it('starts on a private socket, answers ssh-add -l, locks and shuts down cleanly', async () => {
    const agent = new AppAgent();
    const sock = await agent.ensure();

    expect(fs.statSync(path.dirname(sock)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(sock).mode & 0o077).toBe(0);
    expect(spawnSync('ssh-add', ['-l'], { env: { ...process.env, SSH_AUTH_SOCK: sock } }).stdout.toString()).toMatch(
      /no identities/i
    );
    expect(await agent.list()).toEqual([]);

    await agent.lockAll();
    expect(agent.getSocketPath()).toBe(sock);

    await agent.shutdown();
    expect(fs.existsSync(sock)).toBe(false);
  });
});
