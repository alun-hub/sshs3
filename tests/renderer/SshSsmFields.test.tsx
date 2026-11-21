// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SshSsmFields } from '../../src/renderer/src/components/ConnectionModal/SshSsmFields';
import { AwsEnabledContext } from '../../src/renderer/src/lib/awsEnabled';
import type { SshSsmConfig } from '../../src/shared/types/ssm';

const CORP = 'https://corp.awsapps.com/start';
const api = {
  settingsGet: vi.fn(async () => ({ awsSignIns: [{ id: 's1', name: 'Corp', startUrl: CORP, region: 'us-east-1', lastAccountId: '123456789012', lastRoleName: 'Dev' }, { id: 's2', name: 'Lab', startUrl: 'https://lab.awsapps.com/start', region: 'eu-north-1' }] })),
  awsSsmListProfiles: vi.fn(async () => [{ name: 'keys', kind: 'keys' }, { name: 'corp-sso', kind: 'sso' }]),
  awsSsmCheckTools: vi.fn(async () => ({ aws: { found: true, version: '2.38.0' }, plugin: { found: true, version: '1.2.896.0', ok: true } })),
  awsSsoStatus: vi.fn(async () => ({ status: 'missing' })),
  awsSsoListAccountsCached: vi.fn(async () => []),
  policyGet: vi.fn(async () => ({ managed: [], features: {}, warnings: [] })),
  profilesGet: vi.fn(async () => ({ ssh: [], s3: [] })),
  awsSsoListRolesCached: vi.fn(async () => []),
  awsSsmScan: vi.fn(async () => ({
    instances: [{ instanceId: 'i-0abcdef0123456789', name: 'web-1', platformName: 'Ubuntu', platformType: 'Linux', ipAddress: '10.0.0.5', region: 'eu-north-1', targetId: 'default' }],
    skipped: [], truncated: false, searched: 1,
  })),
  awsSsmScanCancel: vi.fn(async () => undefined),
  onAwsSsmScanProgress: vi.fn(() => () => {}),
};

let latest: { ssm?: SshSsmConfig; host?: string; username?: string };
/** What the last `onChange` passed as its second argument (kept apart: the harness re-renders and resets `latest`). */
let lastExtra: { host?: string; username?: string } | undefined;
const Harness = ({ initial }: { initial?: SshSsmConfig }) => {
  const [ssm, setSsm] = useState<SshSsmConfig | undefined>(initial);
  latest = { ssm };
  return (
    <AwsEnabledContext.Provider value={true}>
      <SshSsmFields ssm={ssm} host="i-0123456789abcdef0" onChange={(next, extra) => { setSsm(next); lastExtra = extra; latest = { ssm: next, ...extra }; }} />
    </AwsEnabledContext.Provider>
  );
};

beforeEach(() => { lastExtra = undefined; Object.values(api).forEach((f) => f.mockClear()); window.multissh = { ...api } as never; });
afterEach(() => cleanup());

describe('SshSsmFields (simplified)', () => {
  it('starts on the first saved sign-in when SSM is switched on and lists the others', async () => {
    render(<Harness />);
    await waitFor(() => expect(api.settingsGet).toHaveBeenCalled());
    // the saved sign-ins arrive asynchronously; the switch reads them when it is clicked
    await act(async () => { await api.settingsGet.mock.results[0].value; });
    fireEvent.click(screen.getByLabelText(/Connect via AWS Systems Manager/));
    expect(latest.ssm).toEqual({ enabled: true, sso: { startUrl: CORP, region: 'us-east-1' } });
    const select = await screen.findByTestId('ssm-saved-signin');
    expect(select).toHaveValue('s1');
    fireEvent.change(select, { target: { value: 's2' } });
    expect(latest.ssm).toMatchObject({ sso: { startUrl: 'https://lab.awsapps.com/start', region: 'eu-north-1' } });
  });

  it('shows the account and role of the chosen sign-in and keeps the details collapsed', async () => {
    render(<Harness initial={{ enabled: true, region: 'eu-north-1', sso: { startUrl: CORP, region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' } }} />);
    expect(await screen.findByText('123456789012')).toBeInTheDocument();
    expect(screen.getByText('Dev')).toBeInTheDocument();
    const details = screen.getByText('Sign-in, account and role').closest('details')!;
    expect(details.hasAttribute('open')).toBe(false);
  });

  it('opens the details when the account or role is still missing', async () => {
    render(<Harness initial={{ enabled: true, sso: { startUrl: CORP, region: 'us-east-1' } }} />);
    await waitFor(() => expect(screen.getByText('Sign-in, account and role').closest('details')!.hasAttribute('open')).toBe(true));
  });

  it('offers the detected AWS CLI profiles and common regions as suggestions', async () => {
    render(<Harness initial={{ enabled: true, awsProfile: '' }} />);
    await waitFor(() => expect(document.querySelectorAll('#ssm-cli-profiles option')).toHaveLength(2));
    expect(document.querySelector('#ssm-regions option[value="eu-north-1"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('AWS CLI profile'), { target: { value: ' keys ' } });
    expect(latest.ssm).toMatchObject({ awsProfile: 'keys' });
  });

  it('summarises the tools in one line when they are installed', async () => {
    render(<Harness initial={{ enabled: true }} />);
    expect(await screen.findByText(/AWS CLI 2.38.0 and Session Manager plugin 1.2.896.0 found/)).toBeInTheDocument();
  });

  it('opens the instance picker from a clear button', async () => {
    render(<Harness initial={{ enabled: true }} />);
    fireEvent.click(screen.getByRole('button', { name: /Pick from AWS/ }));
    expect(await screen.findByRole('dialog', { name: 'Pick an AWS instance' })).toBeInTheDocument();
  });

  async function pickWeb1() {
    fireEvent.click(screen.getByRole('button', { name: /Pick from AWS/ }));
    await screen.findByRole('dialog', { name: 'Pick an AWS instance' });
    fireEvent.click(await screen.findByRole('radio', { name: 'Default credentials' }));
    fireEvent.click(screen.getByTestId('guide-search'));
    const row = await screen.findByLabelText(/^web-1,/);
    return row;
  }

  it('a Session Manager shell profile is not asked for, and does not get, an SSH login when an instance is picked', async () => {
    render(<Harness initial={{ enabled: true, mode: 'shell' }} />);
    const row = await pickWeb1();
    expect(screen.queryByLabelText('SSH login for web-1')).toBeNull();
    expect(screen.queryByText(/The SSH login is a suggestion/)).toBeNull();
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected' }));
    expect(lastExtra).toEqual({ host: 'i-0abcdef0123456789' }); // no username key at all: the profile keeps its own
    expect(latest.ssm).toMatchObject({ enabled: true, mode: 'shell' });
  });

  it('an SSH-over-SSM profile still gets the platform login suggestion (or the one typed) when an instance is picked', async () => {
    render(<Harness initial={{ enabled: true }} />);
    const row = await pickWeb1();
    expect(screen.getByLabelText('SSH login for web-1')).toHaveValue('ubuntu');
    fireEvent.change(screen.getByLabelText('SSH login for web-1'), { target: { value: 'deploy' } });
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: 'Use selected' }));
    expect(lastExtra).toEqual({ host: 'i-0abcdef0123456789', username: 'deploy' });
  });

  it('switches between SSH over SSM and a Session Manager shell and keeps the choice when the credentials change', async () => {
    render(<Harness initial={{ enabled: true, region: 'eu-north-1' }} />);
    const mode = await screen.findByTestId('ssm-mode');
    expect(mode).toHaveValue('ssh');
    expect(screen.queryByText(/Terminal only/)).toBeNull();
    fireEvent.change(mode, { target: { value: 'shell' } });
    expect(latest.ssm).toMatchObject({ enabled: true, mode: 'shell', region: 'eu-north-1' });
    expect(screen.getByRole('note')).toHaveTextContent('Terminal only');
    fireEvent.change(screen.getByLabelText('AWS credentials'), { target: { value: 'profile' } });
    expect(latest.ssm).toMatchObject({ mode: 'shell', awsProfile: '' });
    fireEvent.change(screen.getByTestId('ssm-mode'), { target: { value: 'ssh' } });
    expect(latest.ssm).not.toHaveProperty('mode', 'shell');
  });
});
