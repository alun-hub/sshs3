import { describe, it, expect, beforeEach } from 'vitest';
import tls from 'node:tls';
import { SystemTrustStore } from '../../src/main/crypto/SystemTrustStore';

describe('SystemTrustStore', () => {
  beforeEach(() => {
    SystemTrustStore._reset();
  });

  it('splits PEM bundles into individual certificates', () => {
    const cert1 = '-----BEGIN CERTIFICATE-----\nABC123\n-----END CERTIFICATE-----';
    const cert2 = '-----BEGIN CERTIFICATE-----\nXYZ789\n-----END CERTIFICATE-----';
    const bundle = `${cert1}\nSome comment\n${cert2}\n`;

    const split = SystemTrustStore.splitPemBundle(bundle);
    expect(split).toHaveLength(2);
    expect(split[0]).toBe(cert1);
    expect(split[1]).toBe(cert2);
  });

  it('handles empty or certificate-less content gracefully', () => {
    expect(SystemTrustStore.splitPemBundle('')).toEqual([]);
    expect(SystemTrustStore.splitPemBundle('random string without certs')).toEqual([]);
  });

  it('includes default tls.rootCertificates in merged roots', () => {
    const merged = SystemTrustStore.getMergedRootCertificates();
    expect(merged.length).toBeGreaterThanOrEqual(tls.rootCertificates.length);
  });

  it('detects Linux CA bundle on Linux system', () => {
    if (process.platform === 'linux') {
      const bundlePath = SystemTrustStore.findLinuxBundlePath();
      expect(bundlePath).toBeDefined();
      expect(typeof bundlePath).toBe('string');
    }
  });

  it('initializes and caches system certificates', async () => {
    await SystemTrustStore.init();
    const cas = SystemTrustStore.getCAs();
    expect(Array.isArray(cas)).toBe(true);
    if (process.platform === 'linux') {
      expect(cas.length).toBeGreaterThan(0);
    }
  });

  it('provides safe native Windows cert fetching method', () => {
    const certs = SystemTrustStore.fetchWindowsCertificatesNative();
    expect(Array.isArray(certs)).toBe(true);
  });
});
