// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TeamVaultSettingsPanel } from '../../src/renderer/src/components/SettingsModal/TeamVaultSettingsPanel';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';
import type { TeamVaultStatus } from '../../src/shared/types/teamVault';

function renderPanel() {
  return render(
    <ConfirmProvider>
      <TeamVaultSettingsPanel />
    </ConfirmProvider>
  );
}

describe('TeamVaultSettingsPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('no vault yet', () => {
    beforeEach(() => {
      window.multissh = {
        teamVaultGetStatus: vi.fn().mockResolvedValue({ exists: false, unlocked: false, filePath: '/x' }),
        teamVaultEnrollRecipient: vi.fn().mockResolvedValue({
          recipient: 'age1yubikey1testadmin',
          identityFilePath: '/tmp/identity.txt',
        }),
        teamVaultCreate: vi.fn().mockResolvedValue({ recoveryIdentity: 'AGE-SECRET-KEY-FAKE\n# public key: age1x' }),
      } as unknown as typeof window.multissh;
    });

    it('shows the empty state and lets the admin generate a recipient then create the vault', async () => {
      renderPanel();

      await waitFor(() => expect(screen.getByText(/No Team Vault exists/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Generate my recipient/i }));
      await waitFor(() => expect(screen.getByText('age1yubikey1testadmin')).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText(/alice@piv/i), { target: { value: 'alice@piv:yubikey-1' } });

      const createButton = screen.getByRole('button', { name: 'Create Vault' });
      expect(createButton).toBeEnabled();
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(window.multissh.teamVaultCreate).toHaveBeenCalledWith('alice@piv:yubikey-1', 'age1yubikey1testadmin');
      });

      // Recovery dialog appears and blocks "Done" until confirmed.
      const dialog = await screen.findByRole('dialog', { name: 'Save your recovery key' });
      expect(dialog).toHaveTextContent('AGE-SECRET-KEY-FAKE');
      const doneButton = within(dialog).getByRole('button', { name: 'Done' });
      expect(doneButton).toBeDisabled();

      fireEvent.click(within(dialog).getByRole('checkbox'));
      expect(doneButton).toBeEnabled();
      fireEvent.click(doneButton);
      expect(screen.queryByRole('dialog', { name: 'Save your recovery key' })).not.toBeInTheDocument();
    });
  });

  describe('existing vault', () => {
    const baseStatus: TeamVaultStatus = {
      exists: true,
      vaultId: 'vlt_1',
      unlocked: true,
      filePath: '/x',
      members: [
        { recipientId: 'alice@piv:abc', role: 'admin', addedAt: '2026-10-01T00:00:00Z' },
      ],
      adminCount: 1,
    };

    beforeEach(() => {
      window.multissh = {
        teamVaultGetStatus: vi.fn().mockResolvedValue(baseStatus),
        teamVaultAddMember: vi.fn().mockResolvedValue(undefined),
        teamVaultRemoveMember: vi.fn().mockResolvedValue({ remainingAdmins: 0 }),
        teamVaultSetRole: vi.fn().mockResolvedValue(undefined),
      } as unknown as typeof window.multissh;
    });

    it('warns when fewer than 2 admins', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());
      expect(screen.getByText(/fewer than 2 admins/)).toBeInTheDocument();
    });

    it('adds a member via the add-member form', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText(/Their recipient id/i), { target: { value: 'bob@piv:def' } });
      fireEvent.change(screen.getByPlaceholderText(/Their age1yubikey1/i), {
        target: { value: 'age1yubikey1bob' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultAddMember).toHaveBeenCalledWith(
          'bob@piv:def',
          'age1yubikey1bob',
          'member',
          'me'
        );
      });
    });

    it('asks for confirmation before removing a member', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Remove member'));
      const dialog = await screen.findByTestId('confirm-dialog');
      expect(dialog).toHaveTextContent('alice@piv:abc');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultRemoveMember).toHaveBeenCalledWith('alice@piv:abc', 'me');
      });
    });

    it('promotes/demotes a member via the role button', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Demote' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultSetRole).toHaveBeenCalledWith('alice@piv:abc', 'member', 'me');
      });
    });
  });

  describe('remote sync (Fas 3)', () => {
    const baseStatus: TeamVaultStatus = {
      exists: true,
      vaultId: 'vlt_1',
      unlocked: true,
      filePath: '/x',
      members: [{ recipientId: 'alice@piv:abc', role: 'admin', addedAt: '2026-10-01T00:00:00Z' }],
      adminCount: 1,
      remoteConfigured: false,
    };

    beforeEach(() => {
      window.multissh = {
        teamVaultGetStatus: vi.fn().mockResolvedValue(baseStatus),
        teamVaultHasRemoteVault: vi.fn().mockResolvedValue(false),
        teamVaultSetTarget: vi.fn().mockResolvedValue(undefined),
        teamVaultPush: vi.fn().mockResolvedValue(undefined),
        teamVaultPull: vi.fn().mockResolvedValue(undefined),
        profilesGet: vi.fn().mockResolvedValue({ ssh: [], s3: [] }),
      } as unknown as typeof window.multissh;
    });

    it('configures an S3 target', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('No S3 target configured yet')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Configure target/i }));
      fireEvent.change(await screen.findByLabelText(/Region/i), { target: { value: 'us-east-1' } });
      fireEvent.change(screen.getByLabelText(/Access Key ID/i), { target: { value: 'AKIA' } });
      fireEvent.change(screen.getByLabelText(/Secret Access Key/i), { target: { value: 'secret' } });
      fireEvent.change(screen.getByLabelText(/Bucket/i), { target: { value: 'team-bucket' } });

      fireEvent.click(screen.getByRole('button', { name: 'Save target' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultSetTarget).toHaveBeenCalledWith(
          expect.objectContaining({ type: 's3' }),
          'team-bucket'
        );
      });
    });

    it('pushes and pulls once a target is configured', async () => {
      window.multissh.teamVaultGetStatus = vi
        .fn()
        .mockResolvedValue({ ...baseStatus, remoteConfigured: true, lastSyncAt: '2026-10-08T00:00:00Z' });

      renderPanel();
      await waitFor(() => expect(screen.getByText('S3 target configured')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Push' }));
      await waitFor(() => expect(window.multissh.teamVaultPush).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
      await waitFor(() => expect(window.multissh.teamVaultPull).toHaveBeenCalled());
    });

    it('offers "Pull existing vault" when no local vault exists but a remote one does', async () => {
      window.multissh.teamVaultGetStatus = vi
        .fn()
        .mockResolvedValue({ exists: false, unlocked: false, filePath: '/x', remoteConfigured: true });
      window.multissh.teamVaultHasRemoteVault = vi.fn().mockResolvedValue(true);

      renderPanel();
      await waitFor(() => expect(screen.getByText(/already has a Team Vault/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Pull existing vault' }));
      await waitFor(() => expect(window.multissh.teamVaultPull).toHaveBeenCalled());
    });
  });
});
