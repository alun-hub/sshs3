// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TeamVaultListPanel } from '../../src/renderer/src/components/SettingsModal/TeamVaultListPanel';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';

function renderPanel() {
  return render(
    <ConfirmProvider>
      <TeamVaultListPanel />
    </ConfirmProvider>
  );
}

describe('TeamVaultListPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('no teams yet', () => {
    function mockApi() {
      window.multissh = {
        teamVaultList: vi.fn().mockResolvedValue([]),
        teamVaultEnrollRecipient: vi.fn().mockResolvedValue({
          recipient: 'age1yubikey1testadmin',
          identityFilePath: '/tmp/identity.txt',
        }),
        teamVaultCreate: vi.fn().mockResolvedValue({
          vaultId: 'vlt_new',
          recoveryIdentity: 'AGE-SECRET-KEY-FAKE\n# public key: age1x',
        }),
      } as unknown as typeof window.multissh;
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    }

    it('shows the empty state and the create/join actions', async () => {
      mockApi();
      renderPanel();
      await waitFor(() => expect(screen.getByText(/No Team Vault has been set up/)).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /Create a new team/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Join an existing team/i })).toBeInTheDocument();
    });

    it('creates a vault: generate a recipient, name it, confirm the recovery key', async () => {
      mockApi();
      renderPanel();
      await waitFor(() => expect(screen.getByText(/No Team Vault has been set up/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Create a new team/i }));
      fireEvent.click(screen.getByRole('button', { name: /Generate my Team Vault ID/i }));
      await waitFor(() => expect(screen.getByText('age1yubikey1testadmin')).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText(/alice@piv/i), { target: { value: 'alice@piv:yubikey-1' } });
      fireEvent.change(screen.getByPlaceholderText(/Acme Infra Team/i), { target: { value: 'Acme Infra' } });

      fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultCreate).toHaveBeenCalledWith(
          'alice@piv:yubikey-1',
          'age1yubikey1testadmin',
          'Acme Infra'
        );
      });

      const dialog = await screen.findByRole('dialog', { name: 'Save your recovery key' });
      expect(dialog).toHaveTextContent('AGE-SECRET-KEY-FAKE');
      const doneButton = within(dialog).getByRole('button', { name: 'Done' });
      expect(doneButton).toBeDisabled();

      fireEvent.click(within(dialog).getByRole('button', { name: /Copy/i }));
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('AGE-SECRET-KEY-FAKE'));
      });

      fireEvent.click(within(dialog).getByRole('checkbox'));
      expect(doneButton).toBeEnabled();
      fireEvent.click(doneButton);
      expect(screen.queryByRole('dialog', { name: 'Save your recovery key' })).not.toBeInTheDocument();
    });

    it('lets a new member copy a join-info blob to send to an existing team\'s admin', async () => {
      mockApi();
      renderPanel();
      await waitFor(() => expect(screen.getByText(/No Team Vault has been set up/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Join an existing team/i }));
      fireEvent.click(screen.getByRole('button', { name: /Generate my Team Vault ID/i }));
      await waitFor(() => expect(screen.getByText('age1yubikey1testadmin')).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText(/alice@piv/i), { target: { value: 'bob@piv:yubikey-1' } });
      fireEvent.click(screen.getByRole('button', { name: /Copy join info/i }));

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          'sshs3 Team Vault join request\nrecipientId: bob@piv:yubikey-1\nageRecipient: age1yubikey1testadmin'
        );
      });
    });

    it('joins an existing team by entering its Team ID, configuring a target, and pulling under that real vaultId', async () => {
      const teamVaultSetTarget = vi.fn().mockResolvedValue(undefined);
      const teamVaultHasRemoteVault = vi.fn().mockResolvedValue(true);
      const teamVaultPull = vi.fn().mockResolvedValue({ exists: true, unlocked: false, filePath: '/x', vaultId: 'vlt_joined' });
      window.multissh = {
        teamVaultList: vi.fn().mockResolvedValue([]),
        teamVaultSetTarget,
        teamVaultHasRemoteVault,
        teamVaultPull,
      } as unknown as typeof window.multissh;

      renderPanel();
      await waitFor(() => expect(screen.getByText(/No Team Vault has been set up/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Join an existing team/i }));
      fireEvent.change(screen.getByPlaceholderText('vlt_...'), { target: { value: 'vlt_joined' } });
      fireEvent.change(await screen.findByLabelText(/Region/i), { target: { value: 'us-east-1' } });
      fireEvent.change(screen.getByLabelText(/Access Key ID/i), { target: { value: 'AKIA' } });
      fireEvent.change(screen.getByLabelText(/Secret Access Key/i), { target: { value: 'secret' } });
      fireEvent.change(screen.getByLabelText(/Bucket/i), { target: { value: 'team-bucket' } });

      fireEvent.click(screen.getByRole('button', { name: /Pull and join/i }));

      await waitFor(() => {
        expect(teamVaultSetTarget).toHaveBeenCalledWith('vlt_joined', expect.objectContaining({ type: 's3' }), 'team-bucket');
      });
      await waitFor(() => expect(teamVaultHasRemoteVault).toHaveBeenCalledWith('vlt_joined'));
      await waitFor(() => expect(teamVaultPull).toHaveBeenCalledWith('vlt_joined'));
    });

    it('refuses to join without a Team ID, and surfaces a clear error when nothing is found at the target', async () => {
      const teamVaultSetTarget = vi.fn().mockResolvedValue(undefined);
      const teamVaultHasRemoteVault = vi.fn().mockResolvedValue(false);
      const teamVaultPull = vi.fn();
      window.multissh = {
        teamVaultList: vi.fn().mockResolvedValue([]),
        teamVaultSetTarget,
        teamVaultHasRemoteVault,
        teamVaultPull,
      } as unknown as typeof window.multissh;

      renderPanel();
      await waitFor(() => expect(screen.getByText(/No Team Vault has been set up/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Join an existing team/i }));
      fireEvent.change(await screen.findByLabelText(/Region/i), { target: { value: 'us-east-1' } });
      fireEvent.change(screen.getByLabelText(/Access Key ID/i), { target: { value: 'AKIA' } });
      fireEvent.change(screen.getByLabelText(/Secret Access Key/i), { target: { value: 'secret' } });
      fireEvent.change(screen.getByLabelText(/Bucket/i), { target: { value: 'team-bucket' } });

      expect(screen.getByRole('button', { name: /Pull and join/i })).toBeDisabled();

      fireEvent.change(screen.getByPlaceholderText('vlt_...'), { target: { value: 'vlt_joined' } });
      fireEvent.click(screen.getByRole('button', { name: /Pull and join/i }));

      await waitFor(() => expect(screen.getByText(/No Team Vault found at that location/i)).toBeInTheDocument());
      expect(teamVaultPull).not.toHaveBeenCalled();
    });
  });

  describe('existing teams', () => {
    function mockApi() {
      window.multissh = {
        teamVaultList: vi.fn().mockResolvedValue([
          {
            exists: true,
            vaultId: 'vlt_1',
            vaultName: 'Acme Infra Team',
            unlocked: true,
            filePath: '/x',
            members: [{ recipientId: 'alice@piv:abc', role: 'admin', addedAt: '2026-10-01T00:00:00Z' }],
            adminCount: 1,
            selfRecipientId: 'alice@piv:abc',
            selfRole: 'admin',
          },
          {
            exists: true,
            vaultId: 'vlt_2',
            unlocked: false,
            filePath: '/y',
            members: [{ recipientId: 'alice@piv:abc', role: 'member', addedAt: '2026-10-02T00:00:00Z' }],
            adminCount: 1,
            selfRole: 'member',
          },
        ]),
        teamVaultGetStatus: vi.fn().mockResolvedValue({
          exists: true,
          vaultId: 'vlt_1',
          vaultName: 'Acme Infra Team',
          unlocked: true,
          filePath: '/x',
          members: [{ recipientId: 'alice@piv:abc', role: 'admin', addedAt: '2026-10-01T00:00:00Z' }],
          adminCount: 1,
          selfRecipientId: 'alice@piv:abc',
          selfRole: 'admin',
        }),
        teamVaultForget: vi.fn().mockResolvedValue(undefined),
      } as unknown as typeof window.multissh;
    }

    it('lists every known team with its name, role, and lock state', async () => {
      mockApi();
      renderPanel();
      await waitFor(() => expect(screen.getByText('Acme Infra Team')).toBeInTheDocument());
      expect(screen.getByText('vlt_2')).toBeInTheDocument();
      expect(screen.getByText(/1 member · admin/)).toBeInTheDocument();
      expect(screen.getByText(/1 member · member/)).toBeInTheDocument();
    });

    it('opens a team\'s detail panel on row click, scoped to that vaultId', async () => {
      mockApi();
      renderPanel();
      await waitFor(() => expect(screen.getByText('Acme Infra Team')).toBeInTheDocument());

      fireEvent.click(screen.getByText('Acme Infra Team'));

      await waitFor(() => expect(window.multissh.teamVaultGetStatus).toHaveBeenCalledWith('vlt_1'));
      expect(screen.getByRole('button', { name: /Teams/i })).toBeInTheDocument();
    });

    it('only offers "forget" on a locked team, and calls teamVaultForget with its vaultId', async () => {
      mockApi();
      renderPanel();
      await waitFor(() => expect(screen.getByText('Acme Infra Team')).toBeInTheDocument());

      // Only one forget button exists — for vlt_2 (locked); vlt_1 is unlocked.
      const forgetButtons = screen.getAllByTitle('Remove this team from this device');
      expect(forgetButtons).toHaveLength(1);

      fireEvent.click(forgetButtons[0]);
      const dialog = await screen.findByTestId('confirm-dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(window.multissh.teamVaultForget).toHaveBeenCalledWith('vlt_2'));
    });

    it('surfaces a clear message when forget is refused because the team is still unlocked', async () => {
      mockApi();
      window.multissh.teamVaultForget = vi.fn().mockRejectedValue(new Error('Lock this Team Vault before forgetting it on this device'));
      renderPanel();
      await waitFor(() => expect(screen.getByText('Acme Infra Team')).toBeInTheDocument());

      const forgetButtons = screen.getAllByTitle('Remove this team from this device');
      fireEvent.click(forgetButtons[0]);
      const dialog = await screen.findByTestId('confirm-dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(screen.getByText(/Lock this team first/i)).toBeInTheDocument());
    });
  });
});
