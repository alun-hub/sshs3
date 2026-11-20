import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertSsmSignedIn } from '../../../src/main/ipc/ssmPreflight';
import { AwsSsoAuthService } from '../../../src/main/aws/AwsSsoAuthService';
import { parseSsoTokenCache } from '../../../src/shared/types/aws';

const NOW = Date.parse('2026-11-17T12:00:00Z');

describe('parseSsoTokenCache', () => {
  it('classifies tokens', () => {
    expect(parseSsoTokenCache({ accessToken: 't', expiresAt: '2026-11-17T13:00:00Z' }, NOW)).toBe('valid');
    expect(parseSsoTokenCache({ accessToken: 't', expiresAt: '2026-11-17T12:00:30Z' }, NOW)).toBe('expired'); // inside skew
    expect(parseSsoTokenCache({ accessToken: 't', expiresAt: '2026-11-17T11:00:00Z' }, NOW)).toBe('expired');
    for (const bad of [null, 'x', {}, { accessToken: '', expiresAt: '2030-01-01T00:00:00Z' }, { accessToken: 't', expiresAt: 'nope' }]) {
      expect(parseSsoTokenCache(bad, NOW)).toBe('missing');
    }
  });
});

describe('assertSsmSignedIn', () => {
  const startUrl = 'https://d-1.awsapps.com/start';
  const ssm = { enabled: true as const, sso: { startUrl, region: 'eu-north-1' } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-pf-'));
  const svc = new AwsSsoAuthService({ ssoCacheDir: dir } as never);

  it('skips profiles that do not use sshs3 SSO', async () => {
    await expect(assertSsmSignedIn(svc, undefined)).resolves.toBeUndefined();
    await expect(assertSsmSignedIn(svc, { enabled: true })).resolves.toBeUndefined();
    await expect(assertSsmSignedIn(svc, { enabled: true, awsProfile: 'p' })).resolves.toBeUndefined();
  });
  it('is blocked by the awsSsm policy, also for profiles without SSO', async () => {
    const off = { settings: {}, features: { awsSsm: false } };
    await expect(assertSsmSignedIn(svc, { enabled: true }, off)).rejects.toThrow(/disabled by your administrator/);
    await expect(assertSsmSignedIn(svc, undefined, off)).resolves.toBeUndefined();
    await expect(assertSsmSignedIn(svc, { enabled: true }, { settings: {}, features: {} })).resolves.toBeUndefined();
  });
  it('rejects a missing or expired token with the expiry prefix, accepts a valid one', async () => {
    await expect(assertSsmSignedIn(svc, ssm)).rejects.toThrow(/^AWS SSO session expired/);
    const file = path.join(dir, `${crypto.createHash('sha1').update(startUrl).digest('hex')}.json`);
    fs.writeFileSync(file, JSON.stringify({ accessToken: 't', expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(assertSsmSignedIn(svc, ssm)).rejects.toThrow(/^AWS SSO session expired/);
    fs.writeFileSync(file, JSON.stringify({ accessToken: 't', expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
    await expect(assertSsmSignedIn(svc, ssm)).resolves.toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
