import { createRequire } from 'node:module';
import type * as Pkcs11jsTypes from 'pkcs11js';
import { parseCertificateDer, type SmartcardCertificateDetails } from './CertificateParser';

// pkcs11js's CJS entry point ends with `module.exports = { ...pkcs11, PKCS11 }` — a spread of
// the native addon's exports object. Bundler/Node CJS-interop static analysis (which decides
// what `import * as ns from 'pkcs11js'` exposes) can't see through that spread, so only the
// directly-named `PKCS11` export is found; every constant (CKF_SERIAL_SESSION, CKA_CLASS, ...)
// comes back `undefined`, which then fails deep inside the native call with a confusing
// "wrong type, should be a Number" error. `createRequire` sidesteps static export detection
// entirely by returning the real `module.exports` object, exactly as plain `require()` would.
const pkcs11js = createRequire(import.meta.url)('pkcs11js') as typeof Pkcs11jsTypes;

const log = (...args: unknown[]) => console.warn('[smartcard-cert]', ...args);

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
 * Retries each slot's read once after a short delay: most PIV readers only
 * allow one active PKCS#11 transaction at a time (see the same note in
 * SmartcardAgentLoader), and the already-loaded ssh-agent can transiently
 * be mid-operation against the card when this runs.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readSmartcardCertificates(
  pkcs11LibPath: string
): Promise<Map<string, SmartcardCertificateDetails>> {
  const results = new Map<string, SmartcardCertificateDetails>();
  const pkcs11 = new pkcs11js.PKCS11();

  try {
    pkcs11.load(pkcs11LibPath);
    pkcs11.C_Initialize();
  } catch (err) {
    log(`C_Initialize failed for ${pkcs11LibPath}:`, err);
    return results;
  }

  try {
    let slots: Buffer[] = [];
    try {
      slots = pkcs11.C_GetSlotList(true);
    } catch (err) {
      log(`C_GetSlotList failed for ${pkcs11LibPath}:`, err);
      return results;
    }
    log(`${pkcs11LibPath}: ${slots.length} slot(s) with a token present`);

    for (const slot of slots) {
      const found = readCertificatesFromSlot(pkcs11, slot, results);
      if (!found.attempted) continue;
      if (found.objectCount === 0 && found.error) {
        // Likely transient contention with the card (see doc comment above) — one retry.
        log(`retrying slot after error:`, found.error);
        await sleep(300);
        readCertificatesFromSlot(pkcs11, slot, results);
      }
    }
  } finally {
    try {
      pkcs11.C_Finalize();
    } catch (err) {
      log(`C_Finalize failed for ${pkcs11LibPath}:`, err);
    }
  }

  log(`${pkcs11LibPath}: resolved ${results.size} certificate(s) with a usable fingerprint`);
  return results;
}

function readCertificatesFromSlot(
  pkcs11: Pkcs11jsTypes.PKCS11,
  slot: Buffer,
  results: Map<string, SmartcardCertificateDetails>
): { attempted: boolean; objectCount: number; error?: unknown } {
  let session: Buffer | undefined;
  try {
    session = pkcs11.C_OpenSession(slot, pkcs11js.CKF_SERIAL_SESSION);
    pkcs11.C_FindObjectsInit(session, [{ type: pkcs11js.CKA_CLASS, value: pkcs11js.CKO_CERTIFICATE }]);
    const objects = pkcs11.C_FindObjects(session, 10);
    pkcs11.C_FindObjectsFinal(session);
    log(`slot: found ${objects.length} certificate object(s)`);

    for (const obj of objects) {
      try {
        const attrs = pkcs11.C_GetAttributeValue(session, obj, [{ type: pkcs11js.CKA_VALUE }]);
        const der = attrs[0]?.value;
        if (!der || der.length === 0) {
          log('certificate object has no CKA_VALUE, skipping');
          continue;
        }
        const details = parseCertificateDer(Buffer.from(der));
        if (details) {
          results.set(details.fingerprint, details);
        } else {
          log('found a certificate but could not parse it or derive an SSH fingerprint for it (unsupported key type?)');
        }
      } catch (err) {
        log('C_GetAttributeValue failed for a certificate object:', err);
      }
    }
    return { attempted: true, objectCount: objects.length };
  } catch (err) {
    return { attempted: true, objectCount: 0, error: err };
  } finally {
    if (session !== undefined) {
      try {
        pkcs11.C_CloseSession(session);
      } catch {
        // Ignore — we're done with this session either way.
      }
    }
  }
}
