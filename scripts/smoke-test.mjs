#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
const PROFILE_DIR = process.env.TEST_PROFILE_DIR || path.join('/tmp', `sshs3-smoke-${Date.now()}`);
const CDP_PORT = process.env.CDP_PORT || '9223';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 30_000;

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(PROFILE_DIR, { recursive: true });

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron');

let child = null;
let ws = null;
let msgId = 1;
const pending = new Map();
const consoleErrors = [];

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const result = await cdpSend('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error('Evaluation exception: ' + JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function cleanup() {
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  if (child) {
    try {
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 3000);
        child.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } catch {
      // ignore
    }
    child = null;
  }
  try {
    rmSync(PROFILE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function run() {
  console.log(`[smoke-test] Starting Electron with isolated profile: ${PROFILE_DIR} on CDP port ${CDP_PORT}...`);

  const spawnArgs = [
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '.',
  ];

  child = spawn(electronBin, spawnArgs, {
    cwd: APP_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  child.stdout.on('data', (d) => {
    const s = d.toString('utf-8');
    if (process.env.VERBOSE) process.stdout.write(`[electron stdout] ${s}`);
  });

  child.stderr.on('data', (d) => {
    const s = d.toString('utf-8');
    if (s.includes('Uncaught') || s.includes('UnhandledPromiseRejection')) {
      consoleErrors.push(s);
    }
    if (process.env.VERBOSE) process.stderr.write(`[electron stderr] ${s}`);
  });

  // Poll for CDP endpoint
  const startTime = Date.now();
  const deadline = startTime + TIMEOUT_MS;
  let page = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        page = targets.find((t) => t.type === 'page');
        if (page) break;
      }
    } catch {
      // Retry after short delay
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!page) {
    throw new Error(`Timed out waiting for Electron CDP page target (${TIMEOUT_MS}ms)`);
  }

  console.log(`[smoke-test] Page target connected: ${page.url}`);

  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      const text = msg.params.args?.map((a) => a.value || a.description || '').join(' ');
      if (text) consoleErrors.push(text);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  // Enable Runtime to catch console messages
  await cdpSend('Runtime.enable');

  // Wait for document and #root
  console.log('[smoke-test] Verifying DOM readiness...');
  let rootFound = false;
  const domDeadline = Date.now() + 15_000;

  while (Date.now() < domDeadline) {
    const readyState = await evalJs('document.readyState');
    const childCount = await evalJs('document.querySelector("#root")?.children.length || 0');
    if (readyState === 'complete' && childCount > 0) {
      rootFound = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!rootFound) {
    throw new Error('Timed out waiting for #root element to render content');
  }

  // Check for app UI elements
  const pageTitle = await evalJs('document.title');
  const hasAppSurface = await evalJs('Boolean(document.querySelector(".app-surface, [data-testid], button, nav"))');
  console.log(`[smoke-test] Page title: "${pageTitle}", UI surface detected: ${hasAppSurface}`);

  // Take screenshot
  const shotPath = path.join(SHOT_DIR, 'smoke-test.png');
  const { data } = await cdpSend('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shotPath, Buffer.from(data, 'base64'));
  console.log(`[smoke-test] Screenshot saved: ${shotPath}`);

  // Check fatal errors
  const fatalErrors = consoleErrors.filter(
    (e) => !e.includes('GPU process exited') && !e.includes('libva error') && !e.includes('mesa')
  );

  if (fatalErrors.length > 0) {
    console.warn('[smoke-test] Warnings / errors captured in console:');
    for (const err of fatalErrors) {
      console.warn(`  - ${err}`);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[smoke-test] SUCCESS: App launched, rendered UI, and captured screenshot in ${elapsed}ms!`);
}

run()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`[smoke-test] FAILED: ${err.message}`);
    await cleanup();
    process.exit(1);
  });
