// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAwsRowSignIn } from '../../src/renderer/src/lib/useAwsRowSignIn';

const row = { id: 'r1', startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1' };
const login = vi.fn();
beforeEach(() => {
  login.mockReset();
  window.multissh = { awsSsoLogin: login } as never;
});
afterEach(() => cleanup());

describe('useAwsRowSignIn', () => {
  it('signs in the row (with the network options), marks it busy meanwhile and refreshes afterwards', async () => {
    let release!: () => void;
    login.mockImplementation(() => new Promise<void>((r) => { release = r; }));
    const refresh = vi.fn();
    const network = { customCaPath: '/ca.pem' };
    const { result } = renderHook(() => useAwsRowSignIn(refresh, network));
    let p!: Promise<void>;
    act(() => { p = result.current.signIn(row); });
    expect(result.current.busyId).toBe('r1');
    expect(login).toHaveBeenCalledWith(row.startUrl, row.region, network);
    await act(async () => { release(); await p; });
    expect(result.current.busyId).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('shows the reason when the sign-in fails and does not refresh', async () => {
    login.mockRejectedValue(new Error('Error invoking remote method \'aws-sso:login\': Error: AWS SSO login was cancelled'));
    const refresh = vi.fn();
    const { result } = renderHook(() => useAwsRowSignIn(refresh));
    await act(async () => { await result.current.signIn(row); });
    expect(result.current.error).toBe('AWS SSO login was cancelled');
    expect(result.current.busyId).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
