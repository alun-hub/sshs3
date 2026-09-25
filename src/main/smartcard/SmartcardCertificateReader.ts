import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCertificateDer, type SmartcardCertificateDetails } from './CertificateParser';
import { withPkcs11Lock } from './Pkcs11Lock';

const log = (...args: unknown[]) => console.warn('[smartcard-cert]', ...args);

/** Same resolution `proxyCli.cjs` uses (see SmartcardDetector's proxy handling): `__dirname` is
 * either this source file's own directory (`src/main/smartcard`, dev/unbundled — `certWorker.cjs`
 * already lives right there) or the flattened build output directory (`dist-electron`, packaged —
 * where the vite plugin copies `certWorker.cjs` alongside the bundled main process). Either way
 * it's a sibling of this file. */
function resolveWorkerPath(): string {
  const currentDir =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, 'certWorker.cjs');
}

/**
 * Reads every X.509 certificate object off a PKCS#11 token and returns its
 * parsed details, keyed by the SSH fingerprint of its public key.
 *
 * Talks to the PKCS#11 module directly (same `.so`/`.dll` already resolved
 * for `ssh-add -s <path>`) instead of shelling out to a vendor CLI tool
 * (e.g. OpenSC's `pkcs11-tool`) — that tool isn't installed at all for
 * providers like Net iD, which ship only the PKCS#11 library itself. Since
 * PKCS#11 is a standard C API, this works identically regardless of which
 * provider (OpenSC, Net iD, p11-kit-proxy) is behind `pkcs11LibPath`.
 *
 * Certificate objects are public on essentially every PIV/CAC/SITHS/Net iD
 * card, so this deliberately never logs in (`C_Login`) — no PIN prompt.
 * Returns an empty map on any failure (missing module, no card inserted,
 * unreadable objects, ...) rather than throwing, since this is purely
 * supplementary display info for an already-working identity list — but
 * every failure is logged with `console.warn`, since silently returning
 * nothing gave no way to diagnose why a given card's details don't show up.
 *
 * The actual PKCS#11 calls run in a short-lived child process (`certWorker.cjs`), not inline
 * here: some vendor modules (observed with Net iD's libiidp11.so) raise a native SIGTRAP inside
 * `C_Finalize()` when this runs in the same process that also holds the token open elsewhere
 * (e.g. the app-lifetime agent loaded via `ssh-add -s` for 'agent-global' mode, which is exactly
 * when this function is called — see getOrLoadGlobalSmartcardAgent). That's a native-level crash;
 * no in-process try/catch can catch a SIGTRAP, and it took down the whole Electron main process.
 * Isolating it in a worker means a crash there only kills the worker — this function just gets an
 * empty result and logs it, the same as any other failure to read certs.
 */
export async function readSmartcardCertificates(
  pkcs11LibPath: string
): Promise<Map<string, SmartcardCertificateDetails>> {
  const results = new Map<string, SmartcardCertificateDetails>();

  let stdout: string;
  try {
    // See Pkcs11Lock's doc comment: this must never race a concurrent `ssh-add -s` (or another
    // cert read) against the same physical token.
    stdout = await withPkcs11Lock(() => runCertWorker(pkcs11LibPath));
  } catch (err) {
    log(`certWorker failed for ${pkcs11LibPath}:`, err);
    return results;
  }

  const line = stdout.trim().split('\n').pop() ?? '';
  let parsed: { certs?: string[]; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    log(`certWorker produced unparseable output for ${pkcs11LibPath}:`, err, line);
    return results;
  }

  if (parsed.error) {
    log(`certWorker reported an error for ${pkcs11LibPath}:`, parsed.error);
    return results;
  }

  for (const derBase64 of parsed.certs ?? []) {
    try {
      const details = parseCertificateDer(Buffer.from(derBase64, 'base64'));
      if (details) {
        results.set(details.fingerprint, details);
      } else {
        log('found a certificate but could not parse it or derive an SSH fingerprint for it (unsupported key type?)');
      }
    } catch (err) {
      log('failed to parse a certificate returned by certWorker:', err);
    }
  }

  log(`${pkcs11LibPath}: resolved ${results.size} certificate(s) with a usable fingerprint`);
  return results;
}

function runCertWorker(pkcs11LibPath: string): Promise<string> {
  const workerPath = resolveWorkerPath();
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [workerPath, pkcs11LibPath],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout) => {
        // The worker may still exit non-zero or be killed (e.g. by the vendor module's
        // C_Finalize crash) *after* it already wrote its JSON result line — treat any non-empty
        // stdout as usable even if the process itself ended badly.
        if (stdout && stdout.trim().length > 0) {
          resolve(stdout);
          return;
        }
        reject(err ?? new Error('certWorker produced no output'));
      }
    );
  });
}
