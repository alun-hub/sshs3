import crypto from 'node:crypto';

/**
 * Computes the OpenSSH-style "SHA256:base64" fingerprint shown by
 * `ssh-keygen -lf` for a raw public key blob.
 */
export function fingerprintKey(keyBuffer: Buffer): string {
  const hash = crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
  return `SHA256:${hash}`;
}
