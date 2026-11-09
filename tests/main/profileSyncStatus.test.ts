import { describe, it, expect } from 'vitest';
import { toProfileSyncStatus, type SyncStatusRuntime } from '../../src/main/services/profileSyncStatus';
import type { SyncConfigData } from '../../src/main/services/SyncConfigStore';

const config = (extra: Record<string, unknown> = {}) => ({ ...extra }) as unknown as SyncConfigData;
const runtime = (extra: Partial<SyncStatusRuntime> = {}): SyncStatusRuntime => ({
  topologyUnlocked: false,
  credentialsUnlocked: false,
  comparison: undefined,
  smartcardAvailable: false,
  ...extra,
});

describe('toProfileSyncStatus', () => {
  it('describes an unconfigured machine', () => {
    expect(toProfileSyncStatus(config(), runtime())).toMatchObject({
      configured: false,
      target: undefined,
      targetConfig: undefined,
      hasLocalSalts: false,
      topologyUnlocked: false,
      credentialsUnlocked: false,
      autoSync: false,
      smartcardLinked: false,
      smartcardAvailable: false,
    });
  });

  describe('target', () => {
    it.each(['sftp', 's3'] as const)('reports a %s target and its connection details for the editor form', (type) => {
      const sftpConfig = { host: 'h' };
      const s3Config = { region: 'eu' };
      const status = toProfileSyncStatus(config({ target: { id: 't', name: 'My target', type, sftpConfig, s3Config }, remoteBasePath: 'base' }), runtime());

      expect(status.configured).toBe(true);
      expect(status.target).toEqual({ id: 't', name: 'My target', type });
      expect(status.targetConfig).toEqual({ type, sftpConfig, s3Config });
      expect(status.remoteBasePath).toBe('base');
    });

    it('counts a local-type target as configured but does not expose it as a sync target', () => {
      const status = toProfileSyncStatus(config({ target: { id: 't', name: 'n', type: 'local' } }), runtime());

      expect(status.configured).toBe(true);
      expect(status.target).toBeUndefined();
      expect(status.targetConfig).toBeUndefined();
    });
  });

  describe('hasLocalSalts (decides whether the next password entry needs confirming)', () => {
    it.each([
      [{}, false],
      [{ topologySaltBase64: 'a' }, false],
      [{ credentialsSaltBase64: 'b' }, false],
      [{ topologySaltBase64: '', credentialsSaltBase64: 'b' }, false],
      [{ topologySaltBase64: 'a', credentialsSaltBase64: 'b' }, true],
    ])('for %j is %s: both salts must be there', (salts, expected) => {
      expect(toProfileSyncStatus(config(salts), runtime()).hasLocalSalts).toBe(expected);
    });
  });

  describe('smartcard', () => {
    it('is linked, with its library path, when the config has a smartcard', () => {
      const status = toProfileSyncStatus(config({ smartcardSync: { pkcs11LibPath: '/usr/lib/opensc-pkcs11.so' } }), runtime());
      expect(status.smartcardLinked).toBe(true);
      expect(status.smartcardLibPath).toBe('/usr/lib/opensc-pkcs11.so');
    });

    it('is not linked without one', () => {
      const status = toProfileSyncStatus(config(), runtime());
      expect(status.smartcardLinked).toBe(false);
      expect(status.smartcardLibPath).toBeUndefined();
    });

    it('availability is the live runtime fact, independent of whether a card is linked', () => {
      expect(toProfileSyncStatus(config(), runtime({ smartcardAvailable: true })).smartcardAvailable).toBe(true);
      expect(toProfileSyncStatus(config({ smartcardSync: { pkcs11LibPath: 'x' } }), runtime({ smartcardAvailable: false })).smartcardAvailable).toBe(false);
    });
  });

  it('autoSync is a strict boolean, whatever was stored', () => {
    expect(toProfileSyncStatus(config({ autoSync: true }), runtime()).autoSync).toBe(true);
    expect(toProfileSyncStatus(config({ autoSync: false }), runtime()).autoSync).toBe(false);
    expect(toProfileSyncStatus(config({ autoSync: undefined }), runtime()).autoSync).toBe(false);
  });

  it('passes the live unlock state and the last comparison through, and the last sync time from the config', () => {
    const comparison = { categories: [] } as any;
    const status = toProfileSyncStatus(
      config({ lastSyncAt: '2026-11-09T10:00:00.000Z' }),
      runtime({ topologyUnlocked: true, credentialsUnlocked: false, comparison })
    );

    expect(status.topologyUnlocked).toBe(true);
    expect(status.credentialsUnlocked).toBe(false);
    expect(status.comparison).toBe(comparison);
    expect(status.lastSyncAt).toBe('2026-11-09T10:00:00.000Z');
  });

  it('does not modify its inputs', () => {
    const c = Object.freeze(config({ target: { id: 't', name: 'n', type: 's3' } }));
    const r = Object.freeze(runtime());
    expect(() => toProfileSyncStatus(c, r)).not.toThrow();
  });
});
