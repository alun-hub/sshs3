#!/usr/bin/env node
// Reproducible performance baseline for the built app (run `npm run build` first).
// Drives the real renderer -> preload -> main IPC path over CDP with an isolated profile.
//   node scripts/perf-bench.mjs [--out file.json] [--runs 3]
// Scenarios: startup, local PTY flood (IPC message count/throughput + renderer long tasks),
// big local directory listing (storageList over IPC), and 10 000-file listing in the file pane.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron');
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const RUNS = Number(argVal('--runs', '3'));
const OUT = argVal('--out', '');
const CDP_PORT = process.env.CDP_PORT || '9224';

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function runOnce(runIndex) {
  const profile = path.join(os.tmpdir(), `sshs3-bench-${process.pid}-${runIndex}`);
  const bigDir = path.join(os.tmpdir(), `sshs3-bench-files-${process.pid}-${runIndex}`);
  rmSync(profile, { recursive: true, force: true });
  rmSync(bigDir, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  mkdirSync(bigDir, { recursive: true });
  // 10 000 files created inside the renderer's host via a child process is slower than a shell loop.
  await new Promise((resolve, reject) => {
    const p = spawn('bash', ['-c', `cd '${bigDir}' && seq 1 10000 | xargs touch`], { stdio: 'ignore' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('seed failed'))));
  });

  const t0 = Date.now();
  const child = spawn(electronBin, ['--no-sandbox', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '.'], {
    cwd: APP_DIR,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });

  let ws;
  let id = 1;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = id++;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
    return r.result.value;
  };

  try {
    let page;
    while (Date.now() - t0 < 60_000 && !page) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        page = (await res.json()).find((t) => t.type === 'page');
      } catch {
        /* retry */
      }
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    if (!page) throw new Error('no CDP page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    });
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await send('Runtime.enable');

    // Wait for first React render.
    const tPage = Date.now() - t0;
    await evaluate(`new Promise((res) => { const f = () => document.getElementById('root')?.children.length ? res(true) : setTimeout(f, 20); f(); })`);
    const tRendered = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 1500)); // let startup IPC settle
    const startup = await evaluate(`(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), loadEvent: Math.round(nav.loadEventEnd),
        fcp: fcp ? Math.round(fcp.startTime) : null, jsHeapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) };
    })()`);

    // --- Scenario: local PTY flood over the real IPC path
    const flood = await evaluate(`(async () => {
      const long = [];
      const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => long.push(e.duration)));
      po.observe({ entryTypes: ['longtask'] });
      let msgs = 0, bytes = 0, tail = '';
      const { sessionId } = await window.multissh.terminalCreate({ local: true, ptyOptions: { cols: 120, rows: 30 } });
      const done = new Promise((resolve) => {
        const off = window.multissh.onTerminalData((sid, data) => {
          if (sid !== sessionId) return;
          msgs++; bytes += data.length;
          tail = (tail + data).slice(-64);
          if (tail.includes('FLOODEND2')) { off(); resolve(); }
        });
      });
      await new Promise((r) => setTimeout(r, 400));
      const t = performance.now();
      await window.multissh.terminalWrite(sessionId, 'seq 1 400000; echo FLOODEND$((1+1))\\r');
      await Promise.race([done, new Promise((r) => setTimeout(r, 60000))]);
      const ms = performance.now() - t;
      po.disconnect();
      await window.multissh.terminalKill(sessionId);
      return { ms: Math.round(ms), msgs, bytesMB: +(bytes / 1048576).toFixed(2), avgChunk: Math.round(bytes / Math.max(msgs, 1)),
        longTasks: long.length, longTaskTotalMs: Math.round(long.reduce((a, b) => a + b, 0)) };
    })()`);

    // --- Scenario: list a 10 000-file local directory over IPC
    const list = await evaluate(`(async () => {
      await window.multissh.connectStorage?.({ id: 'local', name: 'Local Disk', type: 'local' }).catch(() => {});
      const times = [];
      let n = 0;
      for (let i = 0; i < 3; i++) {
        const t = performance.now();
        const r = await window.multissh.storageList('local', ${JSON.stringify(bigDir)}, true);
        times.push(Math.round(performance.now() - t));
        n = r.length;
      }
      return { entries: n, ms: times };
    })()`);

    return { rendererRenderedMs: tRendered, pageTargetMs: tPage, ...startup, flood, list };
  } finally {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1200));
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    rmSync(profile, { recursive: true, force: true });
    rmSync(bigDir, { recursive: true, force: true });
  }
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  console.error(`run ${i + 1}/${RUNS}...`);
  runs.push(await runOnce(i));
}
const pick = (f) => median(runs.map(f));
const summary = {
  runs: RUNS,
  startup: {
    rendererRenderedMs: pick((r) => r.rendererRenderedMs),
    fcpMs: pick((r) => r.fcp ?? 0),
    domContentLoadedMs: pick((r) => r.domContentLoaded),
    jsHeapMB: pick((r) => r.jsHeapMB),
  },
  ptyFlood: {
    ms: pick((r) => r.flood.ms),
    ipcMessages: pick((r) => r.flood.msgs),
    bytesMB: pick((r) => r.flood.bytesMB),
    avgChunkBytes: pick((r) => r.flood.avgChunk),
    rendererLongTasks: pick((r) => r.flood.longTasks),
    rendererLongTaskTotalMs: pick((r) => r.flood.longTaskTotalMs),
  },
  list10kFiles: { entries: runs[0].list.entries, firstCallMs: pick((r) => r.list.ms[0]), repeatMs: pick((r) => r.list.ms[2]) },
};
console.log(JSON.stringify(summary, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, runs }, null, 2));
