// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConnectionManagerModal } from '../../src/renderer/src/components/ConnectionModal/ConnectionManagerModal';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';
import type { S3Config } from '../../src/shared/types/storage';

const mockSSHProfiles: SSHConnectionConfig[] = [
  {
    id: 'ssh-1',
    name: 'Prod Web 01',
    host: 'web01.prod.example.com',
    port: 22,
    username: 'deploy',
    authType: 'password',
    group: 'Produktion',
    lastUsedAt: '2026-09-16 12:30',
  },
  {
    id: 'ssh-2',
    name: 'Prod DB 01',
    host: 'db01.prod.example.com',
    port: 2222,
    username: 'postgres',
    authType: 'password',
    group: 'Produktion',
    forwardAgent: true,
  },
  {
    id: 'ssh-3',
    name: 'Dev Sandbox',
    host: 'sandbox.dev.example.com',
    port: 22,
    username: 'ubuntu',
    authType: 'password',
    group: 'Utveckling',
  },
];

const mockS3Profiles: S3Config[] = [
  {
    id: 's3-1',
    name: 'Backup Bucket',
    region: 'eu-north-1',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    group: 'Backuper',
    lastUsedAt: '2026-09-15 09:15',
  },
];

describe('ConnectionManagerModal', () => {
  beforeEach(() => {
    window.multissh = {
      profilesGet: vi.fn().mockResolvedValue({
        ssh: mockSSHProfiles,
        s3: mockS3Profiles,
      }),
      profilesSaveSSH: vi.fn().mockResolvedValue(undefined),
      profilesSaveS3: vi.fn().mockResolvedValue(undefined),
      profilesDeleteSSH: vi.fn().mockResolvedValue(undefined),
      profilesDeleteS3: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof window.multissh;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <ConfirmProvider>
        <ConnectionManagerModal open={false} onClose={vi.fn()} />
      </ConfirmProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders profile groups and recently used section for SSH', async () => {
    render(
      <ConfirmProvider>
        <ConnectionManagerModal
          open={true}
          onClose={vi.fn()}
          onConnectSSH={vi.fn()}
        />
      </ConfirmProvider>
    );

    // Verify recent section
    await waitFor(() => {
      expect(screen.getByText('Recently Used')).toBeInTheDocument();
    });
    expect(screen.getByText(/Last connected: 2026-09-16 12:30/)).toBeInTheDocument();

    // Verify folders / groups with count badges
    expect(screen.getAllByText('Produktion').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Utveckling')).toBeInTheDocument();

    // Verify profiles rendered
    expect(screen.getAllByText('Prod Web 01').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Prod DB 01')).toBeInTheDocument();
    expect(screen.getByText('Agent Fwd')).toBeInTheDocument();
    expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
  });

  it('filters profiles and groups based on search query', async () => {
    render(
      <ConfirmProvider>
        <ConnectionManagerModal
          open={true}
          onClose={vi.fn()}
          onConnectSSH={vi.fn()}
        />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search profiles, or type user@host to connect...');
    fireEvent.change(searchInput, { target: { value: 'sandbox' } });

    // Sandbox should remain, Prod should be filtered out
    expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    expect(screen.queryByText('Prod Web 01')).not.toBeInTheDocument();
    expect(screen.queryByText('Prod DB 01')).not.toBeInTheDocument();

    // Search query also suppresses the recently used section
    expect(screen.queryByText('Recently Used')).not.toBeInTheDocument();
  });

  it('allows collapsing and expanding a group folder', async () => {
    render(
      <ConfirmProvider>
        <ConnectionManagerModal
          open={true}
          onClose={vi.fn()}
          onConnectSSH={vi.fn()}
        />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Prod DB 01')).toBeInTheDocument();
    });

    // Click "Produktion" folder header to collapse (folder header button containing 'Produktion')
    const groupHeader = screen.getByRole('button', { name: /Produktion/ });
    fireEvent.click(groupHeader);

    // Items inside group should now be collapsed/hidden
    expect(screen.queryByText('Prod DB 01')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(groupHeader);
    expect(screen.getByText('Prod DB 01')).toBeInTheDocument();
  });

  it('calls onConnectSSH with updated timestamp when Connect is clicked', async () => {
    const onConnectSSH = vi.fn();
    render(
      <ConfirmProvider>
        <ConnectionManagerModal
          open={true}
          onClose={vi.fn()}
          onConnectSSH={onConnectSSH}
        />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    // Find the connect button for Dev Sandbox
    const connectButtons = screen.getAllByRole('button', { name: 'Connect' });
    expect(connectButtons.length).toBeGreaterThan(0);

    fireEvent.click(connectButtons[connectButtons.length - 1]);

    await waitFor(() => {
      expect(window.multissh.profilesSaveSSH).toHaveBeenCalled();
      expect(onConnectSSH).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ssh-3',
          name: 'Dev Sandbox',
          lastUsedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
        })
      );
    });
  });

  it('switches to S3 tab and displays S3 profiles and groups', async () => {
    render(
      <ConfirmProvider>
        <ConnectionManagerModal
          open={true}
          onClose={vi.fn()}
        />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    // Switch to S3 tab
    const s3TabButton = screen.getByRole('button', { name: /S3/i });
    fireEvent.click(s3TabButton);

    await waitFor(() => {
      expect(screen.getAllByText('Backup Bucket').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Backuper').length).toBeGreaterThanOrEqual(1);
    });
  });

  // M12 (code review): this dialog previously only closed via the header X.
  it('calls onClose on Escape and on a backdrop click from the list view (M12)', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <ConfirmProvider>
        <ConnectionManagerModal open={true} onClose={onClose} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstElementChild as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // M12 (code review): an accidental Escape or stray backdrop click while a
  // profile form is open must not silently discard it — there's no
  // unsaved-changes warning here, unlike closing via the form's own Cancel.
  it('does not close on Escape or backdrop click while a profile form is open (M12)', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <ConfirmProvider>
        <ConnectionManagerModal open={true} onClose={onClose} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Profile'));

    await waitFor(() => {
      expect(screen.queryByText('Dev Sandbox')).not.toBeInTheDocument();
    });

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    fireEvent.click(container.firstElementChild as Element);

    expect(onClose).not.toHaveBeenCalled();
  });

  // LOW finding (code review): deleting a connection profile used to go
  // through window.confirm(), trivially dismissed by a stray Enter/Space
  // press. It must now name the profile and only delete once confirmed.
  it('opens the install-public-key dialog for the clicked profile', async () => {
    (window.multissh as any).listPublicKeys = vi.fn().mockResolvedValue([]);
    render(
      <ConfirmProvider>
        <ConnectionManagerModal open={true} onClose={vi.fn()} onConnectSSH={vi.fn()} />
      </ConfirmProvider>
    );

    await waitFor(() => expect(screen.getByText('Prod DB 01')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('More actions')[0]);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Install public key' }));

    expect(await screen.findByTestId('install-key-modal')).toBeInTheDocument();
    expect((window.multissh as any).listPublicKeys).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ host: expect.any(String) }) })
    );
  });

  it('opens straight into the empty new-profile form when startNewProfile is set, and only for that open', async () => {
    const { rerender } = render(
      <ConfirmProvider>
        <ConnectionManagerModal open={true} startNewProfile onClose={vi.fn()} />
      </ConfirmProvider>
    );
    expect(await screen.findByLabelText(/Profile Name/i)).toHaveValue('');

    // Closed and re-opened without the flag: back to the plain list.
    rerender(
      <ConfirmProvider>
        <ConnectionManagerModal open={false} onClose={vi.fn()} />
      </ConfirmProvider>
    );
    rerender(
      <ConfirmProvider>
        <ConnectionManagerModal open={true} onClose={vi.fn()} />
      </ConfirmProvider>
    );
    await waitFor(() => expect(screen.getByText('Prod DB 01')).toBeInTheDocument());
    expect(screen.queryByLabelText(/Profile Name/i)).not.toBeInTheDocument();
  });

  it('asks for in-app confirmation before deleting a connection profile', async () => {
    render(
      <ConfirmProvider>
        <ConnectionManagerModal open={true} onClose={vi.fn()} />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Dev Sandbox')).toBeInTheDocument();
    });

    // Delete lives in each row's overflow menu. Dev Sandbox is the last row, per the Connect-button test's ordering.
    const openDeleteMenu = async () => {
      const menus = screen.getAllByTitle('More actions');
      fireEvent.click(menus[menus.length - 1]);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete profile' }));
    };
    await openDeleteMenu();

    const dialog = await screen.findByTestId('confirm-dialog');
    expect(dialog).toHaveTextContent('Dev Sandbox');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.multissh.profilesDeleteSSH).not.toHaveBeenCalled();

    await openDeleteMenu();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(window.multissh.profilesDeleteSSH).toHaveBeenCalledWith('ssh-3');
    });
  });
});
