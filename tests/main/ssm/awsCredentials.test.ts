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

describe('shareCredentials after a failed refresh', () => {
  it('does not keep serving the failed refresh: the next call asks the provider again', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce({ expiration: new Date(Date.now() + 60_000) }) // inside the refresh margin
      .mockRejectedValueOnce(new Error('token expired')) // the refresh fails
      .mockResolvedValueOnce({ expiration: new Date(Date.now() + 3600_000), accessKeyId: 'fresh' });
    const shared = shareCredentials(provider);
    await shared().then(() => undefined, () => undefined); // the first call triggers the refresh that fails
    await expect(shared()).resolves.toMatchObject({ accessKeyId: 'fresh' });
    expect(provider).toHaveBeenCalledTimes(3);
  });
});

describe('shareCredentials when a refresh inside the margin fails but the credentials in hand still work', () => {
  const soon = (ms: number, id: string) => ({ expiration: new Date(Date.now() + ms), accessKeyId: id });

  it('keeps using them instead of failing the caller (the 5-minute margin is only a head start)', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(soon(3 * 60_000, 'old')) // valid for 3 more minutes, inside the refresh margin
      .mockRejectedValueOnce(new Error('transient proxy error')); // the refresh fails
    const shared = shareCredentials(provider);
    await expect(shared()).resolves.toMatchObject({ accessKeyId: 'old' });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('tries the refresh again on the next call, and switches to the refreshed credentials when it works', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(soon(3 * 60_000, 'old'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(soon(3600_000, 'fresh'));
    const shared = shareCredentials(provider);
    await expect(shared()).resolves.toMatchObject({ accessKeyId: 'old' });
    await expect(shared()).resolves.toMatchObject({ accessKeyId: 'fresh' });
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it('still fails when the credentials have really expired', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(soon(-1000, 'expired')) // already expired: nothing worth falling back to
      .mockRejectedValueOnce(new Error('refresh failed'));
    const shared = shareCredentials(provider);
    await expect(shared()).rejects.toThrow('refresh failed');
  });

  it('still fails when there were never any credentials (the first provider call fails)', async () => {
    const shared = shareCredentials(vi.fn().mockRejectedValue(new Error('no credentials')));
    await expect(shared()).rejects.toThrow('no credentials');
  });

  it('gives every concurrent caller the credentials in hand, with one refresh attempt', async () => {
    let calls = 0;
    const provider = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      if (calls === 1) return soon(2 * 60_000, 'old');
      throw new Error('refresh failed');
    });
    const shared = shareCredentials(provider);
    const results = await Promise.all([shared(), shared(), shared()]);
    expect(results.map((r) => (r as { accessKeyId: string }).accessKeyId)).toEqual(['old', 'old', 'old']);
    expect(provider).toHaveBeenCalledTimes(2); // the first call plus ONE failed refresh, not one per caller
  });
});

describe('shareCredentials single flight', () => {
  it('runs one refresh when many callers see expiring credentials at once', async () => {
    let calls = 0;
    const provider = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { expiration: new Date(Date.now() + (calls === 1 ? 60_000 : 3600_000)) }; // the first result is already inside the margin
    });
    const shared = shareCredentials(provider);
    const results = await Promise.all([shared(), shared(), shared(), shared()]);
    expect(provider).toHaveBeenCalledTimes(2); // the first call plus ONE refresh, not one per caller
    expect(new Set(results).size).toBe(1); // everyone ends up with the refreshed credentials
    await shared();
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('retries a failed provider once for the next call, not once per waiting caller', async () => {
    let calls = 0;
    const provider = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      if (calls === 1) throw new Error('needs MFA');
      return { expiration: new Date(Date.now() + 3600_000) };
    });
    const shared = shareCredentials(provider);
    const first = await Promise.allSettled([shared(), shared(), shared()]);
    expect(first.every((r) => r.status === 'rejected')).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    await expect(shared()).resolves.toBeDefined();
    expect(provider).toHaveBeenCalledTimes(2);
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
