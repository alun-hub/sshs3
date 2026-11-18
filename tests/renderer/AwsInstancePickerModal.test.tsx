// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AwsInstancePickerModal } from '../../src/renderer/src/components/AwsInstancePickerModal';
import { AwsImportMenuItem } from '../../src/renderer/src/components/ConnectionModal/AwsImportMenuItem';
import { AwsEnabledContext } from '../../src/renderer/src/lib/awsEnabled';

const instances = [
  { instanceId: 'i-0123456789abcdef0', name: 'web-1', platformName: 'Ubuntu', platformType: 'Linux', ipAddress: '10.0.0.5' },
  { instanceId: 'i-0123456789abcdef1', name: 'db-1', platformName: 'Amazon Linux', platformType: 'Linux' },
];

function mockApi(extra: Record<string, unknown> = {}) {
  window.multissh = {
    awsSsoLogin: vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: 'x' }),
    awsSsoListAccounts: vi.fn().mockResolvedValue([{ accountId: '123456789012', accountName: 'prod' }]),
    awsSsoListRoles: vi.fn().mockResolvedValue([{ roleName: 'Admin' }]),
    awsSsmDiscoverInstances: vi.fn().mockResolvedValue({ instances, truncated: false }),
    profilesSaveFolder: vi.fn().mockResolvedValue(undefined),
    profilesSaveSSH: vi.fn().mockResolvedValue(undefined),
    ...extra,
  } as never;
}

async function walkToInstances() {
  fireEvent.change(screen.getByPlaceholderText(/awsapps/), { target: { value: 'https://d-1.awsapps.com/start' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByLabelText('Account');
  fireEvent.change(screen.getByLabelText('Account'), { target: { value: '123456789012' } });
  await waitFor(() => expect(screen.getByLabelText('Role')).toHaveValue('Admin'));
  fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'eu-north-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find instances' }));
  await screen.findByRole('listbox', { name: 'SSM-managed instances' });
}

describe('AwsInstancePickerModal', () => {
  beforeEach(() => mockApi());
  afterEach(() => cleanup());

  it('walks sign-in, account/role, region and instance discovery, then returns the picked instance with a suggested login', async () => {
    const onPick = vi.fn();
    render(<AwsInstancePickerModal mode="single" onClose={vi.fn()} onPick={onPick} />);
    await walkToInstances();
    expect(window.multissh.awsSsmDiscoverInstances).toHaveBeenCalledWith({
      sso: { startUrl: 'https://d-1.awsapps.com/start', region: 'us-east-1', accountId: '123456789012', roleName: 'Admin' },
      region: 'eu-north-1',
    });
    fireEvent.click(screen.getByRole('option', { name: /web-1/ }));
    await waitFor(() => expect(screen.getByLabelText('SSH login name')).toHaveValue('ubuntu'));
    fireEvent.click(screen.getByRole('button', { name: 'Use selected' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0]).toMatchObject({ region: 'eu-north-1', username: 'ubuntu', instances: [{ instanceId: 'i-0123456789abcdef0' }] });
  });

  it('selects with Enter, filters, and keeps a single selection in single mode', async () => {
    render(<AwsInstancePickerModal mode="single" onClose={vi.fn()} onPick={vi.fn()} />);
    await walkToInstances();
    const web = screen.getByRole('option', { name: /web-1/ });
    fireEvent.keyDown(web, { key: 'Enter' });
    expect(web).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: /db-1/ }));
    expect(screen.getByRole('option', { name: /web-1/ })).toHaveAttribute('aria-selected', 'false');
    fireEvent.change(screen.getByLabelText('Filter instances'), { target: { value: 'db' } });
    expect(screen.queryByRole('option', { name: /web-1/ })).toBeNull();
  });

  it('drops the sign-in, accounts and instances when the start URL is edited, and strips #/ from it', async () => {
    render(<AwsInstancePickerModal mode="single" onClose={vi.fn()} onPick={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/awsapps/), { target: { value: 'https://d-1.awsapps.com/start#/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Account');
    expect(window.multissh.awsSsoLogin).toHaveBeenCalledWith('https://d-1.awsapps.com/start', 'us-east-1');
    fireEvent.change(screen.getByPlaceholderText(/awsapps/), { target: { value: 'https://d-2.awsapps.com/start' } });
    expect(screen.queryByLabelText('Account')).toBeNull();
  });

  it('shows a helpful empty state and the error with a sign-in hint', async () => {
    mockApi({ awsSsmDiscoverInstances: vi.fn().mockResolvedValue({ instances: [], truncated: false }) });
    render(<AwsInstancePickerModal mode="multi" onClose={vi.fn()} onPick={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/awsapps/), { target: { value: 'https://d-1.awsapps.com/start' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Account');
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: '123456789012' } });
    await waitFor(() => expect(screen.getByLabelText('Role')).toHaveValue('Admin'));
    fireEvent.click(screen.getByRole('button', { name: 'Find instances' }));
    expect(await screen.findByText(/No online SSM-managed instances/)).toBeInTheDocument();
  });
});

describe('AwsImportMenuItem', () => {
  it('is not shown while AWS features are off', () => {
    mockApi();
    render(<AwsImportMenuItem profiles={[]} onDone={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Import from AWS/ })).toBeNull();
  });

  beforeEach(() => mockApi());
  afterEach(() => cleanup());

  it('saves one SSM profile per picked instance and skips instances that already have one', async () => {
    const onDone = vi.fn();
    const existing = [{ id: 'old', name: 'old', host: 'i-0123456789abcdef1', username: 'u', authType: 'agent', ssm: { enabled: true } }] as never;
    render(<AwsEnabledContext.Provider value={true}><AwsImportMenuItem profiles={existing} onDone={onDone} /></AwsEnabledContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /Import from AWS/ }));
    await walkToInstances();
    fireEvent.click(screen.getByRole('option', { name: /web-1/ }));
    fireEvent.click(screen.getByRole('option', { name: /db-1/ }));
    fireEvent.click(screen.getByRole('button', { name: /Import selected/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(1));
    const saved = (window.multissh.profilesSaveSSH as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ host: 'i-0123456789abcdef0', name: 'web-1', group: 'AWS/123456789012/eu-north-1', ssm: { enabled: true, region: 'eu-north-1' } });
  });
});
