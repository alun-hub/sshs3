// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SyncSettingsPanel } from '../../src/renderer/src/components/SettingsModal/SyncSettingsPanel';
import type { ProfileSyncStatus } from '../../src/shared/types/sync';

function statusFixture(overrides: Partial<ProfileSyncStatus> = {}): ProfileSyncStatus {
  return {
    configured: false,
    hasLocalSalts: false,
    topologyUnlocked: false,
    credentialsUnlocked: false,
    ...overrides,
  };
}

describe('SyncSettingsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the target form when sync is not configured yet', async () => {
    window.multissh = {
      profileSyncStatus: vi.fn().mockResolvedValue(statusFixture()),
    } as unknown as typeof window.multissh;

    render(<SyncSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText('SFTP server')).toBeInTheDocument();
      expect(screen.getByText('S3 bucket')).toBeInTheDocument();
    });
  });

  it('saves an SFTP target with the entered fields', async () => {
    const profileSyncSetup = vi.fn().mockResolvedValue(undefined);
    window.multissh = {
      profileSyncStatus: vi
        .fn()
        .mockResolvedValueOnce(statusFixture())
        .mockResolvedValueOnce(statusFixture({ configured: true, target: { id: 'x', name: 'x', type: 'sftp' } })),
      profileSyncSetup,
    } as unknown as typeof window.multissh;

    render(<SyncSettingsPanel />);
    await waitFor(() => expect(screen.getByText('SFTP server')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('sync.example.com'), { target: { value: 'sync.host.com' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'deploy' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sync-pass' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save target' }));

    await waitFor(() => {
      expect(profileSyncSetup).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({
            type: 'sftp',
            sftpConfig: expect.objectContaining({ host: 'sync.host.com', username: 'deploy', password: 'sync-pass' }),
          }),
        })
      );
    });
  });

  it('opens the master password dialog and requires matching confirmation before enabling submit (first-time setup)', async () => {
    window.multissh = {
      profileSyncStatus: vi.fn().mockResolvedValue(
        statusFixture({ configured: true, target: { id: 'x', name: 'x', type: 'sftp' }, hasLocalSalts: false })
      ),
    } as unknown as typeof window.multissh;

    render(<SyncSettingsPanel />);
    await waitFor(() => expect(screen.getByText('Set up master passwords')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Set up master passwords'));

    const submitButton = await screen.findByRole('button', { name: 'Activate sync' });
    expect(submitButton).toBeDisabled();

    const topologyInput = screen.getByLabelText('Topology master password') as HTMLInputElement;
    const topologyConfirm = screen.getByLabelText('Confirm topology master password') as HTMLInputElement;
    const credentialsInput = screen.getByLabelText('Credentials master password') as HTMLInputElement;
    const credentialsConfirm = screen.getByLabelText('Confirm credentials master password') as HTMLInputElement;

    fireEvent.change(topologyInput, { target: { value: 'topology-secret-1' } });
    fireEvent.change(topologyConfirm, { target: { value: 'topology-secret-1' } });
    fireEvent.change(credentialsInput, { target: { value: 'credentials-secret-1' } });
    fireEvent.change(credentialsConfirm, { target: { value: 'credentials-secret-1' } });

    // Still disabled: the "I've saved these passwords" checkbox hasn't been checked yet.
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByText("I've saved these passwords somewhere safe."));
    expect(submitButton).not.toBeDisabled();
  });

  it('shows push and pull actions once both key groups are unlocked', async () => {
    window.multissh = {
      profileSyncStatus: vi.fn().mockResolvedValue(
        statusFixture({
          configured: true,
          target: { id: 'x', name: 'x', type: 's3' },
          hasLocalSalts: true,
          topologyUnlocked: true,
          credentialsUnlocked: true,
          lastSyncAt: '2026-01-01T00:00:00.000Z',
        })
      ),
      profileSyncPush: vi.fn().mockResolvedValue(
        statusFixture({
          configured: true,
          target: { id: 'x', name: 'x', type: 's3' },
          hasLocalSalts: true,
          topologyUnlocked: true,
          credentialsUnlocked: true,
          lastSyncAt: '2026-01-01T00:05:00.000Z',
        })
      ),
    } as unknown as typeof window.multissh;

    render(<SyncSettingsPanel />);
    const pushButton = await screen.findByRole('button', { name: /Push/ });
    expect(screen.getByRole('button', { name: /Pull/ })).toBeInTheDocument();

    fireEvent.click(pushButton);
    await waitFor(() => {
      expect(window.multissh.profileSyncPush).toHaveBeenCalled();
    });
  });
});
