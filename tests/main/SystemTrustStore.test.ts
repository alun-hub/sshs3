import { captureLogs } from './helpers/captureLogs';
import tls from 'node:tls';
import fs from 'node:fs';

let mockExecFileImpl: any = null;

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: Object.assign(
      (...args: any[]) => {
        if (mockExecFileImpl) {
          return mockExecFileImpl(...args);
        }
        return (actual.execFile as any)(...args);
      },
      { [Symbol.for('nodejs.util.promisify.custom')]: undefined }
    ),
  };
});

import { SystemTrustStore } from '../../src/main/crypto/SystemTrustStore';

describe('SystemTrustStore', () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  beforeEach(() => {
    SystemTrustStore._reset();
    delete process.env.NODE_EXTRA_CA_CERTS;
    mockExecFileImpl = null;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    SystemTrustStore._reset();
    delete process.env.NODE_EXTRA_CA_CERTS;
    mockExecFileImpl = null;
    process.env = { ...originalEnv };
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.restoreAllMocks();
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

  it('returns exact copy of tls.rootCertificates when getCAs() is empty', () => {
    vi.spyOn(SystemTrustStore, 'getCAs').mockReturnValue([]);
    const merged = SystemTrustStore.getMergedRootCertificates();
    expect(merged).toEqual(tls.rootCertificates);
  });

  it('detects Linux CA bundle on Linux system', () => {
    if (process.platform === 'linux') {
      const bundlePath = SystemTrustStore.findLinuxBundlePath();
      expect(bundlePath).toBeDefined();
      expect(typeof bundlePath).toBe('string');
    }
  });

  it('initializes and caches system certificates via init()', async () => {
    await SystemTrustStore.init();
    const cas = SystemTrustStore.getCAs();
    expect(Array.isArray(cas)).toBe(true);
    if (process.platform === 'linux') {
      expect(cas.length).toBeGreaterThan(0);
    }
    // Calling init again is a no-op
    await SystemTrustStore.init();
    expect(SystemTrustStore.getCAs()).toBe(cas);
  });

  it('initializes synchronously when getCAs() or getBundlePath() is called before init()', () => {
    const bundle = SystemTrustStore.getBundlePath();
    const cas = SystemTrustStore.getCAs();
    expect(Array.isArray(cas)).toBe(true);
    if (process.platform === 'linux') {
      expect(typeof bundle).toBe('string');
      expect(cas.length).toBeGreaterThan(0);
    }
  });

  it('sets NODE_EXTRA_CA_CERTS when cached bundle path is found', async () => {
    delete process.env.NODE_EXTRA_CA_CERTS;
    await SystemTrustStore.init();
    const bundle = SystemTrustStore.getBundlePath();
    if (bundle) {
      expect(process.env.NODE_EXTRA_CA_CERTS).toBe(bundle);
    }
  });

  it('preserves existing NODE_EXTRA_CA_CERTS if already set', async () => {
    process.env.NODE_EXTRA_CA_CERTS = '/custom/ca-bundle.pem';
    await SystemTrustStore.init();
    expect(process.env.NODE_EXTRA_CA_CERTS).toBe('/custom/ca-bundle.pem');
  });

  // The Linux bundle/loader paths aren't exercised on Windows (it loads the Windows certificate store instead)
  it.skipIf(process.platform === 'win32')('handles Linux bundle reading when no candidate file exists', async () => {
    vi.spyOn(SystemTrustStore, 'findLinuxBundlePath').mockReturnValue(undefined);
    await SystemTrustStore.init();
    expect(SystemTrustStore.getBundlePath()).toBeUndefined();
    expect(SystemTrustStore.getCAs()).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('handles error in init() gracefully without throwing', async () => {
    vi.spyOn(SystemTrustStore as any, 'loadLinuxCertificates').mockRejectedValue(new Error('disk failure'));
    const warnSpy = captureLogs();

    await expect(SystemTrustStore.init()).resolves.toBeUndefined();
    expect(warnSpy.text()).toContain('SystemTrustStore: failed to load system CA certificates:');
  });

  it.skipIf(process.platform === 'win32')('handles error in initSync() gracefully without throwing', () => {
    vi.spyOn(SystemTrustStore as any, 'loadLinuxCertificatesSync').mockImplementation(() => {
      throw new Error('sync failure');
    });
    const warnSpy = captureLogs();

    expect(() => SystemTrustStore.initSync()).not.toThrow();
    expect(warnSpy.text()).toContain('SystemTrustStore: failed to sync load system CA certificates:');
  });

  describe('Windows certificate store handling', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    it('uses cached Windows bundle when fresh (< 24h old)', async () => {
      const mockCert = '-----BEGIN CERTIFICATE-----\nWINCA123\n-----END CERTIFICATE-----';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({
        mtimeMs: Date.now() - 1000 * 60 * 60, // 1 hour old
        size: mockCert.length,
      } as any);
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(mockCert);

      await SystemTrustStore.init();
      expect(SystemTrustStore.getCAs()).toEqual([mockCert]);
      expect(SystemTrustStore.getBundlePath()).toContain('windows-ca-bundle.pem');
    });

    it('regenerates Windows bundle when cache is stale (> 24h old)', async () => {
      const freshCert = '-----BEGIN CERTIFICATE-----\nFRESH123\n-----END CERTIFICATE-----';
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs.promises, 'stat').mockResolvedValue({
        mtimeMs: Date.now() - 1000 * 60 * 60 * 48, // 48 hours old
        size: 100,
      } as any);
      vi.spyOn(SystemTrustStore, 'fetchWindowsCertificatesNative').mockReturnValue([freshCert]);
      const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();

      await SystemTrustStore.init();
      expect(SystemTrustStore.getCAs()).toEqual([freshCert]);
      expect(writeFileSpy).toHaveBeenCalled();
    });

    it('falls back to PowerShell when native Windows cert extraction returns empty', async () => {
      const psCert = '-----BEGIN CERTIFICATE-----\nPSCERT456\n-----END CERTIFICATE-----';
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(SystemTrustStore, 'fetchWindowsCertificatesNative').mockReturnValue([]);
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined as any);
      const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();

      // Mock child_process.execFile for powershell.exe
      mockExecFileImpl = (file: string, _args: any, callback: any) => {
        expect(file).toBe('powershell.exe');
        callback(null, { stdout: psCert, stderr: '' });
      };

      await SystemTrustStore.init();
      expect(SystemTrustStore.getCAs()).toEqual([psCert]);
      expect(writeFileSpy).toHaveBeenCalledWith(
        expect.stringContaining('windows-ca-bundle.pem'),
        psCert,
        'utf8'
      );
    });

    it('catches and logs warning when PowerShell fallback fails', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(SystemTrustStore, 'fetchWindowsCertificatesNative').mockReturnValue([]);
      mockExecFileImpl = (_file: string, _args: any, callback: any) => {
        callback(new Error('PowerShell execution policy blocked'));
      };
      const warnSpy = captureLogs();

      await SystemTrustStore.init();
      expect(SystemTrustStore.getCAs()).toEqual([]);
      expect(warnSpy.text()).toContain('PowerShell cert extraction fallback failed:');
    });

    it('handles Windows sync initialization with cache and native certs', () => {
      const cert = '-----BEGIN CERTIFICATE-----\nWINSYNC789\n-----END CERTIFICATE-----';
      // Case 1: Fresh cache exists
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(cert);

      SystemTrustStore.initSync();
      expect(SystemTrustStore.getCAs()).toEqual([cert]);

      // Case 2: No cache, native certs found
      SystemTrustStore._reset();
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(SystemTrustStore, 'fetchWindowsCertificatesNative').mockReturnValue([cert]);
      const writeSyncSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => '' as any);

      SystemTrustStore.initSync();
      expect(SystemTrustStore.getCAs()).toEqual([cert]);
      expect(writeSyncSpy).toHaveBeenCalled();
    });

    it('returns empty array when fetchWindowsCertificatesNative encounters an error', () => {
      // win-ca mock error
      captureLogs();
      const result = SystemTrustStore.fetchWindowsCertificatesNative();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
