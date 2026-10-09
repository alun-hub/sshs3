import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IPty } from 'node-pty';
import * as nodePty from 'node-pty';

const DEFAULT_TIMEOUT_MS = 30000;

export class TeamVaultWrongPinError extends Error {
  constructor(message = 'Wrong PIV PIN') {
    super(message);
    this.name = 'TeamVaultWrongPinError';
  }
}

/** The card still has its factory-default PIN/PUK/management-key, which forces
 * `age-plugin-yubikey` into a mandatory interactive migration wizard that changes
 * card-wide credentials (not just this one slot) — see docs/team-vault-plan.md's
 * "Hårdvaruverifiering" section. We never drive that wizard programmatically. */
export class TeamVaultDefaultCredentialsError extends Error {
  constructor(
    message = 'This YubiKey still has its factory-default PIN/PUK. Change them yourself first ' +
      '(e.g. "ykman piv access change-pin" / "change-puk"), then retry.'
  ) {
    super(message);
    this.name = 'TeamVaultDefaultCredentialsError';
  }
}

export interface AgePtyPromptRetryContext {
  error: string;
  attempt: number;
  maxAttempts: number;
}

export interface AgePtyPromptCallbacks {
  requestPin(promptText: string, retry?: AgePtyPromptRetryContext): Promise<string>;
  onTouchRequested(): void;
  onTouchCleared(): void;
}

/** node-pty's ESM/CJS interop is inconsistent across bundling setups — same defensive guard
 * already used by `SSHPtyManager.getSpawn()`, duplicated here rather than shared since it's a
 * handful of lines and this module has no other dependency on SSHPtyManager. */
function getSpawn(): typeof nodePty.spawn {
  if (typeof (nodePty as any).spawn === 'function') return (nodePty as any).spawn;
  if ((nodePty as any).default && typeof (nodePty as any).default.spawn === 'function') {
    return (nodePty as any).default.spawn;
  }
  throw new Error('node-pty spawn function not found');
}

const PIN_PROMPT_RE = /enter pin for yubikey/i;
const WRONG_PIN_RE = /invalid pin \((\d+) tries? remaining/i;
const TOUCH_PROMPT_RE = /please touch the yubikey/i;
// Exact wording of the default-PIN/PUK/management-key migration wizard was never captured (the
// one time it was hit, the process was killed before any output was saved — see
// docs/team-vault-plan.md). These patterns are deliberately broad: failing closed (aborting) on
// a false positive just means a legitimate PIN prompt gets misclassified and retried, which is
// safe; failing to recognize the real wizard and writing into it would not be.
const DEFAULT_CREDENTIALS_WIZARD_RE = /choose a new (pin|puk)|enter.*new (piv )?(pin|puk)|management key/i;

/**
 * Runs an `age`/`age-plugin-yubikey` invocation inside a real pty (required — see
 * docs/team-vault-plan.md's hardware verification notes: plain `execFile` fails with
 * "not a terminal" because the plugin needs a controlling terminal to prompt for PIN/touch).
 * Returns the full captured text output on success — safe for callers whose actual payload is
 * text (e.g. `enrollOwnPivRecipient`'s identity stanza). Callers whose payload is binary (e.g.
 * `unwrapVaultKey`'s decrypted Vault Key) must not rely on this text channel for that payload —
 * route it through a FIFO via `-o <fifo>` instead (see `TeamVaultCryptoService`), since this
 * pty's text channel both UTF-8-decodes and CRLF-normalizes everything that flows through it.
 */
export function runAgeCommandViaPty(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  callbacks: AgePtyPromptCallbacks,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  stdin?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const spawn = getSpawn();
    const term: IPty = spawn(binary, args, { name: 'xterm-color', cols: 120, rows: 30, env });

    if (stdin !== undefined) {
      // `stdin` is always ASCII-armored age ciphertext (see `unwrapVaultKey`), never raw binary,
      // so it can't contain control bytes the pty's line discipline would misinterpret. A pty
      // has no real "close stdin" like a pipe does, so EOF is signalled explicitly with Ctrl-D.
      term.write(stdin);
      term.write('\x04');
    }

    let fullText = '';
    let settled = false;
    let pinAttempt = 0;
    let awaitingPinResponse = false;
    let touchActive = false;

    const timeoutHandle = setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for "${binary}" to finish`)));
      term.kill();
    }, timeoutMs);

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      action();
    }

    function clearTouchIfActive(): void {
      if (touchActive) {
        touchActive = false;
        callbacks.onTouchCleared();
      }
    }

    function requestAndWritePin(promptText: string, retry?: AgePtyPromptRetryContext): void {
      awaitingPinResponse = true;
      callbacks
        .requestPin(promptText, retry)
        .then((pin) => {
          awaitingPinResponse = false;
          if (settled) return;
          term.write(`${pin}\r`);
        })
        .catch((err) => {
          finish(() => reject(err));
          term.kill();
        });
    }

    term.onData((data: string) => {
      if (settled) return;
      fullText += data;

      if (DEFAULT_CREDENTIALS_WIZARD_RE.test(data)) {
        finish(() => reject(new TeamVaultDefaultCredentialsError()));
        term.kill();
        return;
      }

      // The card's own message is authoritative on how many tries are left — once it says 0,
      // the PIN is about to be (or already is) blocked, so this gives up rather than retrying.
      const wrongPinMatch = data.match(WRONG_PIN_RE);
      if (wrongPinMatch) {
        clearTouchIfActive();
        const triesRemaining = Number(wrongPinMatch[1]);
        if (triesRemaining <= 0) {
          finish(() => reject(new TeamVaultWrongPinError(`Invalid PIN (${triesRemaining} tries remaining before it is blocked)`)));
          term.kill();
          return;
        }
        pinAttempt += 1;
        // Total attempts = tries already spent (pinAttempt - 1) + tries still remaining, per
        // the card's own count — not an arbitrary constant on our side.
        requestAndWritePin('Enter PIN for YubiKey', {
          error: `Invalid PIN (${triesRemaining} tries remaining before it is blocked)`,
          attempt: pinAttempt,
          maxAttempts: triesRemaining + pinAttempt - 1,
        });
        return;
      }

      if (PIN_PROMPT_RE.test(data) && pinAttempt === 0 && !awaitingPinResponse) {
        clearTouchIfActive();
        pinAttempt = 1;
        requestAndWritePin(data.trim());
        return;
      }

      if (TOUCH_PROMPT_RE.test(data)) {
        if (!touchActive) {
          touchActive = true;
          callbacks.onTouchRequested();
        }
        return;
      }

      // Any other output after a touch prompt (success text, a recipient line, etc.) means the
      // touch step is over.
      clearTouchIfActive();
    });

    term.onExit(({ exitCode }: { exitCode: number }) => {
      finish(() => {
        if (exitCode === 0) {
          resolve(fullText);
        } else {
          reject(new Error(fullText.trim() || `"${binary}" exited with code ${exitCode}`));
        }
      });
    });
  });
}

/**
 * Creates a fresh FIFO (named pipe) in `dir` and returns its path. A FIFO is a kernel pipe
 * buffer that happens to have a filesystem name — nothing written through it is ever persisted
 * to disk, so routing the decrypted Vault Key through one (see `unwrapVaultKey`) doesn't violate
 * CLAUDE.md's "never write secrets to disk" rule. Linux/macOS only (no `mkfifo` on Windows) —
 * Windows support for this flow is a known, documented gap (docs/team-vault-plan.md).
 */
export function createFifo(dir: string): Promise<string> {
  const fifoPath = path.join(dir, `${crypto.randomUUID()}.fifo`);
  return new Promise((resolve, reject) => {
    execFile('mkfifo', ['-m', '600', fifoPath], (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(fifoPath);
    });
  });
}

/** Reads everything written to `fifoPath` by its one expected writer, resolving once that
 * writer closes its end (EOF). */
export function readFifoOnce(fifoPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = fs.createReadStream(fifoPath);
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Removes a FIFO created by `createFifo`. A no-op if it's already gone. */
export async function removeFifo(fifoPath: string): Promise<void> {
  try {
    await fs.promises.unlink(fifoPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
