import { describe, it, expect, vi } from 'vitest';
import { shareCredentials, buildCredentialProvider } from '../../../src/main/aws/awsCredentials';

vi.mock('../../../src/main/aws/buildAwsNodeHttpHandler', () => ({ buildAwsNodeHttpHandler: () => ({}) }));

describe('shareCredentials', () => {
  it('shares one provider call between concurrent and repeated uses', async () => {
    const provider = vi.fn().mockResolvedValue({ expiration: new Date(Date.now() + 3600_000), accessKeyId: 'a' });
    const shared = shareCredentials(provider);
    await Promise.all([shared(), shared(), shared()]);
    await shared();
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('refreshes shortly before expiry and recovers from a failure', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce({ expiration: new Date(Date.now() + 60_000) }) // inside the 5-minute margin
      .mockResolvedValueOnce({ expiration: new Date(Date.now() + 3600_000) });
    const shared = shareCredentials(provider);
    await shared();
    await shared();
    expect(provider).toHaveBeenCalledTimes(2);

    const flaky = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ expiration: new Date(Date.now() + 3600_000) });
    const s2 = shareCredentials(flaky);
    await expect(s2()).rejects.toThrow('boom');
    await expect(s2()).resolves.toBeDefined();
  });
});

describe('buildCredentialProvider validation', () => {
  it('rejects unsafe profile names and incomplete SSO targets before touching the SDK', () => {
    expect(() => buildCredentialProvider({ kind: 'profile', name: '$(id)' })).toThrow(/Invalid AWS CLI profile/);
    expect(() => buildCredentialProvider({ kind: 'sso', sso: { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1' } })).toThrow(/account and role/);
  });
  it('builds providers for valid sources', () => {
    expect(typeof buildCredentialProvider({ kind: 'default' })).toBe('function');
    expect(typeof buildCredentialProvider({ kind: 'profile', name: 'corp-sso' })).toBe('function');
    expect(typeof buildCredentialProvider({ kind: 'sso', sso: { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' } })).toBe('function');
  });
});
