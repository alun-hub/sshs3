// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AwsSsoStatusBadge } from '../../src/renderer/src/components/aws/AwsSsoStatusBadge';
import { AwsEnabledContext } from '../../src/renderer/src/lib/awsEnabled';

const CORP = 'https://corp.awsapps.com/start';
let status: Record<string, { status: string; expiresAt?: string }> = {};
let settings: Record<string, unknown> = {};
let profiles: unknown[] = [];

const api = {
  settingsGet: vi.fn(async () => settings),
  profilesGet: vi.fn(async () => ({ ssh: profiles, s3: [] })),
  awsSsoStatus: vi.fn(async (url: string) => status[url] ?? { status: 'missing' }),
  awsSsmListProfiles: vi.fn(async () => []),
  awsSsoListAccountsCached: vi.fn(async () => []),
  awsSsoListRolesCached: vi.fn(async () => []),
  awsSsmScanCancel: vi.fn(async () => undefined),
  onAwsSsmScanProgress: vi.fn(() => () => {}),
  awsSsoLogin: vi.fn(async (url: string) => { status[url] = { status: 'valid', expiresAt: '2030-05-06T07:08:00' }; return { accessToken: 'x', expiresAt: 'y' }; }),
};

const ssmProfile = { id: 'p1', name: 'web', host: 'i-0123456789abcdef0', username: 'u', authType: 'agent', ssm: { enabled: true, region: 'eu-north-1', sso: { startUrl: CORP, region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' } } };

const show = (enabled = true, onOpenAwsSettings = vi.fn()) => {
  render(<AwsEnabledContext.Provider value={enabled}><AwsSsoStatusBadge onOpenAwsSettings={onOpenAwsSettings} /></AwsEnabledContext.Provider>);
  return onOpenAwsSettings;
};

beforeEach(() => {
  status = {};
  settings = { awsSignIns: [{ id: 'a', name: 'Corp', startUrl: CORP, region: 'us-east-1' }] };
  profiles = [];
  Object.values(api).forEach((f) => f.mockClear());
  window.multissh = { ...api } as never;
});
afterEach(() => cleanup());

describe('AwsSsoStatusBadge', () => {
  it('is not shown while AWS features are off', () => {
    show(false);
    expect(screen.queryByTestId('aws-status-btn')).toBeNull();
  });

  it('is green when signed in and grey when not', async () => {
    status[CORP] = { status: 'valid', expiresAt: '2030-05-06T07:08:00' };
    show();
    await waitFor(() => expect(screen.getByTestId('aws-status-btn')).toHaveAttribute('title', 'AWS: signed in'));
    cleanup();
    status = {};
    show();
    await waitFor(() => expect(screen.getByTestId('aws-status-btn')).toHaveAttribute('title', 'AWS: not signed in'));
  });

  it('turns amber when a sign-in that saved SSM profiles use has expired, and signs in from the popover', async () => {
    profiles = [ssmProfile];
    status[CORP] = { status: 'expired' };
    show();
    const button = screen.getByTestId('aws-status-btn');
    await waitFor(() => expect(button).toHaveAttribute('title', expect.stringContaining('has expired')));
    fireEvent.click(button);
    const popover = await screen.findByRole('dialog', { name: 'AWS sign-ins' });
    expect(within(popover).getByText('Corp')).toBeInTheDocument();
    expect(await within(popover).findByText('Sign-in expired. Sign in again.')).toBeInTheDocument();
    fireEvent.click(within(popover).getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.awsSsoLogin).toHaveBeenCalledWith(CORP, 'us-east-1', undefined));
    await waitFor(() => expect(button).toHaveAttribute('title', 'AWS: signed in'));
    expect(within(popover).getByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
  });

  it('shows a helpful empty state and opens the AWS settings', async () => {
    settings = {};
    const open = show();
    fireEvent.click(screen.getByTestId('aws-status-btn'));
    const popover = await screen.findByRole('dialog', { name: 'AWS sign-ins' });
    expect(within(popover).getByText(/No AWS sign-ins yet/)).toBeInTheDocument();
    fireEvent.click(within(popover).getByRole('button', { name: /AWS settings/ }));
    expect(open).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'AWS sign-ins' })).toBeNull();
  });

  it('closes on Escape and returns focus to the button', async () => {
    show();
    const button = screen.getByTestId('aws-status-btn');
    fireEvent.click(button);
    await screen.findByRole('dialog', { name: 'AWS sign-ins' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'AWS sign-ins' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('opens the import dialog from the popover', async () => {
    show();
    fireEvent.click(screen.getByTestId('aws-status-btn'));
    fireEvent.click(await screen.findByRole('button', { name: /Add instances from AWS/ }));
    expect(await screen.findByRole('dialog', { name: 'Import instances from AWS' })).toBeInTheDocument();
  });
});
