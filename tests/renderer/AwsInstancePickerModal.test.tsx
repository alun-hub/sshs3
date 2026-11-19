// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AwsInstancePickerModal } from '../../src/renderer/src/components/AwsInstancePickerModal';
import { AwsAddButton } from '../../src/renderer/src/components/aws/AwsAddButton';
import { AwsEnabledContext } from '../../src/renderer/src/lib/awsEnabled';

const CORP = 'https://corp.awsapps.com/start';
const id = (n: number) => `i-${n.toString(16).padStart(17, '0')}`;
const found = (n: number, extra: Record<string, unknown> = {}) => ({
  instanceId: id(n), name: `web-${n}`, platformName: 'Ubuntu', platformType: 'Linux', ipAddress: `10.0.0.${n}`, region: 'eu-north-1', targetId: 'acct-111111111111', accountId: '111111111111', accountName: 'Prod', ...extra,
});

let settings: Record<string, unknown>;
let profiles: unknown[];
let scanResult: unknown;
const api = {
  settingsGet: vi.fn(async () => settings),
  profilesGet: vi.fn(async () => ({ ssh: profiles, s3: [] })),
  awsSsmListProfiles: vi.fn(async () => [{ name: 'keys', kind: 'keys' }, { name: 'corp-sso', kind: 'sso', region: 'eu-west-1' }]),
  awsSsoStatus: vi.fn(async () => ({ status: 'valid', expiresAt: '2030-05-06T07:08:00' })),
  awsSsoLogin: vi.fn(async () => ({ accessToken: 'x', expiresAt: 'y' })),
  awsSsoListAccountsCached: vi.fn(async () => [{ accountId: '111111111111', accountName: 'Prod' }, { accountId: '222222222222', accountName: 'Dev' }]),
  awsSsoListRolesCached: vi.fn(async () => [{ roleName: 'Dev' }, { roleName: 'Admin' }]),
  awsSsmScan: vi.fn(async () => scanResult),
  awsSsmScanCancel: vi.fn(async () => undefined),
  onAwsSsmScanProgress: vi.fn(() => () => {}),
  awsSsmProfileStatus: vi.fn(async () => ({ ok: true })),
  awsSsmProfileLogin: vi.fn(async () => ({ ok: true })),
  profilesSaveFolder: vi.fn(async () => undefined),
  profilesSaveSSH: vi.fn(async () => undefined),
};

beforeEach(() => {
  settings = { awsSignIns: [{ id: 's1', name: 'Corp', startUrl: CORP, region: 'us-east-1', lastRoleName: 'Dev' }], awsRegions: 'eu-north-1' };
  profiles = [];
  scanResult = { instances: [found(1), found(2, { name: 'db-1', platformName: 'Amazon Linux' })], skipped: [], truncated: false, searched: 1 };
  Object.values(api).forEach((f) => f.mockClear());
  window.multissh = { ...api } as never;
});
afterEach(() => cleanup());

const open = (mode: 'single' | 'multi' = 'multi', onPick = vi.fn()) => {
  render(<AwsInstancePickerModal mode={mode} onClose={vi.fn()} onPick={onPick} />);
  return onPick;
};

async function chooseAccount() {
  const list = await screen.findByRole('list', { name: 'Accounts' });
  fireEvent.click(await within(list).findByLabelText(/Prod/));
}

describe('AwsInstancePickerModal (SSO sign-in)', () => {
  it('starts from the saved sign-in, role and regions, searches the chosen accounts and imports with folder, name and login', async () => {
    const onPick = open();
    await waitFor(() => expect(screen.getByTestId('guide-sso-status')).toHaveTextContent('Signed in until 2030-05-06 07:08'));
    expect(screen.getByTestId('guide-saved-signin')).toHaveValue('s1');
    await chooseAccount();
    await waitFor(() => expect(screen.getByLabelText('Role for Prod')).toHaveValue('Dev'));
    expect(screen.getByLabelText('eu-north-1')).toBeChecked();
    fireEvent.click(screen.getByTestId('guide-search'));
    await screen.findByRole('listbox', { name: 'SSM-managed instances' });
    expect(api.awsSsmScan).toHaveBeenCalledTimes(1);
    const { request } = (api.awsSsmScan.mock.calls[0] as unknown as [{ request: { targets: Array<{ id: string; source: unknown }>; regions: string[] } }])[0];
    expect(request.regions).toEqual(['eu-north-1']);
    expect(request.targets).toEqual([expect.objectContaining({ id: 'acct-111111111111', source: { kind: 'sso', sso: { startUrl: CORP, region: 'us-east-1', accountId: '111111111111', roleName: 'Dev' } } })]);

    fireEvent.click(screen.getByRole('option', { name: /web-1/ }));
    fireEvent.change(screen.getByLabelText('SSH login for web-1'), { target: { value: 'deploy' } });
    fireEvent.click(screen.getByRole('option', { name: /db-1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (2)' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const items = onPick.mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'web-1', username: 'deploy', folder: 'AWS/Prod/eu-north-1' });
    expect(items[1]).toMatchObject({ name: 'db-1', username: 'ec2-user' });
    expect(items[0].source).toMatchObject({ kind: 'sso' });
  });

  it('keeps the search disabled with a reason until accounts, role and regions are chosen', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('guide-sso-status')).toHaveTextContent('Signed in'));
    expect(screen.getByTestId('guide-search')).toBeDisabled();
    expect(screen.getByText('Select at least one account.')).toBeInTheDocument();
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(within(screen.getByRole('region', { name: 'Regions' })).getByRole('button', { name: 'None' }));
    expect(screen.getByTestId('guide-search')).toBeDisabled();
    expect(screen.getByText('Select at least one region.')).toBeInTheDocument();
  });

  it('marks nodes that already have a profile and does not let them be picked', async () => {
    profiles = [{ id: 'p', name: 'old', host: id(1), username: 'u', authType: 'agent', ssm: { enabled: true } }];
    open();
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    const row = await screen.findByRole('option', { name: /web-1/ });
    expect(row).toHaveTextContent('Already added');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(row);
    expect(screen.getByRole('button', { name: 'Import selected' })).toBeDisabled();
  });

  it('summarises skipped searches and offers a sign-in when the session has expired', async () => {
    scanResult = { instances: [found(1)], skipped: [{ targetId: 'acct-111111111111', label: 'Prod', region: 'us-west-2', reason: 'access-denied', message: 'Not allowed to call ssm:DescribeInstanceInformation.' }], truncated: false, searched: 2 };
    open();
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    expect(await screen.findByTestId('guide-summary')).toHaveTextContent('Searched 2, skipped 1: access denied ×1.');
    fireEvent.click(screen.getByText('Why were some skipped?'));
    expect(screen.getByText(/Prod · us-west-2: Not allowed/)).toBeInTheDocument();
    cleanup();

    api.awsSsmScan.mockRejectedValueOnce(new Error('AWS SSO session expired: sign in again to continue.'));
    open();
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again above.');
  });
});

describe('AwsInstancePickerModal (a role per account)', () => {
  const tickAll = async () => {
    const list = await screen.findByRole('list', { name: 'Accounts' });
    fireEvent.click(await within(list).findByLabelText(/Prod/));
    fireEvent.click(await within(list).findByLabelText(/Dev/));
  };

  it('loads roles per ticked account, preselects a sensible one and lets each account have its own', async () => {
    api.awsSsoListRolesCached.mockImplementation((async (r: { accountId: string }) =>
      r.accountId === '111111111111' ? [{ roleName: 'Dev' }, { roleName: 'Admin' }] : [{ roleName: 'ReadOnly' }]) as never);
    open();
    await tickAll();
    await waitFor(() => expect(screen.getByLabelText('Role for Prod')).toHaveValue('Dev')); // the saved sign-in's last role
    await waitFor(() => expect(screen.getByLabelText('Role for Dev')).toHaveValue('ReadOnly')); // its only role
    fireEvent.change(screen.getByLabelText('Role for Prod'), { target: { value: 'Admin' } });
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    await screen.findByRole('listbox', { name: 'SSM-managed instances' });
    const req = (api.awsSsmScan.mock.calls[0] as unknown as [{ request: { targets: Array<{ id: string; source: { sso: { roleName: string } } }> } }])[0].request;
    expect(req.targets.map((t) => [t.id, t.source.sso.roleName])).toEqual([['acct-111111111111', 'Admin'], ['acct-222222222222', 'ReadOnly']]);
    api.awsSsoListRolesCached.mockResolvedValue([{ roleName: 'Dev' }, { roleName: 'Admin' }] as never);
  });

  it('applies one role to every account that has it with "Same role everywhere"', async () => {
    api.awsSsoListRolesCached.mockResolvedValue([{ roleName: 'Dev' }, { roleName: 'Admin' }] as never);
    open();
    await tickAll();
    await waitFor(() => expect(screen.getByLabelText('Role for Dev')).toHaveValue('Dev'));
    const common = await screen.findByTestId('guide-common-role');
    expect(within(common).getByRole('option', { name: 'Admin (2 of 2)' })).toBeInTheDocument();
    fireEvent.change(common, { target: { value: 'Admin' } });
    expect(screen.getByLabelText('Role for Prod')).toHaveValue('Admin');
    expect(screen.getByLabelText('Role for Dev')).toHaveValue('Admin');
  });

  it('keeps the search disabled with a reason until every selected account has a role', async () => {
    api.awsSsoListRolesCached.mockResolvedValue([{ roleName: 'Admin' }, { roleName: 'Other' }] as never); // no preferred role, more than one
    open();
    await chooseAccount();
    await waitFor(() => expect(screen.getByLabelText('Role for Prod')).toHaveValue(''));
    expect(screen.getByTestId('guide-search')).toBeDisabled();
    expect(screen.getByText('Choose a role for each selected account.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role for Prod'), { target: { value: 'Other' } });
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    api.awsSsoListRolesCached.mockResolvedValue([{ roleName: 'Dev' }, { roleName: 'Admin' }] as never);
  });

  it('lets the user type a role when the roles of an account cannot be listed', async () => {
    api.awsSsoListRolesCached.mockRejectedValue(new Error('denied'));
    open();
    await chooseAccount();
    const field = await screen.findByLabelText('Role for Prod');
    expect(field.tagName).toBe('INPUT');
    expect(screen.getByTestId('guide-search')).toBeDisabled();
    fireEvent.change(field, { target: { value: 'ReadOnlyAccess' } });
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    api.awsSsoListRolesCached.mockResolvedValue([{ roleName: 'Dev' }, { roleName: 'Admin' }] as never);
  });
});

describe('AwsInstancePickerModal (choosing instances)', () => {
  async function results(mode: 'single' | 'multi' = 'multi') {
    open(mode);
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    await screen.findByRole('listbox', { name: 'SSM-managed instances' });
  }
  const box = (name: RegExp) => screen.getByRole('option', { name }).querySelector('input') as HTMLInputElement;

  it('shows a checkbox on every row that follows the selection, with a running count', async () => {
    await results();
    expect(box(/web-1/).type).toBe('checkbox');
    expect(box(/web-1/).checked).toBe(false);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /web-1/ }));
    expect(box(/web-1/).checked).toBe(true);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /web-1/ }));
    expect(box(/web-1/).checked).toBe(false);
  });

  it('selects everything shown (except nodes that already have a profile) and clears again', async () => {
    profiles = [{ id: 'p', name: 'old', host: id(2), username: 'u', authType: 'agent', ssm: { enabled: true } }];
    await results();
    fireEvent.click(screen.getByRole('button', { name: 'Select all shown (1)' })); // db-1 is already added
    expect(box(/web-1/).checked).toBe(true);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    const instances = screen.getByRole('region', { name: 'Instances' });
    fireEvent.click(within(instances).getByRole('button', { name: 'None' }));
    expect(box(/web-1/).checked).toBe(false);
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('only selects what the filter shows, and keeps earlier picks', async () => {
    await results();
    fireEvent.click(screen.getByRole('option', { name: /web-1/ }));
    fireEvent.change(screen.getByLabelText('Filter instances'), { target: { value: 'db' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select all shown (1)' }));
    fireEvent.change(screen.getByLabelText('Filter instances'), { target: { value: '' } });
    expect(box(/web-1/).checked).toBe(true);
    expect(box(/db-1/).checked).toBe(true);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('uses radio buttons and no bulk controls in single mode', async () => {
    await results('single');
    expect(box(/web-1/).type).toBe('radio');
    expect(screen.queryByRole('button', { name: /Select all shown/ })).toBeNull();
  });
});

describe('AwsInstancePickerModal (how the imported profiles connect)', () => {
  async function toResults(onPick = vi.fn()) {
    open('multi', onPick);
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    fireEvent.click(await screen.findByRole('option', { name: /web-1/ }));
    return onPick;
  }

  it('defaults to SSH over SSM with the SSH agent', async () => {
    const onPick = await toResults();
    expect(screen.getByRole('radio', { name: 'SSH over SSM' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'SSH agent' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].items[0]).toMatchObject({ mode: 'ssh', authType: 'agent' });
  });

  it('needs a key file path before importing with a private key, then passes it on', async () => {
    const onPick = await toResults();
    fireEvent.click(screen.getByRole('radio', { name: 'Private key file' }));
    expect(screen.getByRole('button', { name: 'Import selected (1)' })).toBeDisabled();
    fireEvent.change(screen.getByTestId('guide-key-path'), { target: { value: ' ~/.ssh/sshs3-ssm-test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].items[0]).toMatchObject({ mode: 'ssh', authType: 'privateKey', privateKeyPath: '~/.ssh/sshs3-ssm-test' });
  });

  it('imports Session Manager shell profiles without SSH login or key questions', async () => {
    const onPick = await toResults();
    expect(screen.getByLabelText('SSH login for web-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Session Manager shell (no SSH)' }));
    expect(screen.queryByLabelText('SSH login for web-1')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'SSH agent' })).toBeNull();
    expect(screen.getByText(/needs no SSH daemon or key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].items[0]).toMatchObject({ mode: 'shell' });
  });

  it('does not ask in single mode (the profile form has its own connection settings)', async () => {
    open('single');
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    await screen.findByRole('listbox', { name: 'SSM-managed instances' });
    expect(screen.queryByRole('radiogroup', { name: 'Connection type' })).toBeNull();
  });
});

describe('AwsInstancePickerModal (portal cannot list accounts)', () => {
  it('lets the user type account ids and a role, and searches those accounts', async () => {
    api.awsSsoListAccountsCached.mockRejectedValue(new Error('not allowed'));
    open();
    const ids = await screen.findByTestId('guide-account-ids');
    expect(screen.getByText(/cannot list accounts/)).toBeInTheDocument();
    expect(screen.getByTestId('guide-search')).toBeDisabled();
    expect(screen.getByText('Enter at least one account ID.')).toBeInTheDocument();
    fireEvent.change(ids, { target: { value: '111111111111, 222222222222, nonsense' } });
    fireEvent.change(screen.getByTestId('guide-role'), { target: { value: 'Dev' } });
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    await screen.findByRole('listbox', { name: 'SSM-managed instances' });
    const req = (api.awsSsmScan.mock.calls[0] as unknown as [{ request: { targets: Array<{ id: string; source: { sso: { accountId: string; roleName: string } } }> } }])[0].request;
    expect(req.targets.map((t) => [t.id, t.source.sso.accountId, t.source.sso.roleName])).toEqual([['acct-111111111111', '111111111111', 'Dev'], ['acct-222222222222', '222222222222', 'Dev']]);
    api.awsSsoListAccountsCached.mockResolvedValue([{ accountId: '111111111111', accountName: 'Prod' }, { accountId: '222222222222', accountName: 'Dev' }] as never);
  });
});

describe('AwsInstancePickerModal (AWS CLI profiles and default credentials)', () => {
  it('searches the chosen CLI profile with the profile as credential source', async () => {
    settings = { awsRegions: 'eu-north-1' }; // no saved sign-in: the profile source is offered first
    const onPick = open();
    await screen.findByRole('list', { name: 'AWS CLI profiles' });
    fireEvent.click(screen.getByLabelText(/keys/));
    await waitFor(() => expect(api.awsSsmProfileStatus).toHaveBeenCalledWith('keys'));
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    scanResult = { instances: [found(3, { targetId: 'profile-keys', accountName: undefined })], skipped: [], truncated: false, searched: 1 };
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    fireEvent.click(await screen.findByRole('option', { name: /web-3/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].items[0]).toMatchObject({ folder: 'AWS/keys/eu-north-1', source: { kind: 'profile', name: 'keys' } });
    const req = (api.awsSsmScan.mock.calls[0] as unknown as [{ request: { targets: unknown[] } }])[0].request;
    expect(req.targets).toEqual([expect.objectContaining({ id: 'profile-keys', source: { kind: 'profile', name: 'keys' } })]);
  });

  it('lets an expired SSO profile sign in through the AWS CLI and re-checks it', async () => {
    settings = { awsRegions: 'eu-north-1' };
    api.awsSsmProfileStatus.mockResolvedValueOnce({ ok: false, message: 'The sign-in for this profile has expired. Sign in again.' } as never);
    open();
    await screen.findByRole('list', { name: 'AWS CLI profiles' });
    fireEvent.click(screen.getByLabelText(/corp-sso/));
    const item = (await screen.findByText(/has expired/)).closest('li')!;
    fireEvent.click(within(item).getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(api.awsSsmProfileLogin).toHaveBeenCalledWith('corp-sso'));
    await waitFor(() => expect(within(item).getByText('Ready')).toBeInTheDocument());
  });

  it('can search with the default credential chain', async () => {
    settings = { awsRegions: 'eu-north-1' };
    open();
    fireEvent.click(await screen.findByRole('radio', { name: 'Default credentials' }));
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    await screen.findByRole('listbox', { name: 'SSM-managed instances' });
    expect((api.awsSsmScan.mock.calls[0] as unknown as [{ request: { targets: Array<{ source: unknown }> } }])[0].request.targets[0].source).toEqual({ kind: 'default' });
  });
});

describe('AwsInstancePickerModal (single mode)', () => {
  it('keeps one selection and returns one item', async () => {
    const onPick = open('single');
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    fireEvent.click(await screen.findByRole('option', { name: /web-1/ }));
    fireEvent.click(screen.getByRole('option', { name: /db-1/ }));
    expect(screen.getByRole('option', { name: /web-1/ })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Use selected' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].items).toHaveLength(1);
    expect(onPick.mock.calls[0][0].items[0].instance.name).toBe('db-1');
  });
});

describe('AwsAddButton', () => {
  it('is not shown while AWS features are off', () => {
    render(<AwsAddButton profiles={[]} onDone={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Add from AWS/ })).toBeNull();
  });

  it('saves one SSM profile per picked instance in its folder and skips nodes that already have one', async () => {
    const onDone = vi.fn();
    const existing = [{ id: 'old', name: 'old', host: id(2), username: 'u', authType: 'agent', ssm: { enabled: true } }] as never;
    profiles = existing;
    render(<AwsEnabledContext.Provider value={true}><AwsAddButton profiles={existing} onDone={onDone} /></AwsEnabledContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /Add from AWS/ }));
    await chooseAccount();
    await waitFor(() => expect(screen.getByTestId('guide-search')).toBeEnabled());
    fireEvent.click(screen.getByTestId('guide-search'));
    fireEvent.click(await screen.findByRole('option', { name: /web-1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected (1)' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(1));
    const saved = api.profilesSaveSSH.mock.calls.map((c) => (c as unknown as [Record<string, unknown>])[0]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ host: id(1), name: 'web-1', group: 'AWS/Prod/eu-north-1', authType: 'agent', ssm: { enabled: true, region: 'eu-north-1', sso: { startUrl: CORP, accountId: '111111111111', roleName: 'Dev' } } });
    expect(api.profilesSaveFolder).toHaveBeenCalledWith('AWS/Prod/eu-north-1');
  });
});
