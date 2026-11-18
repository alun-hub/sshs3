// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AwsSsoSignInPanel } from '../../src/renderer/src/components/AwsSsoSignInPanel';
import type { AwsSsoValue } from '../../src/renderer/src/lib/useAwsSsoSignIn';

const URL_ = 'https://d-1.awsapps.com/start';
let status: { status: string; expiresAt?: string } = { status: 'missing' };
const api = {
  awsSsoStatus: vi.fn(async () => status),
  awsSsoLogin: vi.fn(async () => { status = { status: 'valid', expiresAt: '2030-05-06T07:08:00' }; return { accessToken: 'x', expiresAt: 'y' }; }),
  awsSsoListAccountsCached: vi.fn(async () => [{ accountId: '123456789012', accountName: 'Prod' }, { accountId: '210987654321' }]),
  awsSsoListRolesCached: vi.fn(async () => [{ roleName: 'Admin' }, { roleName: 'ReadOnly' }]),
};

const Harness: React.FC<{ initial?: Partial<AwsSsoValue>; network?: { rejectUnauthorized?: boolean }; spy?: (v: AwsSsoValue) => void }> = ({ initial, network, spy }) => {
  const [value, setValue] = useState<AwsSsoValue>({ startUrl: '', region: 'us-east-1', ...initial });
  spy?.(value);
  return <AwsSsoSignInPanel value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} network={network} />;
};

beforeEach(() => {
  status = { status: 'missing' };
  Object.values(api).forEach((f) => f.mockClear());
  window.multissh = { ...api } as never;
});
afterEach(() => cleanup());

describe('AwsSsoSignInPanel', () => {
  it('asks for a start URL first and keeps the sign-in button disabled', () => {
    render(<Harness />);
    expect(screen.getByText('Enter the start URL and region to sign in')).toBeInTheDocument();
    expect(screen.getByTestId('aws-sso-sign-in')).toBeDisabled();
  });

  it('signs in with a visible button, then lists accounts and roles from the cached sign-in', async () => {
    let latest!: AwsSsoValue;
    render(<Harness spy={(v) => { latest = v; }} />);
    fireEvent.change(screen.getByTestId('aws-sso-start-url'), { target: { value: `${URL_}#/` } });
    expect(latest.startUrl).toBe(URL_); // a pasted #/ is dropped
    await waitFor(() => expect(screen.getByTestId('aws-sso-status')).toHaveTextContent('Not signed in'));
    const button = screen.getByRole('button', { name: 'Sign in with AWS SSO' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('aws-sso-status')).toHaveTextContent('Signed in until 2030-05-06 07:08'));
    expect(api.awsSsoLogin).toHaveBeenCalledWith(URL_, 'us-east-1', undefined);
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();

    const account = await screen.findByTestId('aws-sso-account');
    await waitFor(() => expect(account.querySelectorAll('option')).toHaveLength(3));
    expect(screen.getByRole('option', { name: 'Prod (123456789012)' })).toBeInTheDocument();
    fireEvent.change(account, { target: { value: '123456789012' } });
    await waitFor(() => expect(api.awsSsoListRolesCached).toHaveBeenCalledWith({ startUrl: URL_, region: 'us-east-1', accountId: '123456789012', network: undefined }));
    const role = screen.getByTestId('aws-sso-role');
    await waitFor(() => expect(role).toBeEnabled());
    fireEvent.change(role, { target: { value: 'Admin' } });
    expect(latest).toMatchObject({ accountId: '123456789012', roleName: 'Admin' });
  });

  it('loads the lists straight away when the sign-in is still valid, including the role of an existing profile', async () => {
    status = { status: 'valid', expiresAt: '2030-05-06T07:08:00' };
    render(<Harness initial={{ startUrl: URL_, accountId: '123456789012', roleName: 'Admin' }} />);
    await waitFor(() => expect(api.awsSsoListAccountsCached).toHaveBeenCalled());
    await waitFor(() => expect(api.awsSsoListRolesCached).toHaveBeenCalledWith(expect.objectContaining({ accountId: '123456789012' })));
    expect(api.awsSsoLogin).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('aws-sso-role')).toHaveValue('Admin'));
  });

  it('says when the sign-in has expired', async () => {
    status = { status: 'expired' };
    render(<Harness initial={{ startUrl: URL_ }} />);
    await waitFor(() => expect(screen.getByTestId('aws-sso-status')).toHaveTextContent('Sign-in expired. Sign in again.'));
    expect(screen.getByRole('button', { name: 'Sign in with AWS SSO' })).toBeEnabled();
    expect(api.awsSsoListAccountsCached).not.toHaveBeenCalled();
  });

  it('falls back to typing account and role when the lists cannot be read', async () => {
    status = { status: 'valid', expiresAt: '2030-05-06T07:08:00' };
    api.awsSsoListAccountsCached.mockRejectedValueOnce(new Error('not allowed'));
    render(<Harness initial={{ startUrl: URL_ }} />);
    expect(await screen.findByText('Account ID')).toBeInTheDocument();
    expect(screen.getByText('Role Name')).toBeInTheDocument();
  });

  it('shows a sign-in failure and passes the profile network options along', async () => {
    api.awsSsoLogin.mockRejectedValueOnce(new Error('AWS SSO login was cancelled'));
    render(<Harness initial={{ startUrl: URL_ }} network={{ rejectUnauthorized: false }} />);
    await waitFor(() => expect(api.awsSsoStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('aws-sso-sign-in'));
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled');
    expect(api.awsSsoLogin).toHaveBeenCalledWith(URL_, 'us-east-1', { rejectUnauthorized: false });
  });
});
