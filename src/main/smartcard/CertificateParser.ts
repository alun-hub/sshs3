import { X509Certificate, createHash, type KeyObject } from 'node:crypto';

/** Certificate details extracted for display in the "cached smartcard identities" UI. */
export interface SmartcardCertificateDetails {
  /** SSH fingerprint (SHA256:...) of the certificate's public key — used to match it to an `ssh-add -l` identity. */
  fingerprint: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  /** Microsoft UPN (User Principal Name) from the Subject Alternative Name extension, if present (common on PIV/CAC/SITHS cards). */
  upn?: string;
}

const SAN_OID = '2.5.29.17';
const UPN_OID = '1.3.6.1.4.1.311.20.2.3';

// --- Minimal definite-length DER/BER TLV reader --------------------------------------------
// X.509 certificates always use definite-length DER encoding, so a full BER parser isn't needed.

interface Tlv {
  tag: number;
  /** Start of the value bytes (i.e. right after tag + length octets). */
  start: number;
  /** End of the value bytes (exclusive). */
  end: number;
}

function readLength(buf: Buffer, pos: number): { length: number; bytesRead: number } {
  const first = buf[pos];
  if ((first & 0x80) === 0) return { length: first, bytesRead: 1 };
  const numBytes = first & 0x7f;
  let length = 0;
  for (let i = 0; i < numBytes; i++) length = (length << 8) | buf[pos + 1 + i];
  return { length, bytesRead: 1 + numBytes };
}

function readTlv(buf: Buffer, pos: number): Tlv {
  const tag = buf[pos];
  const { length, bytesRead } = readLength(buf, pos + 1);
  const start = pos + 1 + bytesRead;
  return { tag, start, end: start + length };
}

function* iterateChildren(buf: Buffer, start: number, end: number): Generator<Tlv> {
  let pos = start;
  while (pos < end) {
    const tlv = readTlv(buf, pos);
    yield tlv;
    pos = tlv.end;
  }
}

function decodeOid(buf: Buffer, start: number, end: number): string {
  const bytes = buf.subarray(start, end);
  const parts: number[] = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = (value << 7) | (bytes[i] & 0x7f);
    if ((bytes[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/**
 * Extracts the Microsoft UPN (`1.3.6.1.4.1.311.20.2.3`) from a certificate's
 * subjectAltName extension, if present. Node's built-in `X509Certificate`
 * doesn't decode this otherName type (it's Microsoft-specific, not a
 * standard SAN choice like email/DNS), so this walks the raw DER by hand.
 */
export function extractUpnFromCertificateDer(der: Buffer): string | undefined {
  try {
    const cert = readTlv(der, 0); // Certificate ::= SEQUENCE
    const tbs = readTlv(der, cert.start); // tbsCertificate ::= SEQUENCE (first child)

    for (const field of iterateChildren(der, tbs.start, tbs.end)) {
      if (field.tag !== 0xa3) continue; // [3] EXPLICIT extensions
      const extSeq = readTlv(der, field.start); // SEQUENCE OF Extension

      for (const ext of iterateChildren(der, extSeq.start, extSeq.end)) {
        const children = iterateChildren(der, ext.start, ext.end);
        const oidTlv = children.next().value;
        if (!oidTlv || oidTlv.tag !== 0x06) continue;
        if (decodeOid(der, oidTlv.start, oidTlv.end) !== SAN_OID) continue;

        let valueTlv = children.next().value; // optional BOOLEAN critical, then OCTET STRING
        if (valueTlv && valueTlv.tag === 0x01) valueTlv = children.next().value;
        if (!valueTlv || valueTlv.tag !== 0x04) continue;

        const sanSeq = readTlv(der, valueTlv.start); // extnValue content: SEQUENCE OF GeneralName
        for (const generalName of iterateChildren(der, sanSeq.start, sanSeq.end)) {
          if (generalName.tag !== 0xa0) continue; // otherName [0] IMPLICIT SEQUENCE
          const onFields = iterateChildren(der, generalName.start, generalName.end);
          const typeOidTlv = onFields.next().value;
          if (!typeOidTlv || typeOidTlv.tag !== 0x06) continue;
          if (decodeOid(der, typeOidTlv.start, typeOidTlv.end) !== UPN_OID) continue;

          const explicitWrapper = onFields.next().value; // value [0] EXPLICIT ANY
          if (!explicitWrapper) continue;
          const inner = readTlv(der, explicitWrapper.start); // the actual string (usually UTF8String)
          return der.subarray(inner.start, inner.end).toString('utf8');
        }
      }
      return undefined; // extensions block found and scanned; no need to keep looking
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// --- SSH fingerprint of a certificate's public key ------------------------------------------
// Lets us match a certificate (read directly from the PKCS#11 token) back to the identity
// `ssh-add -l` reports for the same key pair, without relying on CKA_ID/label conventions
// that vary between PKCS#11 providers (OpenSC vs. Net iD vs. p11-kit).

function encodeUint32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function encodeSshString(data: Buffer): Buffer {
  return Buffer.concat([encodeUint32(data.length), data]);
}

function encodeMpint(bytesIn: Buffer): Buffer {
  let bytes = bytesIn;
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  bytes = bytes.subarray(i);
  if (bytes.length === 0) bytes = Buffer.from([0]);
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return encodeSshString(bytes);
}

const EC_CURVE_NAMES: Record<string, string> = {
  'P-256': 'nistp256',
  'P-384': 'nistp384',
  'P-521': 'nistp521',
};

/** Builds the RFC 4253 wire-format public key blob SSH hashes to produce its fingerprint. */
function buildSshWireKey(publicKey: KeyObject): Buffer | undefined {
  if (publicKey.asymmetricKeyType === 'rsa') {
    const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
    const n = Buffer.from(jwk.n, 'base64url');
    const e = Buffer.from(jwk.e, 'base64url');
    return Buffer.concat([encodeSshString(Buffer.from('ssh-rsa')), encodeMpint(e), encodeMpint(n)]);
  }
  if (publicKey.asymmetricKeyType === 'ec') {
    const jwk = publicKey.export({ format: 'jwk' }) as { crv: string; x: string; y: string };
    const curve = EC_CURVE_NAMES[jwk.crv];
    if (!curve) return undefined;
    const x = Buffer.from(jwk.x, 'base64url');
    const y = Buffer.from(jwk.y, 'base64url');
    const point = Buffer.concat([Buffer.from([0x04]), x, y]);
    return Buffer.concat([
      encodeSshString(Buffer.from(`ecdsa-sha2-${curve}`)),
      encodeSshString(Buffer.from(curve)),
      encodeSshString(point),
    ]);
  }
  return undefined;
}

function computeSshFingerprint(publicKey: KeyObject): string | undefined {
  const wireKey = buildSshWireKey(publicKey);
  if (!wireKey) return undefined;
  const digest = createHash('sha256').update(wireKey).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

/**
 * Parses a DER-encoded X.509 certificate (as read directly off a PKCS#11
 * token) into the subset of fields worth surfacing in the UI: subject,
 * issuer, validity window, UPN, and the SSH fingerprint of its key so it
 * can be matched to the corresponding `ssh-add -l` identity.
 */
export function parseCertificateDer(der: Buffer): SmartcardCertificateDetails | undefined {
  try {
    const x509 = new X509Certificate(der);
    const fingerprint = computeSshFingerprint(x509.publicKey);
    if (!fingerprint) return undefined;
    return {
      fingerprint,
      subject: x509.subject,
      issuer: x509.issuer,
      validFrom: x509.validFrom,
      validTo: x509.validTo,
      upn: extractUpnFromCertificateDer(der),
    };
  } catch {
    return undefined;
  }
}
