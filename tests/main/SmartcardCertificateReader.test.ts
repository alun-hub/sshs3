import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import util from 'node:util';

const { mockExecFile, mockExistsSync } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (p: string) => mockExistsSync(p),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const customExecFile: any = (file: string, args: any, options: any, callback?: any) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    return mockExecFile(file, args, options, callback);
  };
  customExecFile[util.promisify.custom] = (file: string, args: any, options: any) => {
    return new Promise((resolve, reject) => {
      mockExecFile(file, args, options, (err: any, stdout: any, stderr: any) => {
        if (err) {
          if (err && typeof err === 'object') {
            err.stdout = stdout;
            err.stderr = stderr;
          }
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  };

  return {
    ...actual,
    execFile: customExecFile,
  };
});

import { readSmartcardCertificates } from '../../src/main/smartcard/SmartcardCertificateReader';
import * as CertificateParser from '../../src/main/smartcard/CertificateParser';

describe('SmartcardCertificateReader', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockExecFile.mockReset();
    mockExistsSync.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('reads certificates successfully via certWorker', async () => {
    const fakeDer = Buffer.from([0x30, 0x10, 0x01, 0x02]);
    const fakeBase64 = fakeDer.toString('base64');

    vi.spyOn(CertificateParser, 'parseCertificateDer').mockReturnValueOnce({
      subject: 'CN=Test User',
      issuer: 'CN=Test CA',
      validFrom: '2026-01-01',
      validTo: '2027-01-01',
      fingerprint: 'SHA256:abc123test',
    });

    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      cb(null, JSON.stringify({ certs: [fakeBase64] }), '');
    });

    const certs = await readSmartcardCertificates('/usr/lib/libykcs11.so');
    expect(certs.size).toBe(1);
    expect(certs.get('SHA256:abc123test')?.subject).toBe('CN=Test User');
  });

  it('handles multi-line worker output with diagnostic logging before JSON', async () => {
    const fakeDer = Buffer.from([0x30, 0x10, 0x01, 0x02]);
    const fakeBase64 = fakeDer.toString('base64');

    vi.spyOn(CertificateParser, 'parseCertificateDer').mockReturnValueOnce({
      subject: 'CN=Multi Line',
      issuer: 'CN=Test CA',
      validFrom: '2026-01-01',
      validTo: '2027-01-01',
      fingerprint: 'SHA256:multiline',
    });

    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      const output = 'some debug log\nanother debug line\n' + JSON.stringify({ certs: [fakeBase64] }) + '\n';
      cb(null, output, '');
    });

    const certs = await readSmartcardCertificates('/usr/lib/libykcs11.so');
    expect(certs.size).toBe(1);
    expect(certs.has('SHA256:multiline')).toBe(true);
  });

  it('handles worker error report gracefully by returning empty map', async () => {
    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      cb(null, JSON.stringify({ error: 'PKCS11 C_Initialize failed: CKR_DEVICE_ERROR' }), '');
    });

    const certs = await readSmartcardCertificates('/usr/lib/libykcs11.so');
    expect(certs.size).toBe(0);
  });

  it('handles worker crash/failure with non-zero exit and no output on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      cb(new Error('Process terminated with SIGTRAP'), '', '');
    });

    const certs = await readSmartcardCertificates('/usr/lib/libykcs11.so');
    expect(certs.size).toBe(0);
  });

  it('still uses worker output if process threw error but wrote valid stdout', async () => {
    const fakeDer = Buffer.from([0x30, 0x05]);
    const fakeBase64 = fakeDer.toString('base64');

    vi.spyOn(CertificateParser, 'parseCertificateDer').mockReturnValueOnce({
      subject: 'CN=Crash After Print',
      issuer: 'CN=Test CA',
      validFrom: '2026-01-01',
      validTo: '2027-01-01',
      fingerprint: 'SHA256:survivor',
    });

    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      // Worker exited with SIGSEGV in C_Finalize after outputting JSON
      cb(new Error('Process killed: SIGSEGV'), JSON.stringify({ certs: [fakeBase64] }), '');
    });

    const certs = await readSmartcardCertificates('/usr/lib/libykcs11.so');
    expect(certs.size).toBe(1);
    expect(certs.has('SHA256:survivor')).toBe(true);
  });

  it('falls back to pkcs11-tool on Windows when certWorker produces no certs', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    let callCount = 0;
    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      callCount++;
      if (callCount === 1) {
        // certWorker fails
        cb(new Error('Cannot find module pkcs11js'), '', '');
        return;
      }
      if (callCount === 2) {
        // pkcs11-tool listing: ID in hex parentheses and plain ID
        const listing = `
Certificate Object, type = X.509 cert
  label:      Authentication
  ID:         1 (0x01)
Certificate Object, type = X.509 cert
  label:      Digital Signature
  ID:         02
`;
        cb(null, listing, '');
        return;
      }
      if (callCount === 3) {
        // read object id 01 - valid ASN.1 DER (starts with 0x30)
        cb(null, Buffer.from([0x30, 0x20, 0xaa, 0xbb]), '');
        return;
      }
      if (callCount === 4) {
        // read object id 02 - non-ASN.1 diagnostic noise (does not start with 0x30)
        cb(null, Buffer.from('Error: object unreadable'), '');
        return;
      }
      cb(null, '', '');
    });

    mockExistsSync.mockImplementation((candidatePath: string) => {
      return candidatePath.includes('pkcs11-tool.exe');
    });

    vi.spyOn(CertificateParser, 'parseCertificateDer').mockReturnValueOnce({
      subject: 'CN=Windows User',
      issuer: 'CN=Windows CA',
      validFrom: '2026-01-01',
      validTo: '2027-01-01',
      fingerprint: 'SHA256:win123',
    });

    const certs = await readSmartcardCertificates('C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll');
    expect(certs.size).toBe(1);
    expect(certs.get('SHA256:win123')?.subject).toBe('CN=Windows User');
  });

  it('returns empty map if Windows fallback cannot find pkcs11-tool.exe', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      cb(new Error('certWorker failed'), '', '');
    });
    mockExistsSync.mockReturnValue(false); // tool not found

    const certs = await readSmartcardCertificates('C:\\Custom\\custom-pkcs11.dll');
    expect(certs.size).toBe(0);
  });

  it('gracefully ignores certificates that fail parsing or throw in parser', async () => {
    const fakeBase64_1 = Buffer.from([0x30, 0x01]).toString('base64');
    const fakeBase64_2 = Buffer.from([0x30, 0x02]).toString('base64');

    vi.spyOn(CertificateParser, 'parseCertificateDer')
      .mockReturnValueOnce(undefined) // returns undefined
      .mockImplementationOnce(() => {
        throw new Error('Corrupted ASN.1 stream');
      });

    mockExecFile.mockImplementation((_file, _args, _options, cb) => {
      cb(null, JSON.stringify({ certs: [fakeBase64_1, fakeBase64_2] }), '');
    });

    const certs = await readSmartcardCertificates('/usr/lib/libykcs11.so');
    expect(certs.size).toBe(0);
  });
});
