import { describe, expect, it } from 'vitest';
import { extractUpnFromCertificateDer, parseCertificateDer } from '../../src/main/smartcard/CertificateParser';

// Self-signed EC (P-256) certificate with a Microsoft UPN otherName in its subjectAltName,
// generated via:
//   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -outform DER \
//     -subj "/CN=Jane Testsson" \
//     -addext "subjectAltName=otherName:1.3.6.1.4.1.311.20.2.3;UTF8:jane.testsson@example.com"
// Its SSH fingerprint was independently verified with `ssh-keygen -lf` against the same
// public key, exported via `openssl x509 -pubkey | ssh-keygen -i -m PKCS8`.
const EC_CERT_WITH_UPN_B64 =
  'MIIBiDCCAS+gAwIBAgIUL5NxHFlvU34xfNpckEMepMZP6qowCgYIKoZIzj0EAwIwGDEWMBQGA1UEAwwNSmFuZSBUZXN0c3NvbjAeFw0yNjA5MjIxNzA4MjJaFw0yNzA5MjIxNzA4MjJaMBgxFjAUBgNVBAMMDUphbmUgVGVzdHNzb24wWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATxQg/DEeI7BFuFijMZh2UNceB7vzt2X/cfMbLyuuQNeCyAWHaycnB3IuOD8D8OHpsBp1ME//85QMq9WRBfKPCRo1cwVTA0BgNVHREELTAroCkGCisGAQQBgjcUAgOgGwwZamFuZS50ZXN0c3NvbkBleGFtcGxlLmNvbTAdBgNVHQ4EFgQUha/GQTe0e+vOF6r0DeV533jIGF4wCgYIKoZIzj0EAwIDRwAwRAIgFz2tH9BMgHfRu99jABknNPp8J7MCaHua8kpK9ENlKSECIHmmP9S2SmK7ayAglAQdjGs0STY/15FF8royxBpy7UZT';
const EC_CERT_SSH_FINGERPRINT = 'SHA256:VmHAS/hTK4NUwl6iDY4VV5Sx50xrWNPSHrxGh1gTwkI';

// Self-signed RSA-2048 certificate with no subjectAltName at all, to exercise the RSA
// fingerprint path and confirm a missing SAN just yields no UPN rather than throwing.
const RSA_CERT_NO_SAN_B64 =
  'MIIC2zCCAcOgAwIBAgIUA6Z7MYMUvkVgzm3dlAcTIx7FzOYwDQYJKoZIhvcNAQELBQAwFjEUMBIGA1UEAwwLQm9iIFJzYXNzb24wHhcNMjYwOTIyMTcwODM3WhcNMjcwOTIyMTcwODM3WjAWMRQwEgYDVQQDDAtCb2IgUnNhc3NvbjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAOEqmHQyJqZAxekHzby+H0+cPFjCfulMrSrFodbwwre5duLBAaxvK0zxUVeB/aBhbsMn2DaEa54EeY9MNBpaENDetKmAFSd/03MSN9e04JKUJ42Ssjia8OdOXeWU8ZhU+yZyRn1ZVhVJ7/OEcEBIcCc/A61xUwIxfTstp/35nXnIVChxPpbYVKBzYDz4h4YACSFBs7Oa7AFrTVvkEdQ7MhlUXdQAgy9SjvMLWqd4wQ0OgM60OT3dcO0ubKmUaGE+qdC8jsQmQspXEce+OaGhxumsFDKKpyBlJTmjtprGPEPaATBQAK1Mw/5keHSiYiFiSP2HTxRGUEI7mV1Z1LA78IUCAwEAAaMhMB8wHQYDVR0OBBYEFJ4PwbDeLpTDrHBEtQRwB5vSHxw0MA0GCSqGSIb3DQEBCwUAA4IBAQBlit2nr1bUoy1kjcbHHmX4e/fiQRvOW6VBeP0TMXPemsiqeFiRJgrJqMT/6r6VtdPRSK5GvboSp/WjOihLHKL3x5wZvT//8K8Zb02QaeddJkXG6VAUCuuhQcuFCaqvEo/TYzKM7YZ5aCBK7ARpOBnLxoRp8PGBoL5CFUJ/GGKnkNGMHxg/i3tUSmdXt6pcckoHt6EAvL/4zZC2BMkqvpUyS3PrZFaYCqUw2omRUup8wA8Uiw8D9H2OLwqNDVFSqN8WIUwQ094u2lb5zaDpedppey5+I6yJkrRqvA0+sWJCMY8Y3vHzyAqgGUQyAhK5FoXk9DsT0Wbv/SfV+5P9bKqw';
const RSA_CERT_SSH_FINGERPRINT = 'SHA256:TJIhx9TViXWZCtoH9K5n2u5WjQqi5XGlINkHBSQNRYE';

describe('CertificateParser', () => {
  it('extracts the UPN from a certificate with a Microsoft otherName SAN', () => {
    const der = Buffer.from(EC_CERT_WITH_UPN_B64, 'base64');
    expect(extractUpnFromCertificateDer(der)).toBe('jane.testsson@example.com');
  });

  it('returns undefined when the certificate has no subjectAltName', () => {
    const der = Buffer.from(RSA_CERT_NO_SAN_B64, 'base64');
    expect(extractUpnFromCertificateDer(der)).toBeUndefined();
  });

  it('parses an EC certificate into subject/validity/UPN and matches ssh-keygen\'s fingerprint', () => {
    const der = Buffer.from(EC_CERT_WITH_UPN_B64, 'base64');
    const details = parseCertificateDer(der);
    expect(details).toBeDefined();
    expect(details?.fingerprint).toBe(EC_CERT_SSH_FINGERPRINT);
    expect(details?.subject).toContain('CN=Jane Testsson');
    expect(details?.upn).toBe('jane.testsson@example.com');
    expect(details?.validFrom).toBeTruthy();
    expect(details?.validTo).toBeTruthy();
  });

  it('parses an RSA certificate and matches ssh-keygen\'s fingerprint, with no UPN', () => {
    const der = Buffer.from(RSA_CERT_NO_SAN_B64, 'base64');
    const details = parseCertificateDer(der);
    expect(details).toBeDefined();
    expect(details?.fingerprint).toBe(RSA_CERT_SSH_FINGERPRINT);
    expect(details?.subject).toContain('CN=Bob Rsasson');
    expect(details?.upn).toBeUndefined();
  });

  it('returns undefined for garbage input instead of throwing', () => {
    expect(parseCertificateDer(Buffer.from([0x00, 0x01, 0x02]))).toBeUndefined();
    expect(extractUpnFromCertificateDer(Buffer.from([0x00, 0x01, 0x02]))).toBeUndefined();
  });
});
