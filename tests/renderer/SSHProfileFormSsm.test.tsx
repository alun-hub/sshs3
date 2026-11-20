// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SSHProfileForm } from '../../src/renderer/src/components/ConnectionModal/SSHProfileForm';
import { AwsEnabledContext } from '../../src/renderer/src/lib/awsEnabled';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

beforeEach(() => {
  window.multissh = {
    dotfilePoolsGet: vi.fn().mockResolvedValue([]),
    profilesGet: vi.fn().mockResolvedValue({ ssh: [], s3: [] }),
    smartcardDetect: vi.fn().mockResolvedValue([]),
    settingsGet: vi.fn().mockResolvedValue({}),
    awsSsmCheckTools: vi.fn(async () => ({ aws: { found: true }, plugin: { found: true, ok: true } })),
    awsSsmListProfiles: vi.fn(async () => []),
    awsSsoStatus: vi.fn(async () => ({ status: 'missing' })),
    policyGet: vi.fn(async () => ({ managed: [], features: {}, warnings: [] })),
  } as never;
});
afterEach(() => cleanup());

const base = (over: Partial<SSHConnectionConfig>): SSHConnectionConfig =>
  ({ id: 'p1', name: 'EC2', host: 'i-0123456789abcdef0', port: 22, username: 'ec2-user', authType: 'password', ...over }) as SSHConnectionConfig;
const show = (cfg: SSHConnectionConfig) =>
  render(<AwsEnabledContext.Provider value={true}><SSHProfileForm initial={cfg} onSave={vi.fn()} onCancel={vi.fn()} /></AwsEnabledContext.Provider>);
const has = (re: RegExp) => screen.queryByText(re) !== null;

describe('SSHProfileForm: which fields an SSM profile shows', () => {
  it('shows every normal SSH field for a plain profile', () => {
    show(base({ ssm: undefined }));
    expect(has(/^Authentication$/)).toBe(true);
    expect(has(/Initial SFTP Path/)).toBe(true);
    expect(has(/Jump Host \/ ProxyJump/)).toBe(true);
    expect(screen.getByText(/Enable Outgoing Proxy/)).toBeInTheDocument();
    expect(has(/^Port$/)).toBe(true);
    expect(screen.getByRole('button', { name: /Advanced SSH Options/i })).toBeInTheDocument();
  });

  it('SSH over SSM keeps the normal authentication choices (the instance sshd still authenticates) but hides jump host and proxy', () => {
    show(base({ ssm: { enabled: true, region: 'eu-north-1' } }));
    expect(has(/^Authentication$/)).toBe(true);
    expect(has(/^Port$/)).toBe(true);
    expect(screen.getByRole('button', { name: /Advanced SSH Options/i })).toBeInTheDocument();
    expect(has(/Initial SFTP Path/)).toBe(true); // the file manager works over SSH
    expect(has(/Jump Host \/ ProxyJump/)).toBe(false);
    expect(screen.queryByText(/Enable Outgoing Proxy/)).toBeNull();
  });

  it('a Session Manager shell has no SSH login: authentication, password, port, SFTP path, jump host and SSH options are hidden', () => {
    show(base({ ssm: { enabled: true, mode: 'shell', region: 'eu-north-1' } }));
    expect(has(/^Authentication$/)).toBe(false);
    expect(screen.queryByText(/^Password$/)).toBeNull();
    expect(has(/^Port$/)).toBe(false);
    expect(has(/Username/)).toBe(false);
    expect(has(/Initial SFTP Path/)).toBe(false);
    expect(has(/Jump Host \/ ProxyJump/)).toBe(false);
    expect(screen.queryByRole('button', { name: /Advanced SSH Options/i })).toBeNull();
    expect(screen.getByLabelText(/Connect via AWS Systems Manager/)).toBeChecked();
    expect(screen.getByDisplayValue('i-0123456789abcdef0')).toBeInTheDocument(); // the instance id stays
  });
});
