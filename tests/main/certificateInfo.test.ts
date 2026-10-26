import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_CERTIFICATE_FILE_BYTES,
  describeCertificateFile,
  sanitizeDisplay,
  signatureAlgorithmName,
  validityStatus,
} from '../../src/main/certs/certificateInfo';

const fixture = (name: string): Buffer => fs.readFileSync(path.join(__dirname, 'fixtures', 'certs', name));
const DAY = 86_400_000;
// Built from parts so secret scanners do not mistake the synthetic test block for a real key.
const pemBlock = (label: string, body: string): string => `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
const NOW = Date.parse('2027-01-01T00:00:00Z');

describe('describeCertificateFile', () => {
  it('describes a PEM leaf certificate', () => {
    const res = describeCertificateFile(fixture('leaf.pem'), NOW);
    expect(res.error).toBeUndefined();
    expect(res.certs).toHaveLength(1);
    const cert = res.certs[0];
    expect(cert.subject).toBe('C=SE, O=Test Org, CN=www.example.test');
    expect(cert.issuer).toBe('C=SE, O=Test Org, CN=Test Root CA');
    expect(cert.sans).toEqual(['DNS:www.example.test', 'DNS:example.test', 'IP Address:192.0.2.10']);
    expect(cert.publicKey).toBe('RSA 2048');
    expect(cert.signatureAlgorithm).toBe('SHA-256 with RSA');
    expect(cert.weakSignature).toBe(false);
    expect(cert.isCa).toBe(false);
    expect(cert.selfSigned).toBe(false);
    expect(cert.extendedKeyUsage).toEqual(['serverAuth', 'clientAuth']);
    expect(cert.validity).toBe('valid');
    expect(cert.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('flags a self-signed CA and an EC key', () => {
    const ca = describeCertificateFile(fixture('ca.pem'), NOW).certs[0];
    expect(ca.isCa).toBe(true);
    expect(ca.selfSigned).toBe(true);
    const ec = describeCertificateFile(fixture('ec.pem'), NOW).certs[0];
    expect(ec.publicKey).toBe('EC P-256');
    expect(ec.signatureAlgorithm).toBe('SHA-256 with ECDSA');
  });

  it('reads a DER certificate the same as its PEM', () => {
    const der = describeCertificateFile(fixture('leaf.der'), NOW).certs[0];
    const pem = describeCertificateFile(fixture('leaf.pem'), NOW).certs[0];
    expect(der).toEqual(pem);
  });

  it('lists every certificate of a bundle, up to the cap', () => {
    const bundle = Buffer.concat([fixture('leaf.pem'), fixture('ca.pem')]);
    expect(describeCertificateFile(bundle, NOW).certs.map((c) => c.isCa)).toEqual([false, true]);

    const many = Buffer.concat(Array.from({ length: 12 }, () => fixture('ca.pem')));
    const res = describeCertificateFile(many, NOW);
    expect(res.certs).toHaveLength(10);
    expect(res.moreCerts).toBe(2);
  });

  it('derives the validity from the injected time', () => {
    const cert = (now: number) => describeCertificateFile(fixture('leaf.pem'), now).certs[0];
    expect(cert(Date.parse('1990-01-01T00:00:00Z')).validity).toBe('not-yet-valid');
    expect(cert(Date.parse('2300-01-01T00:00:00Z')).validity).toBe('expired');
    expect(cert(Date.parse('2300-01-01T00:00:00Z')).daysLeft).toBeLessThan(0);
  });

  it('never decodes or returns a private key sharing the file', () => {
    const marker = 'TOPSECRETKEYMATERIAL0123456789';
    const keyBlock = pemBlock('PRIVATE KEY', Buffer.from(marker).toString('base64'));
    const file = Buffer.concat([Buffer.from(keyBlock), fixture('leaf.pem'), Buffer.from(keyBlock)]);
    const res = describeCertificateFile(file, NOW);
    expect(res.certs).toHaveLength(1);
    const json = JSON.stringify(res);
    expect(json).not.toContain(marker);
    expect(json).not.toContain(Buffer.from(marker).toString('base64'));
    expect(json).not.toContain('PRIVATE');
  });

  it('reports files without a certificate or that cannot be parsed', () => {
    expect(describeCertificateFile(Buffer.from('hello world\n'), NOW).error).toBe('none');
    expect(describeCertificateFile(Buffer.alloc(0), NOW).error).toBe('none');
    const onlyKey = Buffer.from(pemBlock('PRIVATE KEY', 'AAAA'));
    expect(describeCertificateFile(onlyKey, NOW)).toEqual({ certs: [], moreCerts: 0, error: 'none' });
    const garbage = Buffer.from('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
    expect(describeCertificateFile(garbage, NOW).error).toBe('unreadable');
    expect(describeCertificateFile(Buffer.from([0x30, 0x82, 0xff, 0xff, 0x01]), NOW).error).toBe('unreadable');
  });

  it('skips a truncated PEM block and non-base64 bodies', () => {
    const truncated = fixture('leaf.pem').subarray(0, 400);
    expect(describeCertificateFile(truncated, NOW).error).toBe('none');
    const notBase64 = Buffer.from('-----BEGIN CERTIFICATE-----\n<script>alert(1)</script>\n-----END CERTIFICATE-----\n');
    expect(describeCertificateFile(notBase64, NOW).error).toBe('none');
  });

  it('refuses a file larger than the cap instead of parsing part of it', () => {
    const big = Buffer.concat([fixture('leaf.pem'), Buffer.alloc(MAX_CERTIFICATE_FILE_BYTES)]);
    expect(describeCertificateFile(big, NOW)).toEqual({ certs: [], moreCerts: 0, error: 'too-large' });
  });
});

describe('helpers', () => {
  it('sanitizeDisplay replaces control and bidi characters and caps the length', () => {
    expect(sanitizeDisplay('a\u0000b\u001bc')).toBe('a?b?c');
    expect(sanitizeDisplay('evil‮gnp.exe')).toBe('evil?gnp.exe');
    expect(sanitizeDisplay('x'.repeat(500))).toHaveLength(200);
  });

  it('validityStatus covers the boundaries', () => {
    expect(validityStatus(1000, 2000, 999)).toBe('not-yet-valid');
    expect(validityStatus(0, DAY, 2 * DAY)).toBe('expired');
    expect(validityStatus(0, 31 * DAY, 2 * DAY)).toBe('expiring');
    expect(validityStatus(0, 100 * DAY, 2 * DAY)).toBe('valid');
  });

  it('signatureAlgorithmName marks SHA-1 and MD5 as weak and keeps unknown OIDs', () => {
    expect(signatureAlgorithmName('1.2.840.113549.1.1.5')).toEqual({ name: 'SHA-1 with RSA', weak: true });
    expect(signatureAlgorithmName('1.2.840.113549.1.1.4').weak).toBe(true);
    expect(signatureAlgorithmName('1.3.101.112')).toEqual({ name: 'Ed25519', weak: false });
    expect(signatureAlgorithmName('1.2.3.4')).toEqual({ name: '1.2.3.4', weak: false });
  });
});
