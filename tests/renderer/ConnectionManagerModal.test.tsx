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
      teamVaultGetStatus: vi.fn().mockResolvedValue({
        exists: true,
        unlocked: true,
        filePath: '/x',
        selfRecipientId: 'alice@piv:abc',
        selfIdentityFilePath: '/tmp/alice-identity.txt',
      }),
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

  describe('Team Vault view (connection-manager-plan: two separate views, not a merged list)', () => {
    it('shows an unlock prompt instead of profiles when the vault is locked', async () => {
      window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue(null);
      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText(/Unlock the Team Vault/)).toBeInTheDocument());
      // Personal profiles must not leak into the Team view.
      expect(screen.queryByText('Prod Web 01')).not.toBeInTheDocument();
    });

    it('lists shared SSH/S3 profiles once unlocked, separately from personal ones', async () => {
      window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue({
        ssh: [
          { id: 'team-ssh-1', name: 'Shared Bastion', host: 'bastion.example.com', username: 'ops', authType: 'password' },
        ],
        s3: [],
      });
      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText('Shared Bastion')).toBeInTheDocument());
      expect(screen.queryByText('Prod Web 01')).not.toBeInTheDocument();
    });

    it('flags a shared privateKey-authenticated profile as machine-local', async () => {
      window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue({
        ssh: [
          {
            id: 'team-ssh-2',
            name: 'Shared Key Host',
            host: 'keyhost.example.com',
            username: 'ops',
            authType: 'privateKey',
            privateKeyPath: '/home/alice/.ssh/id_ed25519',
          },
        ],
        s3: [],
      });
      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText('Shared Key Host')).toBeInTheDocument());
      expect(screen.getByText(/Private key path is local to this machine/)).toBeInTheDocument();
    });

    it('saves a new profile via the Team Vault IPC, not the personal profile store, while in the Team view', async () => {
      window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue({ ssh: [], s3: [] });
      window.multissh.teamVaultSaveSSHProfile = vi.fn().mockResolvedValue(undefined);
      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText('No shared SSH profiles yet')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /New Profile/i }));
      fireEvent.change(await screen.findByLabelText(/Profile Name/i), { target: { value: 'Shared Host' } });
      fireEvent.change(screen.getByLabelText(/Hostname \/ IP/i), { target: { value: 'shared.example.com' } });
      fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'ops' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultSaveSSHProfile).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Shared Host', host: 'shared.example.com' })
        );
      });
      expect(window.multissh.profilesSaveSSH).not.toHaveBeenCalled();
    });

    it("saves a smartcard profile's PKCS#11 path directly into the shared payload (pkcs11LibPath is not a security boundary — see correction in the connection-manager plan)", async () => {
      window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue({ ssh: [], s3: [] });
      window.multissh.teamVaultSaveSSHProfile = vi.fn().mockResolvedValue(undefined);
      window.multissh.smartcardDetect = vi.fn().mockResolvedValue([]);

      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText('No shared SSH profiles yet')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /New Profile/i }));
      fireEvent.change(await screen.findByLabelText(/Profile Name/i), { target: { value: 'Shared Smartcard Host' } });
      fireEvent.change(screen.getByLabelText(/Hostname \/ IP/i), { target: { value: 'h' } });
      fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: 'u' } });
      fireEvent.change(screen.getByLabelText(/Authentication/i), { target: { value: 'smartcard' } });
      fireEvent.change(await screen.findByLabelText(/PKCS#11 Library/i), {
        target: { value: '/usr/lib/opensc-pkcs11.so' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));
      // Smartcard/key-based auth types show an intermediate "not verified yet" access-check
      // panel on first submit (SSHProfileForm) — this test isn't exercising that flow, so take
      // its explicit "save anyway" escape hatch.
      fireEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));

      await waitFor(() => expect(window.multissh.teamVaultSaveSSHProfile).toHaveBeenCalled());
      const savedConfig = (window.multissh.teamVaultSaveSSHProfile as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(savedConfig.pkcs11LibPath).toBe('/usr/lib/opensc-pkcs11.so');
    });

    it('hides the New Profile button in the Team view while the vault is locked', async () => {
      window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue(null);
      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText(/Unlock the Team Vault/)).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /New Profile/i })).not.toBeInTheDocument();
    });

    it('refreshes the Team view when the background auto-poll reports a pulled update', async () => {
      let autoPulledCallback: (() => void) | undefined;
      window.multissh.teamVaultGetPayload = vi
        .fn()
        .mockResolvedValueOnce({ ssh: [], s3: [] })
        .mockResolvedValueOnce({
          ssh: [{ id: 'team-ssh-3', name: 'New From Bob', host: 'h', username: 'u', authType: 'password' }],
          s3: [],
        });
      window.multissh.onTeamVaultAutoPulled = vi.fn((cb: () => void) => {
        autoPulledCallback = cb;
        return () => {};
      });
      window.multissh.onTeamVaultRemoteChanged = vi.fn(() => () => {});

      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText('No shared SSH profiles yet')).toBeInTheDocument());

      autoPulledCallback?.();

      await waitFor(() => expect(screen.getByText('New From Bob')).toBeInTheDocument());
      expect(screen.getByText(/Updated from another member/)).toBeInTheDocument();
    });

    it('unlocks right from the Team view, with no detour through Settings, using the saved identity', async () => {
      window.multissh.teamVaultGetPayload = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ssh: [], s3: [] });
      window.multissh.teamVaultUnlock = vi.fn().mockResolvedValue(undefined);

      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByText(/Unlock as alice@piv:abc/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Unlock as alice@piv:abc/ }));

      await waitFor(() => {
        expect(window.multissh.teamVaultUnlock).toHaveBeenCalledWith('alice@piv:abc', '/tmp/alice-identity.txt');
      });
      await waitFor(() => expect(screen.getByText('No shared SSH profiles yet')).toBeInTheDocument());
    });

    it('falls back to manual recipient id / identity file fields when no saved identity exists', async () => {
      window.multissh.teamVaultGetStatus = vi.fn().mockResolvedValue({
        exists: true,
        unlocked: false,
        filePath: '/x',
      });
      window.multissh.teamVaultGetPayload = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ssh: [], s3: [] });
      window.multissh.teamVaultUnlock = vi.fn().mockResolvedValue(undefined);

      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() => expect(screen.getByPlaceholderText('Your recipient id')).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText('Your recipient id'), { target: { value: 'bob@piv:def' } });
      fireEvent.change(screen.getByPlaceholderText('Path to your identity file'), {
        target: { value: '/tmp/bob-identity.txt' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultUnlock).toHaveBeenCalledWith('bob@piv:def', '/tmp/bob-identity.txt');
      });
      await waitFor(() => expect(screen.getByText('No shared SSH profiles yet')).toBeInTheDocument());
    });

    it('shows a "no vault yet" message instead of unlock fields when no Team Vault exists on this machine', async () => {
      window.multissh.teamVaultGetStatus = vi.fn().mockResolvedValue({ exists: false, unlocked: false, filePath: '/x' });
      window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue(null);

      render(
        <ConfirmProvider>
          <ConnectionManagerModal open={true} onClose={vi.fn()} />
        </ConfirmProvider>
      );
      await waitFor(() => expect(screen.getByText('Dev Sandbox')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Team' }));
      await waitFor(() =>
        expect(screen.getByText('No Team Vault has been set up on this machine yet.')).toBeInTheDocument()
      );
      expect(screen.queryByPlaceholderText('Your recipient id')).not.toBeInTheDocument();
    });
  });
});
