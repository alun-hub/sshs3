// @vitest-environment jsdom
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AwsSettingsSection } from '../../src/renderer/src/components/SettingsModal/AwsSettingsSection';
import type { AwsNetworkSettings, AwsSignIn } from '../../src/shared/types/aws';

vi.mock('../../src/renderer/src/lib/usePolicy', async (orig) => ({ ...(await orig<object>()), usePolicy: () => policy }));
let policy: unknown = null;

const api = {
  awsSsoStatus: vi.fn(async (url: string) => (url.includes('corp') ? { status: 'valid', expiresAt: '2030-05-06T07:08:00' } : { status: 'missing' })),
  awsSsoLogin: vi.fn(async () => ({ accessToken: 'x', expiresAt: 'y' })),
  awsSsmListProfiles: vi.fn(async () => [{ name: 'a', kind: 'sso' }, { name: 'b', kind: 'keys' }, { name: 'c', kind: 'sso' }]),
  awsSsmCheckTools: vi.fn(async () => ({ aws: { found: true, version: '2.38.0' }, plugin: { found: true, version: '1.2.896.0', ok: true } })),
  awsSsoListAccountsCached: vi.fn(async () => []),
  dialogOpenFile: vi.fn(async () => '/etc/corp-ca.pem'),
};

let latest: { enableAws: boolean; awsSignIns: AwsSignIn[]; awsRegions: string; awsNetwork: AwsNetworkSettings };

const Harness: React.FC<{ initial?: Partial<typeof latest>; managedText?: string; managedIds?: string[] }> = ({ initial, managedText, managedIds = [] }) => {
  const [enableAws, setEnableAws] = useState(initial?.enableAws ?? false);
  const [awsSignIns, setAwsSignIns] = useState<AwsSignIn[]>(initial?.awsSignIns ?? []);
  const [awsRegions, setAwsRegions] = useState(initial?.awsRegions ?? '');
  const [awsNetwork, setAwsNetwork] = useState<AwsNetworkSettings>(initial?.awsNetwork ?? {});
  latest = { enableAws, awsSignIns, awsRegions, awsNetwork };
  const form = { enableAws, setEnableAws, awsSignIns, setAwsSignIns, awsRegions, setAwsRegions, awsNetwork, setAwsNetwork, awsManagedSignIns: managedText, isManaged: (id: string) => managedIds.includes(id) };
  return <AwsSettingsSection form={form as never} />;
};

beforeEach(() => { policy = null; Object.values(api).forEach((f) => f.mockClear()); window.multissh = { ...api } as never; });
afterEach(() => cleanup());

describe('AwsSettingsSection', () => {
  it('shows only the switch until AWS features are enabled', async () => {
    render(<Harness />);
    expect(screen.getByLabelText(/Enable AWS features/)).not.toBeChecked();
    expect(screen.queryByText('AWS sign-ins')).toBeNull();
    fireEvent.click(screen.getByLabelText(/Enable AWS features/));
    expect(latest.enableAws).toBe(true);
    expect(await screen.findByText('AWS sign-ins')).toBeInTheDocument();
    expect(screen.getByText('Regions to search')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
  });

  it('lists managed sign-ins locked and the user\'s own with edit/remove and their sign-in status', async () => {
    render(<Harness initial={{ enableAws: true, awsSignIns: [{ id: 'u1', name: 'Mine', startUrl: 'https://mine.awsapps.com/start', region: 'eu-north-1' }] }} managedText="Corp|https://corp.awsapps.com/start|us-east-1" />);
    const list = await screen.findByRole('list', { name: 'AWS sign-ins' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByLabelText('Managed by your organization')).toBeInTheDocument();
    expect(within(items[0]).queryByLabelText(/^Edit /)).toBeNull();
    expect(within(items[0]).queryByLabelText(/^Remove /)).toBeNull();
    await waitFor(() => expect(within(items[0]).getByText('Signed in until 2030-05-06 07:08')).toBeInTheDocument());
    await waitFor(() => expect(within(items[1]).getByText('Not signed in')).toBeInTheDocument());
    expect(within(items[1]).getByRole('button', { name: 'Sign in to Mine' })).toBeInTheDocument();
    fireEvent.click(within(items[1]).getByLabelText('Remove Mine'));
    expect(latest.awsSignIns).toEqual([]);
  });

  it('adds a sign-in after validating the start URL, region and name', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add sign-in/ }));
    const group = screen.getByRole('group', { name: 'New sign-in' });
    const add = within(group).getByRole('button', { name: 'Add sign-in' });
    expect(add).toBeDisabled();
    fireEvent.change(within(group).getByPlaceholderText('e.g. Company'), { target: { value: 'Company' } });
    fireEvent.change(within(group).getByTestId('settings-sso-start-url'), { target: { value: 'https://d-123.awsapps.com/start#/' } });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(latest.awsSignIns).toHaveLength(1);
    expect(latest.awsSignIns[0]).toMatchObject({ name: 'Company', startUrl: 'https://d-123.awsapps.com/start', region: 'us-east-1' });
    expect(screen.queryByRole('group', { name: 'New sign-in' })).toBeNull();
  });

  it('signs in from the list without sending any network settings (main reads them from the saved AWS settings)', async () => {
    render(<Harness initial={{ enableAws: true, awsSignIns: [{ id: 'u1', name: 'Mine', startUrl: 'https://mine.awsapps.com/start', region: 'eu-north-1' }], awsNetwork: { customCaPath: '/ca.pem' } }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Mine' }));
    await waitFor(() => expect(api.awsSsoLogin).toHaveBeenCalledWith('https://mine.awsapps.com/start', 'eu-north-1'));
  });

  it('shows the valid regions and flags the ones it will ignore', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    fireEvent.change(await screen.findByLabelText('Regions to search'), { target: { value: 'eu-north-1, nowhere, eu-west-1' } });
    expect(screen.getByText(/Searching 2 regions/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Not a region, ignored: nowhere');
  });

  it('edits the proxy and CA settings and reports detected AWS CLI profiles', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    fireEvent.change(await screen.findByPlaceholderText('http://proxy.example.com:3128'), { target: { value: ' http://proxy.corp:3128 ' } });
    expect(latest.awsNetwork.httpsProxy).toBe('http://proxy.corp:3128');
    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
    await waitFor(() => expect(latest.awsNetwork.customCaPath).toBe('/etc/corp-ca.pem'));
    fireEvent.click(screen.getByLabelText('Verify TLS certificates'));
    expect(latest.awsNetwork.rejectUnauthorized).toBe(false);
    expect(await screen.findByText(/Detected 3 AWS CLI profiles: 2 SSO, 1 access keys\./)).toBeInTheDocument();
  });

  it('Enter in the sign-in editor adds the sign-in and is not left to the surrounding Settings form', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add sign-in/ }));
    const group = screen.getByRole('group', { name: 'New sign-in' });
    fireEvent.change(within(group).getByPlaceholderText('e.g. Company'), { target: { value: 'Company' } });
    fireEvent.change(within(group).getByTestId('settings-sso-start-url'), { target: { value: 'https://d-123.awsapps.com/start' } });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Add sign-in' })).toBeEnabled());
    // fireEvent returns false when the default action (here: submitting the Settings form) was prevented.
    const notPrevented = fireEvent.keyDown(within(group).getByPlaceholderText('e.g. Company'), { key: 'Enter' });
    expect(notPrevented).toBe(false);
    expect(latest.awsSignIns).toHaveLength(1);
    expect(latest.awsSignIns[0]).toMatchObject({ name: 'Company' });
    expect(screen.queryByRole('group', { name: 'New sign-in' })).toBeNull();
  });

  it('Enter does nothing while the sign-in is not valid yet, but still does not submit Settings', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add sign-in/ }));
    const group = screen.getByRole('group', { name: 'New sign-in' });
    const notPrevented = fireEvent.keyDown(within(group).getByPlaceholderText('e.g. Company'), { key: 'Enter' });
    expect(notPrevented).toBe(false);
    expect(latest.awsSignIns).toEqual([]);
    expect(screen.getByRole('group', { name: 'New sign-in' })).toBeInTheDocument();
  });

  it('Escape closes the sign-in editor without saving it', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add sign-in/ }));
    expect(screen.getByRole('group', { name: 'New sign-in' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: 'New sign-in' })).toBeNull());
    expect(latest.awsSignIns).toEqual([]);
  });

  it('warns while TLS certificates are not verified, and only then', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    const verify = await screen.findByLabelText('Verify TLS certificates');
    expect(screen.queryByText(/Certificates are not verified/)).toBeNull();
    fireEvent.click(verify);
    expect(screen.getByText(/Certificates are not verified/)).toBeInTheDocument();
    fireEvent.click(verify);
    expect(screen.queryByText(/Certificates are not verified/)).toBeNull();
  });

  it('groups the tool status under one name', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    expect(await screen.findByRole('group', { name: 'Required tools' })).toBeInTheDocument();
  });

  it('labels the CA certificate field by its own text and names the Browse button', async () => {
    render(<Harness initial={{ enableAws: true }} />);
    const field = await screen.findByLabelText('Custom CA certificate (PEM)');
    expect(field.tagName).toBe('INPUT');
    expect(screen.getByRole('button', { name: 'Browse for a CA certificate' })).toBeInTheDocument();
  });

  it('locks the switch when the policy blocks AWS', () => {
    policy = { managed: [], features: { awsSsm: false }, warnings: [] };
    render(<Harness />);
    expect(screen.getByLabelText(/Enable AWS features/)).toBeDisabled();
    expect(screen.getByText('Disabled by your administrator.')).toBeInTheDocument();
  });
});
