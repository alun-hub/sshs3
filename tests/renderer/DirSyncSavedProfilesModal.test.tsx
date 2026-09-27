// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DirSyncSavedProfilesModal } from '../../src/renderer/src/components/FileManager/DirSyncSavedProfilesModal';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';
import type { DirectorySyncProfile } from '../../src/shared/types/dirsync';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const mockSsh: SSHConnectionConfig[] = [
  {
    id: 'ssh-remote-1',
    name: 'Production Web',
    host: 'web.prod.com',
    port: 22,
    username: 'admin',
    authType: 'password',
  },
];

const mockProfiles: DirectorySyncProfile[] = [
  {
    id: 'sync-1',
    name: 'Web Server to Local Backup',
    source: { providerConfigRef: 'sftp-ssh-remote-1', path: '/var/www/html' },
    target: { providerConfigRef: 'local', path: '/home/alun/backups' },
    deleteExtraneous: true,
    createdAt: '2026-09-26T12:00:00.000Z',
    updatedAt: '2026-09-26T12:00:00.000Z',
    lastRunAt: '2026-09-26T14:30:00.000Z',
  },
];

describe('DirSyncSavedProfilesModal', () => {
  beforeEach(() => {
    window.multissh = {
      dirSyncProfileList: vi.fn().mockResolvedValue(mockProfiles),
      dirSyncProfileDelete: vi.fn().mockResolvedValue(undefined),
      profilesGet: vi.fn().mockResolvedValue({ ssh: mockSsh, s3: [] }),
    } as any;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders clearly showing source host, target host and transfer direction', async () => {
    render(
      <ConfirmProvider>
        <DirSyncSavedProfilesModal open={true} onClose={() => {}} onRun={() => {}} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Web Server to Local Backup')).toBeInTheDocument();
    });

    // Check Source (From) info
    expect(screen.getByText('Source (From)')).toBeInTheDocument();
    expect(screen.getByText('Production Web')).toBeInTheDocument();
    expect(screen.getByText('SFTP · admin@web.prod.com')).toBeInTheDocument();
    expect(screen.getByText('/var/www/html')).toBeInTheDocument();

    // Check Direction indicator
    expect(screen.getByText('Syncs to')).toBeInTheDocument();

    // Check Target (To) info
    expect(screen.getByText('Target (To)')).toBeInTheDocument();
    expect(screen.getByText('Local Disk')).toBeInTheDocument();
    expect(screen.getByText('This computer (Local)')).toBeInTheDocument();
    expect(screen.getByText('/home/alun/backups')).toBeInTheDocument();

    // Check Mirror warning
    expect(screen.getByText(/Mirror: Files in target missing from source will be deleted/)).toBeInTheDocument();
  });

  // M12 (code review): this dialog previously only closed via the header X.
  it('calls onClose on Escape and on a backdrop click (M12)', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <ConfirmProvider>
        <DirSyncSavedProfilesModal open={true} onClose={onClose} onRun={() => {}} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Web Server to Local Backup')).toBeInTheDocument();
    });

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstElementChild as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // LOW finding (code review): deleting a profile used to go through
  // window.confirm(), trivially dismissed by a stray Enter/Space press.
  it('asks for in-app confirmation before deleting a profile, and only deletes when confirmed', async () => {
    render(
      <ConfirmProvider>
        <DirSyncSavedProfilesModal open={true} onClose={() => {}} onRun={() => {}} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Web Server to Local Backup')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete profile'));

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveTextContent('Web Server to Local Backup');

    // Cancel does not delete.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.multissh.dirSyncProfileDelete).not.toHaveBeenCalled();

    // Confirming does.
    fireEvent.click(screen.getByTitle('Delete profile'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(window.multissh.dirSyncProfileDelete).toHaveBeenCalledWith('sync-1');
    });
  });
});
