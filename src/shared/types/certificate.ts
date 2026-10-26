/** Validity of a certificate's dates. Says nothing about trust: the chain and revocation are not checked. */
export type CertificateValidity = 'valid' | 'expiring' | 'expired' | 'not-yet-valid';

/** Human-readable facts about one X.509 certificate. Never contains raw certificate or key text. */
export interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  /** ISO 8601, or undefined when the date could not be read. */
  notBefore?: string;
  notAfter?: string;
  validity: CertificateValidity;
  /** Whole days until `notAfter` (negative once expired); undefined when `notAfter` is unknown. */
  daysLeft?: number;
  /** Subject Alternative Names such as `DNS:example.com`, at most `maxSans` of them. */
  sans: string[];
  /** SANs left out of `sans`. */
  moreSans: number;
  /** E.g. `RSA 2048`, `EC P-256`, `Ed25519`. */
  publicKey: string;
  /** E.g. `SHA-256 with RSA`; the dotted OID when unknown. */
  signatureAlgorithm?: string;
  /** The signature uses SHA-1 or MD5. */
  weakSignature: boolean;
  isCa: boolean;
  selfSigned: boolean;
  /** Extended Key Usage names, e.g. `serverAuth`. */
  extendedKeyUsage: string[];
  /** `AA:BB:…` SHA-256 of the DER encoding. */
  sha256: string;
}

export type CertificatePreviewError =
  /** The file holds no certificate (or the name says it is not one). */
  | 'none'
  /** Larger than the preview reads; never parsed partially. */
  | 'too-large'
  /** Could not be read or parsed. */
  | 'unreadable';

export interface CertificatePreviewResult {
  certs: CertificateInfo[];
  /** Certificates in the file beyond `certs`. */
  moreCerts: number;
  error?: CertificatePreviewError;
}
