let queue: Promise<unknown> = Promise.resolve();

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
export function withPkcs11Lock<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => fn();
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
