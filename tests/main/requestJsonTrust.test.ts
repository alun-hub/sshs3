import { describe, it, expect, vi, afterEach } from 'vitest';
import https from 'node:https';
import { EventEmitter } from 'node:events';

const { getCAs, getMerged } = vi.hoisted(() => ({
  getCAs: vi.fn<() => string[]>(),
  getMerged: vi.fn<() => string[]>(),
}));
vi.mock('../../src/main/crypto/SystemTrustStore', () => ({
  SystemTrustStore: { getCAs, getMergedRootCertificates: getMerged },
}));

import { requestJson } from '../../src/main/oauth/requestJson';

/** Replaces https.request with a stub that records its options and answers `{}`. */
function stubHttps(): { optionsOf: () => Record<string, unknown> } {
  let seen: Record<string, unknown> = {};
  vi.spyOn(https, 'request').mockImplementation(((_url: unknown, options: Record<string, unknown>, cb: (res: unknown) => void) => {
    seen = options;
    const req = Object.assign(new EventEmitter(), { write: vi.fn(), destroy: vi.fn(), end: () => {
      const res = Object.assign(new EventEmitter(), { statusCode: 200 });
      cb(res);
      res.emit('data', Buffer.from('{}'));
      res.emit('end');
    } });
    return req;
  }) as never);
  return { optionsOf: () => seen };
}

describe('requestJson trust roots', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getCAs.mockReset();
    getMerged.mockReset();
  });

  it('verifies against Node roots plus the OS trust store when the caller names no CA', async () => {
    getCAs.mockReturnValue(['OS-ROOT']);
    getMerged.mockReturnValue(['MOZILLA-ROOT', 'OS-ROOT']);
    const stub = stubHttps();
    await requestJson('https://ca.example.com/x', { method: 'GET', timeoutMs: 1000 });
    expect(stub.optionsOf().ca).toEqual(['MOZILLA-ROOT', 'OS-ROOT']);
    expect(stub.optionsOf().rejectUnauthorized).toBe(true);
  });

  it('lets an explicit CA replace the defaults', async () => {
    getCAs.mockReturnValue(['OS-ROOT']);
    getMerged.mockReturnValue(['MOZILLA-ROOT', 'OS-ROOT']);
    const stub = stubHttps();
    await requestJson('https://ca.example.com/x', { method: 'GET', timeoutMs: 1000, ca: 'PINNED' });
    expect(stub.optionsOf().ca).toBe('PINNED');
  });

  it('keeps Node defaults when the OS store could not be read', async () => {
    getCAs.mockReturnValue([]);
    const stub = stubHttps();
    await requestJson('https://ca.example.com/x', { method: 'GET', timeoutMs: 1000 });
    expect(stub.optionsOf().ca).toBeUndefined();
    expect(getMerged).not.toHaveBeenCalled();
  });
});
