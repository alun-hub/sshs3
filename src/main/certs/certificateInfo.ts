import { X509Certificate } from 'node:crypto';
import type {
  CertificateInfo,
  CertificatePreviewResult,
  CertificateValidity,
} from '../../shared/types/certificate';
import { decodeOid, iterateChildren, readTlv } from '../smartcard/CertificateParser';

/** The preview never reads more than this; a larger file is reported as too large rather than parsed in part. */
export const MAX_CERTIFICATE_FILE_BYTES = 64 * 1024;
export const MAX_CERTIFICATES = 10;
export const MAX_SANS = 8;
const MAX_FIELD_CHARS = 200;
const EXPIRING_DAYS = 30;
const DAY_MS = 86_400_000;

const PEM_BEGIN = '-----BEGIN CERTIFICATE-----';
const PEM_END = '-----END CERTIFICATE-----';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const SIGNATURE_ALGORITHMS: Record<string, { name: string; weak?: boolean }> = {
  '1.2.840.113549.1.1.2': { name: 'MD2 with RSA', weak: true },
  '1.2.840.113549.1.1.4': { name: 'MD5 with RSA', weak: true },
  '1.2.840.113549.1.1.5': { name: 'SHA-1 with RSA', weak: true },
  '1.2.840.113549.1.1.10': { name: 'RSASSA-PSS' },
  '1.2.840.113549.1.1.11': { name: 'SHA-256 with RSA' },
  '1.2.840.113549.1.1.12': { name: 'SHA-384 with RSA' },
  '1.2.840.113549.1.1.13': { name: 'SHA-512 with RSA' },
  '1.2.840.10045.4.1': { name: 'SHA-1 with ECDSA', weak: true },
  '1.2.840.10045.4.3.2': { name: 'SHA-256 with ECDSA' },
  '1.2.840.10045.4.3.3': { name: 'SHA-384 with ECDSA' },
  '1.2.840.10045.4.3.4': { name: 'SHA-512 with ECDSA' },
  '1.3.101.112': { name: 'Ed25519' },
  '1.3.101.113': { name: 'Ed448' },
};

const EXTENDED_KEY_USAGES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
  '1.3.6.1.4.1.311.20.2.2': 'smartcardLogon',
  '2.5.29.37.0': 'anyExtendedKeyUsage',
};

const CURVE_NAMES: Record<string, string> = {
  prime256v1: 'P-256',
  secp384r1: 'P-384',
  secp521r1: 'P-521',
  secp256k1: 'secp256k1',
};

/**
 * Makes text from a certificate safe to show: control characters and bidirectional overrides (which can
 * make one name look like another) are replaced and the length is capped. The text is attacker-controlled.
 */
export function sanitizeDisplay(text: string): string {
  const clean = text.replace(/[\p{Cc}\p{Bidi_Control}]/gu, '?');
  return clean.length > MAX_FIELD_CHARS ? `${clean.slice(0, MAX_FIELD_CHARS - 1)}…` : clean;
}

/** Node prints distinguished names one attribute per line (`CN=x\nO=y`); show them on one line. */
function formatName(name: string): string {
  return name
    .split('\n')
    .map((part) => sanitizeDisplay(part))
    .join(', ');
}

export function validityStatus(notBefore: number, notAfter: number, now: number): CertificateValidity {
  if (now < notBefore) return 'not-yet-valid';
  if (now > notAfter) return 'expired';
  return notAfter - now <= EXPIRING_DAYS * DAY_MS ? 'expiring' : 'valid';
}

export function signatureAlgorithmName(oid: string): { name: string; weak: boolean } {
  const known = SIGNATURE_ALGORITHMS[oid];
  return known ? { name: known.name, weak: known.weak === true } : { name: oid, weak: false };
}

/** The signature algorithm OID of a DER certificate (Node does not expose it), or undefined when the DER is malformed. */
export function readSignatureAlgorithmOid(der: Buffer): string | undefined {
  try {
    const cert = readTlv(der, 0);
    if (cert.tag !== 0x30 || cert.end > der.length) return undefined;
    let index = 0;
    for (const child of iterateChildren(der, cert.start, cert.end)) {
      if (child.end > cert.end) return undefined;
      if (index++ !== 1) continue; // tbsCertificate, then signatureAlgorithm
      if (child.tag !== 0x30) return undefined;
      const oid = readTlv(der, child.start);
      if (oid.tag !== 0x06 || oid.end > child.end) return undefined;
      return decodeOid(der, oid.start, oid.end);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function describePublicKey(x509: X509Certificate): string {
  const key = x509.publicKey;
  const details = key.asymmetricKeyDetails;
  switch (key.asymmetricKeyType) {
    case 'rsa':
    case 'rsa-pss':
      return details?.modulusLength ? `RSA ${details.modulusLength}` : 'RSA';
    case 'ec':
      return details?.namedCurve ? `EC ${CURVE_NAMES[details.namedCurve] ?? sanitizeDisplay(details.namedCurve)}` : 'EC';
    case 'ed25519':
      return 'Ed25519';
    case 'ed448':
      return 'Ed448';
    case 'dsa':
      return details?.modulusLength ? `DSA ${details.modulusLength}` : 'DSA';
    default:
      return key.asymmetricKeyType ? sanitizeDisplay(key.asymmetricKeyType) : 'Unknown';
  }
}

function isSelfSigned(x509: X509Certificate): boolean {
  if (x509.subject !== x509.issuer) return false;
  try {
    return x509.verify(x509.publicKey);
  } catch {
    return false;
  }
}

/** Describes one DER certificate; throws when it cannot be parsed. */
export function describeCertificate(der: Buffer, now: number): CertificateInfo {
  const x509 = new X509Certificate(der);
  const notBefore = Date.parse(x509.validFrom);
  const notAfter = Date.parse(x509.validTo);
  if (Number.isNaN(notBefore) || Number.isNaN(notAfter)) throw new Error('Unreadable validity period');

  const allSans = x509.subjectAltName ? x509.subjectAltName.split(', ') : [];
  const oid = readSignatureAlgorithmOid(der);
  const signature = oid ? signatureAlgorithmName(oid) : undefined;
  const msLeft = notAfter - now;

  return {
    subject: formatName(x509.subject),
    issuer: formatName(x509.issuer),
    serialNumber: sanitizeDisplay(x509.serialNumber),
    notBefore: new Date(notBefore).toISOString(),
    notAfter: new Date(notAfter).toISOString(),
    validity: validityStatus(notBefore, notAfter, now),
    daysLeft: Math.trunc(msLeft / DAY_MS),
    sans: allSans.slice(0, MAX_SANS).map(sanitizeDisplay),
    moreSans: Math.max(0, allSans.length - MAX_SANS),
    publicKey: describePublicKey(x509),
    signatureAlgorithm: signature?.name,
    weakSignature: signature?.weak ?? false,
    isCa: x509.ca,
    selfSigned: isSelfSigned(x509),
    extendedKeyUsage: (x509.keyUsage ?? []).map((id) => EXTENDED_KEY_USAGES[id] ?? sanitizeDisplay(id)),
    sha256: x509.fingerprint256,
  };
}

/** The DER of every `CERTIFICATE` block in PEM text. Other blocks (private keys included) are skipped unread. */
function pemCertificateBlocks(text: string): Buffer[] {
  const blocks: Buffer[] = [];
  let from = 0;
  while (from < text.length) {
    const begin = text.indexOf(PEM_BEGIN, from);
    if (begin === -1) break;
    const bodyStart = begin + PEM_BEGIN.length;
    const end = text.indexOf(PEM_END, bodyStart);
    if (end === -1) break;
    from = end + PEM_END.length;
    const body = text.slice(bodyStart, end).replace(/\s+/g, '');
    if (body === '' || !BASE64.test(body)) continue;
    blocks.push(Buffer.from(body, 'base64'));
  }
  return blocks;
}

/**
 * Describes the certificates in a file's bytes (PEM, possibly a bundle, or a single DER certificate).
 * Only certificate fields are returned: anything else in the file, such as a private key in the same PEM, is
 * never decoded and cannot end up in the result.
 */
export function describeCertificateFile(file: Buffer, now: number = Date.now()): CertificatePreviewResult {
  if (file.length > MAX_CERTIFICATE_FILE_BYTES) return { certs: [], moreCerts: 0, error: 'too-large' };

  let blocks = pemCertificateBlocks(file.toString('latin1'));
  if (blocks.length === 0 && file[0] === 0x30) blocks = [file];
  if (blocks.length === 0) return { certs: [], moreCerts: 0, error: 'none' };

  const certs: CertificateInfo[] = [];
  for (const der of blocks.slice(0, MAX_CERTIFICATES)) {
    try {
      certs.push(describeCertificate(der, now));
    } catch {
      // A block that does not parse is skipped; the others are still worth showing.
    }
  }
  const moreCerts = Math.max(0, blocks.length - MAX_CERTIFICATES);
  if (certs.length === 0) return { certs, moreCerts, error: 'unreadable' };
  return { certs, moreCerts };
}
