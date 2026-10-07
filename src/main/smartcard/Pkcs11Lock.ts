let queue: Promise<unknown> = Promise.resolve();
import { createLogger } from '../log';
const pkcs11LockLog = createLogger('pkcs11-lock');

/**
 * Serializes every native PKCS#11-touching operation sshs3 itself performs — the cert-reading
 * worker (SmartcardCertificateReader) and every `ssh-add -s` invocation (SmartcardAgentLoader) —
 * into a single app-wide queue, so this app never opens more than one PKCS#11 session against the
 * physical token at a time, even across otherwise-unrelated operations (e.g. the 'agent-global'
 * cert read racing a *different* session's per-session agent load started a moment later, or two
 * terminals opened back to back under 'always-prompt'/'agent-per-session').
 *
 * This exists because vendor PKCS#11 modules — Net iD's included — are broadly unreliable under
 * concurrent access from independent callers even across separate OS processes (see the crash
 * reports referenced in SmartcardCertificateReader's doc comment, and the well-documented
 * p11-kit-proxy crash/hang issues filed against Firefox and others for the same root cause). We
 * have no way to govern what *other* applications on the system do with the same card, but every
 * PKCS#11 call this app makes is one we control — serializing those is the one mitigation fully
 * within our reach.
 *
 * Deliberately process-wide rather than keyed per `pkcs11LibPath`: different library paths (e.g.
 * a direct vendor `.so` vs. `p11-kit-proxy.so` wrapping the same physical card) can still resolve
 * to the same physical token, so keying by path wouldn't actually prevent the collision this
 * exists to avoid.
 */
let nextCallId = 1;

/**
 * Safety-net ceiling for a single queued operation (LOW finding, code
 * review). Every current caller already bounds its own execFile/worker with
 * a timeout well under this (the longest is Fido2KeyManager's 120s
 * ssh-keygen presence-detection wait), so this should never actually fire
 * today — it exists so a future caller that forgets to add its own timeout
 * can't silently wedge this app-wide queue forever. It only unblocks the
 * *queue* for the next caller; it can't cancel `fn()` itself (there's no
 * generic way to abort an arbitrary in-flight operation), so the original
 * call may still be running in the background after this fires.
 */
const WATCHDOG_TIMEOUT_MS = 180_000;

function withWatchdog<T>(promise: Promise<T>, callId: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pkcs11LockLog.error(`#${callId}: watchdog fired after ${WATCHDOG_TIMEOUT_MS}ms without ` +
          `resolving — releasing the queue for the next caller; the original operation may ` +
          `still be running in the background.`
      );
      reject(new Error(`PKCS#11 operation timed out after ${WATCHDOG_TIMEOUT_MS}ms`));
    }, WATCHDOG_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function withPkcs11Lock<T>(fn: () => Promise<T>): Promise<T> {
  const callId = nextCallId++;
  pkcs11LockLog.info(`#${callId}: queued`);
  const run = () => {
    pkcs11LockLog.info(`#${callId}: acquired, running`);
    return withWatchdog(fn(), callId);
  };
  const result = queue.then(run, run);
  result.then(
    () => pkcs11LockLog.info(`#${callId}: released (ok)`),
    () => pkcs11LockLog.info(`#${callId}: released (error)`)
  );
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
