import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IPty, IDisposable } from 'node-pty';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Mirrors the mock-node-pty pattern already used in SSHPtyManager.test.ts: a minimal fake
// IPty that lets tests drive onData/onExit manually and assert on write()/kill() calls.
const mockPtyInstances: MockPty[] = [];

class MockPty implements Partial<IPty> {
  pid = 999;
  cols = 120;
  rows = 30;

  write = vi.fn();
  kill = vi.fn();

  private dataListeners: ((data: string) => void)[] = [];
  private exitListeners: ((event: { exitCode: number; signal?: number }) => void)[] = [];

  onData = vi.fn((listener: (data: string) => void): IDisposable => {
    this.dataListeners.push(listener);
    return { dispose: () => {} };
  });

  onExit = vi.fn((listener: (event: { exitCode: number; signal?: number }) => void): IDisposable => {
    this.exitListeners.push(listener);
    return { dispose: () => {} };
  });

  emitData(data: string) {
    for (const l of [...this.dataListeners]) l(data);
  }

  emitExit(exitCode: number) {
    for (const l of [...this.exitListeners]) l({ exitCode });
  }
}

vi.mock('node-pty', () => {
  const spawn = vi.fn(() => {
    const mock = new MockPty();
    mockPtyInstances.push(mock);
    return mock as unknown as IPty;
  });
  return { default: { spawn }, spawn };
});

import {
  runAgeCommandViaPty,
  createFifo,
  readFifoOnce,
  removeFifo,
  TeamVaultWrongPinError,
  TeamVaultDefaultCredentialsError,
  type AgePtyPromptCallbacks,
} from '../../src/main/services/AgePtyPinRelay';

function makeCallbacks(pins: string[]): AgePtyPromptCallbacks & { calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  return {
    calls,
    requestPin: vi.fn(async (prompt: string, retry?: unknown) => {
      calls.push({ prompt, retry });
      const pin = pins[i] ?? pins[pins.length - 1];
      i += 1;
      return pin;
    }),
    onTouchRequested: vi.fn(),
    onTouchCleared: vi.fn(),
  };
}

describe('runAgeCommandViaPty', () => {
  beforeEach(() => {
    mockPtyInstances.length = 0;
  });

  it('shows the touch hint immediately on spawn (before any PIN prompt), and relays the PIN prompt without the "(default is ...)" hint', async () => {
    const callbacks = makeCallbacks(['123456']);
    const promise = runAgeCommandViaPty('age', ['-d', '-i', '/tmp/identity.txt'], process.env, callbacks);
    const term = mockPtyInstances[0];

    // Shown unconditionally from the start — there's no reliable textual signal for exactly when
    // a touch will be needed: `age -d`'s plugin-protocol mode prints no touch prompt at all
    // (unlike `--generate`'s own CLI mode), and a cached PIN means there may be no PIN prompt
    // either to key a hint off of (found via real-world use — see docs/team-vault-plan.md).
    expect(callbacks.onTouchRequested).toHaveBeenCalledTimes(1);
    expect(callbacks.onTouchCleared).not.toHaveBeenCalled();

    term.emitData('Enter PIN for YubiKey with serial 20185052 (default is 123456): ');
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks.requestPin).toHaveBeenCalledTimes(1);
    // "(default is 123456)" is just fixed CLI wording, not a real signal the card is on a
    // default PIN — confusing to show in the UI, so it's stripped before reaching the modal.
    expect(callbacks.requestPin).toHaveBeenCalledWith('Enter PIN for YubiKey with serial 20185052:', undefined);
    expect(term.write).toHaveBeenCalledWith('123456\r');
    expect(callbacks.onTouchRequested).toHaveBeenCalledTimes(1); // still just once

    term.emitData('# Recipient: age1yubikey1test\r\nAGE-PLUGIN-YUBIKEY-1TEST\r\n');
    expect(callbacks.onTouchCleared).not.toHaveBeenCalled(); // only clears once the op concludes

    term.emitExit(0);
    const result = await promise;
    expect(result).toContain('AGE-PLUGIN-YUBIKEY-1TEST');
    expect(callbacks.onTouchCleared).toHaveBeenCalledTimes(1);
  });

  it('shows and clears the touch hint even when no PIN prompt occurs at all (PIN cached on the card)', async () => {
    const callbacks = makeCallbacks([]);
    const promise = runAgeCommandViaPty('age', ['-d', '-i', '/tmp/identity.txt'], process.env, callbacks);
    const term = mockPtyInstances[0];

    expect(callbacks.onTouchRequested).toHaveBeenCalledTimes(1);
    expect(callbacks.requestPin).not.toHaveBeenCalled();

    term.emitExit(0);
    await promise;
    expect(callbacks.onTouchCleared).toHaveBeenCalledTimes(1);
  });

  it('re-fires the touch hint periodically while the operation is still running, so a long PIN-entry pause does not let the UI banner expire early', async () => {
    // Found via real-world use: the renderer's touch banner has its own 4s fallback auto-hide
    // (TouchPresenceBanner.tsx). Typing a PIN into the modal routinely takes longer than that,
    // so without a periodic re-fire the banner vanished long before the real touch moment.
    vi.useFakeTimers();
    try {
      const callbacks = makeCallbacks(['123456']);
      const promise = runAgeCommandViaPty('age', ['-d', '-i', '/tmp/identity.txt'], process.env, callbacks);
      const term = mockPtyInstances[0];

      expect(callbacks.onTouchRequested).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect(vi.mocked(callbacks.onTouchRequested).mock.calls.length).toBeGreaterThan(1);

      term.emitData('Enter PIN for YubiKey with serial 20185052: ');
      await Promise.resolve();
      await Promise.resolve();
      term.emitExit(0);
      await promise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries after a wrong PIN, forwarding the remaining-tries count, then succeeds', async () => {
    const callbacks = makeCallbacks(['000000', '123456']);
    const promise = runAgeCommandViaPty('age', ['-d', '-i', '/tmp/identity.txt'], process.env, callbacks);
    const term = mockPtyInstances[0];

    term.emitData('Enter PIN for YubiKey with serial 20185052: ');
    await Promise.resolve();
    await Promise.resolve();
    expect(term.write).toHaveBeenNthCalledWith(1, '000000\r');

    term.emitData('Error: Invalid PIN (2 tries remaining before it is blocked)\r\n');
    await Promise.resolve();
    await Promise.resolve();

    expect(callbacks.requestPin).toHaveBeenCalledTimes(2);
    expect(callbacks.calls[1]).toMatchObject({ retry: { attempt: 2, maxAttempts: 3 } });
    expect(term.write).toHaveBeenNthCalledWith(2, '123456\r');

    term.emitData('# Recipient: age1yubikey1test\r\n');
    term.emitExit(0);
    await promise;
  });

  it('rejects with TeamVaultWrongPinError once PIV tries are exhausted, never retrying further', async () => {
    const callbacks = makeCallbacks(['1', '2', '3']);
    const promise = runAgeCommandViaPty('age', ['-d', '-i', '/tmp/identity.txt'], process.env, callbacks);
    const term = mockPtyInstances[0];

    term.emitData('Enter PIN for YubiKey with serial 20185052: ');
    await Promise.resolve();
    await Promise.resolve();
    term.emitData('Error: Invalid PIN (0 tries remaining before it is blocked)\r\n');
    term.emitExit(1);

    await expect(promise).rejects.toBeInstanceOf(TeamVaultWrongPinError);
    expect(callbacks.requestPin).toHaveBeenCalledTimes(1);
  });

  it('aborts immediately on a default-PIN/PUK migration wizard prompt, never writing anything to the pty', async () => {
    const callbacks = makeCallbacks(['123456']);
    const promise = runAgeCommandViaPty('age-plugin-yubikey', ['--generate'], process.env, callbacks);
    const term = mockPtyInstances[0];

    term.emitData('Enter PIN for YubiKey with serial 20185052 (default is 123456): ');
    await Promise.resolve();
    await Promise.resolve();
    term.write.mockClear();

    term.emitData('Please choose a new PIN: ');

    await expect(promise).rejects.toBeInstanceOf(TeamVaultDefaultCredentialsError);
    expect(term.kill).toHaveBeenCalled();
    expect(term.write).not.toHaveBeenCalled();
  });

  it('kills the pty and rejects on timeout', async () => {
    const callbacks = makeCallbacks(['123456']);
    const promise = runAgeCommandViaPty('age', ['-d', '-i', '/tmp/identity.txt'], process.env, callbacks, 20);
    const term = mockPtyInstances[0];

    await expect(promise).rejects.toThrow();
    expect(term.kill).toHaveBeenCalled();
  });

  it('writes a provided stdin payload followed by EOF (Ctrl-D) right after spawning', async () => {
    const callbacks = makeCallbacks([]);
    const promise = runAgeCommandViaPty(
      'age',
      ['-d', '-i', '/tmp/identity.txt', '-o', '/tmp/out.fifo'],
      process.env,
      callbacks,
      undefined,
      '-----BEGIN AGE ENCRYPTED FILE-----\nfake\n-----END AGE ENCRYPTED FILE-----\n'
    );
    const term = mockPtyInstances[0];
    term.emitExit(0);
    await promise;

    expect(term.write.mock.calls[0][0]).toContain('BEGIN AGE ENCRYPTED FILE');
    expect(term.write.mock.calls[1][0]).toBe('\x04');
  });
});

// `unwrapVaultKey`'s actual Vault Key bytes must never flow through the pty's text channel (see
// docs/team-vault-plan.md: it's both UTF-8-decoded and CRLF-normalized, and `age` itself refuses
// to write binary to a terminal) — instead `age -d ... -o <fifo>` writes them to a FIFO, a kernel
// pipe that never touches disk. Verified byte-exact against real hardware; these tests cover the
// FIFO plumbing itself with a real (but disposable, non-sensitive) temp FIFO.
describe('FIFO helpers (binary-safe path for unwrapVaultKey)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'age-pty-fifo-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('creates a real FIFO (not a regular file), delivers writer bytes to the reader, and removes it', async () => {
    const fifoPath = await createFifo(tempDir);
    expect(fs.statSync(fifoPath).isFIFO()).toBe(true);

    const payload = Buffer.from([0x00, 0x0a, 0x0d, 0xff, 0x41, 0x04]); // includes LF/CR/EOF-like bytes
    const readPromise = readFifoOnce(fifoPath);
    await fsp.writeFile(fifoPath, payload);

    const result = await readPromise;
    expect(result.equals(payload)).toBe(true);

    await removeFifo(fifoPath);
    expect(fs.existsSync(fifoPath)).toBe(false);
  });

  it('removeFifo is a no-op if the path is already gone', async () => {
    const fifoPath = path.join(tempDir, 'already-gone.fifo');
    await expect(removeFifo(fifoPath)).resolves.toBeUndefined();
  });
});
