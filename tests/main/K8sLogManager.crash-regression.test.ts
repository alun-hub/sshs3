import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Deliberately runs in a spawned child process against a REAL (unmocked)
 * `@kubernetes/client-node`: the bug this guards against only exists in the
 * real `Log.log()` implementation, which pipes a fetch response body into
 * our output stream via a raw `.pipe()` call. Aborting that fetch (as
 * `K8sLogManager.stop()` does) makes the internal, unreachable source stream
 * emit an 'error' with zero listeners — a fatal uncaught exception that
 * crashed the Electron main process (see `abortWithoutCrashing` in
 * K8sLogManager.ts). This can only be observed as a real process crash (a
 * mocked client-node never exercises it, and adding our own
 * `uncaughtException` listener in-process would itself mask the very crash
 * we're checking for), so the child process's exit code is the assertion.
 */
describe('K8sLogManager crash regression (unmocked @kubernetes/client-node, child process)', () => {
  let server: http.Server | undefined;
  let kubeconfigPath: string | undefined;
  let scriptPath: string | undefined;

  afterEach(() => {
    server?.close();
    if (kubeconfigPath) fs.rmSync(kubeconfigPath, { force: true });
    if (scriptPath) fs.rmSync(scriptPath, { force: true });
  });

  it('stopping a followed log stream does not crash the process when the fetch is aborted mid-stream', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const interval = setInterval(() => res.write('log line\n'), 20);
      res.on('close', () => clearInterval(interval));
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    kubeconfigPath = path.join(os.tmpdir(), `k8s-log-crash-test-${Date.now()}.yaml`);
    fs.writeFileSync(
      kubeconfigPath,
      [
        'apiVersion: v1',
        'kind: Config',
        'clusters:',
        '- name: test',
        '  cluster:',
        `    server: http://127.0.0.1:${port}`,
        '    insecure-skip-tls-verify: true',
        'contexts:',
        '- name: test',
        '  context:',
        '    cluster: test',
        '    user: test',
        'users:',
        '- name: test',
        '  user: {}',
        'current-context: test',
        '',
      ].join('\n')
    );

    // A child process with NO uncaughtException listener of its own: if
    // K8sLogManager's guard is broken or removed, Node's default behavior
    // (print "Uncaught Exception" and exit non-zero) is exactly what would
    // reproduce the "error window" the user saw in the packaged app.
    scriptPath = path.join(os.tmpdir(), `k8s-log-crash-test-${Date.now()}.mjs`);
    const managerPath = path.resolve(__dirname, '../../src/main/terminal/K8sLogManager.ts');
    const managerUrl = pathToFileURL(managerPath).href;
    fs.writeFileSync(
      scriptPath,
      [
        `import { K8sLogManager } from ${JSON.stringify(managerUrl)};`,
        `const manager = new K8sLogManager(${JSON.stringify(kubeconfigPath)});`,
        `const sessionId = await manager.startFollow({ contextName: 'test', namespace: 'default', podName: 'pod', containerName: 'c' });`,
        `await new Promise((r) => setTimeout(r, 100));`,
        `const ended = new Promise((resolve) => manager.once('end', resolve));`,
        `manager.stop(sessionId);`,
        `await ended;`,
        `await new Promise((r) => setTimeout(r, 150));`,
        `console.log('OK');`,
        `process.exit(0);`,
      ].join('\n')
    );

    const child = spawn(process.execPath, [require.resolve('tsx/cli'), scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    const exitCode = await new Promise<number | null>((resolve) => child.on('close', resolve));

    expect(stderr).not.toMatch(/uncaught|unhandled/i);
    expect(stdout).toContain('OK');
    expect(exitCode).toBe(0);
  }, 15000);
});
