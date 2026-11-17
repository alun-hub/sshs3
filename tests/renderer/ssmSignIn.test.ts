import { describe, it, expect, vi } from 'vitest';
import { withSsoRetry, isSsoExpiredError } from '../../src/renderer/src/lib/ssmSignIn';

const sso = { enabled: true as const, sso: { startUrl: 'https://d-1.awsapps.com/start', region: 'eu-north-1' } };
const expired = new Error("Error invoking remote method 'terminal:create': Error: AWS SSO session expired: sign in again, then reconnect.");

describe('ssmSignIn', () => {
  it('recognises the wrapped expiry error', () => {
    expect(isSsoExpiredError(expired)).toBe(true);
    expect(isSsoExpiredError(new Error('boom'))).toBe(false);
  });
  it('signs in once and retries once', async () => {
    const create = vi.fn().mockRejectedValueOnce(expired).mockResolvedValueOnce('ok');
    const login = vi.fn().mockResolvedValue(undefined);
    await expect(withSsoRetry(sso, create, login)).resolves.toBe('ok');
    expect(login).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('does not loop when it fails again', async () => {
    const create = vi.fn().mockRejectedValue(expired);
    await expect(withSsoRetry(sso, create, vi.fn().mockResolvedValue(undefined))).rejects.toBe(expired);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('is single-flight per start URL ("Connect all")', async () => {
    let release!: () => void;
    const login = vi.fn().mockReturnValue(new Promise<void>((r) => { release = r; }));
    const mk = () => vi.fn().mockRejectedValueOnce(expired).mockResolvedValueOnce('ok');
    const runs = [withSsoRetry(sso, mk(), login), withSsoRetry(sso, mk(), login), withSsoRetry(sso, mk(), login)];
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    release();
    await expect(Promise.all(runs)).resolves.toEqual(['ok', 'ok', 'ok']);
    expect(login).toHaveBeenCalledTimes(1);
  });
  it('passes other errors and non-SSO profiles through', async () => {
    const boom = new Error('boom');
    await expect(withSsoRetry(sso, vi.fn().mockRejectedValue(boom), vi.fn())).rejects.toBe(boom);
    const create = vi.fn().mockRejectedValue(expired);
    await expect(withSsoRetry({ enabled: true }, create, vi.fn())).rejects.toBe(expired);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
