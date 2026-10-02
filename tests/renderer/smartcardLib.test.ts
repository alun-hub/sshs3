import { describe, it, expect } from 'vitest';
import { pickDefaultPkcs11Lib, pkcs11PlaceholderPath } from '../../src/renderer/src/lib/smartcard';
import { accessConfigProblem } from '../../src/renderer/src/lib/accessConfig';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

describe('pickDefaultPkcs11Lib', () => {
  it('prefers p11-kit by name or by file name, wherever it is in the list', () => {
    expect(
      pickDefaultPkcs11Lib([
        { name: 'YubiKey (libykcs11)', path: '/usr/lib64/libykcs11.so.2' },
        { name: 'p11-kit', path: '/usr/lib64/p11-kit-proxy.so' },
      ])
    ).toBe('/usr/lib64/p11-kit-proxy.so');
    expect(pickDefaultPkcs11Lib([{ path: '/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so' }, { path: '/x/opensc.so' }])).toBe(
      '/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so'
    );
  });

  it('falls back to the first module, and to nothing when none were found', () => {
    expect(pickDefaultPkcs11Lib([{ name: 'OpenSC', path: '/a.so' }, { name: 'Net iD', path: '/b.so' }])).toBe('/a.so');
    expect(pickDefaultPkcs11Lib([])).toBeUndefined();
  });
});

describe('pkcs11PlaceholderPath', () => {
  it('shows the detected default, else a generic p11-kit path (never a vendor module)', () => {
    expect(pkcs11PlaceholderPath('/usr/lib64/libykcs11.so.2')).toBe('/usr/lib64/libykcs11.so.2');
    expect(pkcs11PlaceholderPath()).toBe('/usr/lib64/p11-kit-proxy.so');
    expect(pkcs11PlaceholderPath()).not.toMatch(/iidp11/);
  });
});

describe('accessConfigProblem', () => {
  const base: SSHConnectionConfig = { id: '1', name: 'n', host: 'h', username: 'u', authType: 'agent' };

  it('requires host and user', () => {
    expect(accessConfigProblem({ ...base, host: ' ' })).toMatch(/host and user/);
    expect(accessConfigProblem({ ...base, username: '' })).toMatch(/host and user/);
    expect(accessConfigProblem(base)).toBeNull();
  });

  it('requires a PKCS#11 library for smartcard profiles', () => {
    expect(accessConfigProblem({ ...base, authType: 'smartcard' })).toMatch(/PKCS#11/);
    expect(accessConfigProblem({ ...base, authType: 'smartcard', pkcs11LibPath: '  ' })).toMatch(/PKCS#11/);
    expect(accessConfigProblem({ ...base, authType: 'smartcard', pkcs11LibPath: '/x.so' })).toBeNull();
  });

  it('requires a key file for non-resident FIDO2 only', () => {
    expect(accessConfigProblem({ ...base, authType: 'fido2' })).toMatch(/key file/);
    expect(accessConfigProblem({ ...base, authType: 'fido2', privateKeyPath: '/k_sk' })).toBeNull();
    expect(accessConfigProblem({ ...base, authType: 'fido2', fido2Resident: true })).toBeNull();
  });

  it('does not block password, agent or key-file profiles', () => {
    for (const authType of ['password', 'agent', 'privateKey'] as const) {
      expect(accessConfigProblem({ ...base, authType })).toBeNull();
    }
  });
});
