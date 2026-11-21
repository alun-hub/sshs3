// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SSHGlobalTunnelsModal } from '../../src/renderer/src/components/SSH/SSHGlobalTunnelsModal';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const profile: SSHConnectionConfig = {
  id: 'ssh-1',
  name: 'gnarg',
  host: 'gnarg',
  port: 22,
  username: 'alun',
  authType: 'password',
  tunnels: [
    { id: 't1', name: 'Web', type: 'local', localPort: 8080, remoteHost: 'localhost', remotePort: 80, enabled: true },
    { id: 't2', name: 'DB', type: 'local', localPort: 5432, remoteHost: 'localhost', remotePort: 5432, enabled: true },
  ],
} as SSHConnectionConfig;

describe('SSHGlobalTunnelsModal delete', () => {
  beforeEach(() => {
    window.multissh = {
      profilesGet: vi.fn().mockResolvedValue({ ssh: [profile], s3: [] }),
      profilesSaveSSH: vi.fn().mockResolvedValue(undefined),
      sshTunnelList: vi.fn().mockResolvedValue([
        { id: 'tun-1', connectionId: 'ssh-1', tunnel: profile.tunnels![0], status: 'active', startedAt: '2026-10-02T10:00:00Z' },
      ]),
      sshTunnelStop: vi.fn().mockResolvedValue(true),
      onSshTunnelEvent: vi.fn().mockReturnValue(() => {}),
    } as any;
  });
  afterEach(() => cleanup());

  const renderModal = () =>
    render(
      <ConfirmProvider>
        <SSHGlobalTunnelsModal open onClose={() => {}} />
      </ConfirmProvider>
    );

  it('stops a running tunnel and removes the saved tunnel after confirmation', async () => {
    renderModal();
    fireEvent.click(await screen.findByLabelText('Delete tunnel Web'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(window.multissh.profilesSaveSSH).toHaveBeenCalled());
    expect(window.multissh.sshTunnelStop).toHaveBeenCalledWith('tun-1');
    const saved = (window.multissh.profilesSaveSSH as any).mock.calls[0][0] as SSHConnectionConfig;
    expect(saved.tunnels?.map((t) => t.id)).toEqual(['t2']);
    await waitFor(() => expect(screen.queryByText('Web')).not.toBeInTheDocument());
    expect(screen.getByText('DB')).toBeInTheDocument();
  });

  it('keeps the tunnel when the confirmation is cancelled', async () => {
    renderModal();
    fireEvent.click(await screen.findByLabelText('Delete tunnel DB'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
    expect(window.multissh.profilesSaveSSH).not.toHaveBeenCalled();
    expect(screen.getByText('DB')).toBeInTheDocument();
  });
});

describe('SSHGlobalTunnelsModal connection picker', () => {
  const shell = { id: 'ssh-2', name: 'ec2 shell', host: 'i-0123456789abcdef0', username: '', authType: 'agent', ssm: { enabled: true, mode: 'shell', region: 'eu-north-1' } } as SSHConnectionConfig;
  const overSsm = { id: 'ssh-3', name: 'ec2 ssh', host: 'i-0fedcba9876543210', username: 'ec2-user', authType: 'agent', ssm: { enabled: true, region: 'eu-north-1' } } as SSHConnectionConfig;

  beforeEach(() => {
    window.multissh = {
      profilesGet: vi.fn().mockResolvedValue({ ssh: [profile, shell, overSsm], s3: [] }),
      profilesSaveSSH: vi.fn().mockResolvedValue(undefined),
      sshTunnelList: vi.fn().mockResolvedValue([]),
      sshTunnelStop: vi.fn().mockResolvedValue(true),
      onSshTunnelEvent: vi.fn().mockReturnValue(() => {}),
    } as any;
  });
  afterEach(() => cleanup());

  it('does not offer a Session Manager shell as the connection for a new tunnel (it has no SSH to carry one)', async () => {
    render(
      <ConfirmProvider>
        <SSHGlobalTunnelsModal open onClose={() => {}} />
      </ConfirmProvider>
    );
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    const labels = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(labels).toContain('gnarg (alun@gnarg)');
    expect(labels).toContain('ec2 ssh (ec2-user@i-0fedcba9876543210)');
    expect(labels.some((l) => /ec2 shell/.test(l ?? ''))).toBe(false);
  });
});
