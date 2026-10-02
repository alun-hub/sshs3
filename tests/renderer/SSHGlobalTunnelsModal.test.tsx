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
