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
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
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

    it('lets a new member (joining, not creating) copy a join-info blob for their admin instead of typing recipient/identity fields anywhere', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText(/No Team Vault exists/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Generate my recipient/i }));
      await waitFor(() => expect(screen.getByText('age1yubikey1testadmin')).toBeInTheDocument());

      // The same recipient-id field doubles as "your suggested label" for the join blob — no
      // separate field needed.
      fireEvent.change(screen.getByPlaceholderText(/alice@piv/i), { target: { value: 'bob@piv:yubikey-1' } });
      fireEvent.click(screen.getByRole('button', { name: /Copy join info/i }));

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          'sshs3 Team Vault join request\nrecipientId: bob@piv:yubikey-1\nageRecipient: age1yubikey1testadmin'
        );
      });
      expect(await screen.findByText(/Copied/i)).toBeInTheDocument();
    });

    it('prefills the recipient-id field with the UPN suggested from an existing smartcard certificate', async () => {
      window.multissh.teamVaultEnrollRecipient = vi.fn().mockResolvedValue({
        recipient: 'age1yubikey1testadmin',
        identityFilePath: '/tmp/identity.txt',
        suggestedLabel: 'alice@example.com',
      });

      renderPanel();
      await waitFor(() => expect(screen.getByText(/No Team Vault exists/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /Generate my recipient/i }));

      await waitFor(() => {
        expect((screen.getByPlaceholderText(/alice@piv/i) as HTMLInputElement).value).toBe('alice@example.com');
      });
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
      selfRecipientId: 'alice@piv:abc',
    };

    beforeEach(() => {
      window.multissh = {
        teamVaultGetStatus: vi.fn().mockResolvedValue(baseStatus),
        teamVaultEnrollRecipient: vi.fn().mockResolvedValue({
          recipient: 'age1yubikey1testadmin',
          identityFilePath: '/tmp/identity.txt',
        }),
        teamVaultAddMember: vi.fn().mockResolvedValue(undefined),
        teamVaultRemoveMember: vi.fn().mockResolvedValue({ remainingAdmins: 0 }),
        teamVaultSetRole: vi.fn().mockResolvedValue(undefined),
        teamVaultDelete: vi.fn().mockResolvedValue(undefined),
      } as unknown as typeof window.multissh;
    });

    it('warns when fewer than 2 admins', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());
      expect(screen.getByText(/fewer than 2 admins/)).toBeInTheDocument();
    });

    it('keeps "Generate my recipient" visible even once a vault already exists, ready for a future second team', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /Generate my recipient/i })).toBeInTheDocument();
    });

    it('adds a member by pasting their join-info blob into the one field — no second box to fill in', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      const joinInfo =
        'sshs3 Team Vault join request\nrecipientId: bob@piv:def\nageRecipient: age1yubikey1bobbobbobbobbobbobbobbob';
      fireEvent.change(screen.getByPlaceholderText(/Paste their join info/i), { target: { value: joinInfo } });

      await waitFor(() => {
        expect(screen.getByTestId('parsed-join-info-recipient-id')).toHaveTextContent('bob@piv:def');
      });
      expect(screen.getByTestId('parsed-join-info-age-recipient')).toHaveTextContent(
        'age1yubikey1bobbobbobbobbobbobbobbob'
      );
      // No separate recipient-id input exists any more — only the paste box.
      expect(screen.queryByPlaceholderText(/Their recipient id/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultAddMember).toHaveBeenCalledWith(
          'bob@piv:def',
          'age1yubikey1bobbobbobbobbobbobbobbob',
          'member'
        );
      });
    });

    it("shows an inline hint instead of a crash when the pasted text isn't a recognizable join blob", async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      fireEvent.change(screen.getByPlaceholderText(/Paste their join info/i), { target: { value: 'oops wrong thing' } });

      expect(await screen.findByText(/doesn't look like a join-info blob/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add member' })).toBeDisabled();
    });

    it('asks for confirmation before removing a member', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      fireEvent.click(screen.getByTitle('Remove member'));
      const dialog = await screen.findByTestId('confirm-dialog');
      expect(dialog).toHaveTextContent('alice@piv:abc');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultRemoveMember).toHaveBeenCalledWith('alice@piv:abc');
      });
    });

    it('promotes/demotes a member via the role button', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Demote' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultSetRole).toHaveBeenCalledWith('alice@piv:abc', 'member');
      });
    });

    it('offers to delete the vault (local-only) when the signed-in identity is an admin, with confirmation', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Remove vault from this machine/i }));
      const dialog = await screen.findByTestId('confirm-dialog');
      expect(dialog).toHaveTextContent(/S3 copy/i);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(window.multissh.teamVaultDelete).toHaveBeenCalled());
    });

    it('hides the delete-vault button for a plain, non-admin member', async () => {
      window.multissh.teamVaultGetStatus = vi.fn().mockResolvedValue({
        ...baseStatus,
        selfRecipientId: 'bob@piv:def',
        members: [
          { recipientId: 'alice@piv:abc', role: 'admin', addedAt: '2026-10-01T00:00:00Z' },
          { recipientId: 'bob@piv:def', role: 'member', addedAt: '2026-10-02T00:00:00Z' },
        ],
      });

      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Remove vault from this machine/i })).not.toBeInTheDocument();
    });
  });

  describe('locked vault, with a remembered own identity (no fields needed to unlock)', () => {
    const lockedStatus: TeamVaultStatus = {
      exists: true,
      vaultId: 'vlt_1',
      unlocked: false,
      filePath: '/x',
      members: [
        { recipientId: 'alice@piv:abc', role: 'admin', addedAt: '2026-10-01T00:00:00Z' },
      ],
      adminCount: 1,
      selfRecipientId: 'alice@piv:abc',
      selfIdentityFilePath: '/home/alice/.config/sshs3/team-vault-identities/abc.txt',
    };

    beforeEach(() => {
      window.multissh = {
        teamVaultGetStatus: vi.fn().mockResolvedValue(lockedStatus),
        teamVaultUnlock: vi.fn().mockResolvedValue(undefined),
      } as unknown as typeof window.multissh;
    });

    it('shows no recipient-id/identity-path fields at all when both are already known — just an Unlock button', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText(/Unlock as/)).toBeInTheDocument());

      expect(screen.getByText(/Unlock as/)).toHaveTextContent('alice@piv:abc');
      expect(screen.queryByPlaceholderText('Your recipient id')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Path to your identity file')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
      await waitFor(() => {
        expect(window.multissh.teamVaultUnlock).toHaveBeenCalledWith(
          'alice@piv:abc',
          '/home/alice/.config/sshs3/team-vault-identities/abc.txt'
        );
      });
    });

    it('offers a manual fallback ("use a different identity") for the rare case of multiple identities or a new machine', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText(/Unlock as/)).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /use a different identity/i }));

      const recipientInput = screen.getByPlaceholderText('Your recipient id') as HTMLInputElement;
      const identityInput = screen.getByPlaceholderText('Path to your identity file') as HTMLInputElement;
      fireEvent.change(recipientInput, { target: { value: 'carol@piv:ghi' } });
      fireEvent.change(identityInput, { target: { value: '/tmp/carol-identity.txt' } });
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

      await waitFor(() => {
        expect(window.multissh.teamVaultUnlock).toHaveBeenCalledWith('carol@piv:ghi', '/tmp/carol-identity.txt');
      });
    });
  });

  describe('locked vault, with no remembered identity at all (fresh machine)', () => {
    beforeEach(() => {
      window.multissh = {
        teamVaultGetStatus: vi.fn().mockResolvedValue({
          exists: true,
          vaultId: 'vlt_1',
          unlocked: false,
          filePath: '/x',
          members: [{ recipientId: 'alice@piv:abc', role: 'admin', addedAt: '2026-10-01T00:00:00Z' }],
          adminCount: 1,
        }),
        teamVaultUnlock: vi.fn().mockResolvedValue(undefined),
      } as unknown as typeof window.multissh;
    });

    it('falls back to the manual fields directly, with no "known identity" summary to show', async () => {
      renderPanel();
      await waitFor(() => expect(screen.getByText('alice@piv:abc')).toBeInTheDocument());

      expect(screen.getByPlaceholderText('Your recipient id')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Path to your identity file')).toBeInTheDocument();
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
