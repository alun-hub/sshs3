// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TeamProfileTreeList } from '../../src/renderer/src/components/ConnectionModal/TeamProfileTreeList';
import { ConfirmProvider } from '../../src/renderer/src/components/ConfirmDialog';
import type { TeamVaultPayload, TeamVaultStatus } from '../../src/shared/types/teamVault';

const lockedStatus: TeamVaultStatus = {
  exists: true,
  vaultId: 'v1',
  vaultName: 'Acme',
  unlocked: false,
  filePath: '/tmp/v1',
  selfRecipientId: 'age1alice',
  selfIdentityFilePath: '/home/alice/key.txt',
} as TeamVaultStatus;

const payload: TeamVaultPayload = {
  ssh: [{ id: 'p1', name: 'web-1', host: 'web-1.example.com', username: 'root', authType: 'password', group: 'Acme Infra' } as never],
  s3: [],
  folders: ['Acme Infra'],
} as TeamVaultPayload;

function setApi(over: Record<string, unknown> = {}) {
  window.multissh = {
    teamVaultList: vi.fn().mockResolvedValue([lockedStatus]),
    teamVaultGetStatus: vi.fn().mockResolvedValue(lockedStatus),
    teamVaultGetPayload: vi.fn().mockResolvedValue(payload),
    teamVaultUnlock: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as typeof window.multissh;
}

function renderList(props: Partial<React.ComponentProps<typeof TeamProfileTreeList>> = {}) {
  return render(
    <ConfirmProvider>
      <TeamProfileTreeList
        tab="ssh"
        query=""
        activeVaultId="v1"
        setEditing={vi.fn()}
        onNewProfile={vi.fn()}
        onVaultsMetaChange={vi.fn()}
        {...props}
      />
    </ConfirmProvider>
  );
}

afterEach(() => cleanup());

describe('TeamProfileTreeList errors', () => {
  beforeEach(() => setApi());

  it('keeps the unlock form after a failed unlock, with a message that can be dismissed', async () => {
    window.multissh.teamVaultUnlock = vi.fn().mockRejectedValue(new Error('Wrong passphrase'));
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: /Unlock as age1alice/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Wrong passphrase');
    // Still there to try again: the form was replaced by the message before.
    expect(screen.getByRole('button', { name: /Unlock as age1alice/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the message when the next attempt is made', async () => {
    const unlock = vi.fn().mockRejectedValueOnce(new Error('Wrong passphrase')).mockResolvedValue(undefined);
    window.multissh.teamVaultUnlock = unlock;
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: /Unlock as age1alice/ }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /Unlock as age1alice/ }));

    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('offers a retry when the list of teams cannot be loaded', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error('keyring locked')).mockResolvedValue([lockedStatus]);
    window.multissh.teamVaultList = list;
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('keyring locked');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: /Unlock as age1alice/ })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('TeamProfileTreeList folder position', () => {
  const unlocked = { ...lockedStatus, unlocked: true } as TeamVaultStatus;
  beforeEach(() => setApi({ teamVaultList: vi.fn().mockResolvedValue([unlocked]), teamVaultGetStatus: vi.fn().mockResolvedValue(unlocked) }));

  it('reports where the user went and shows the position it is given, so it survives a remount', async () => {
    const onFolderPathChange = vi.fn();
    const first = renderList({ folderPaths: {}, onFolderPathChange });

    fireEvent.click(await screen.findByRole('button', { name: 'Open Acme Infra' }));
    expect(onFolderPathChange).toHaveBeenCalledWith('ssh/v1', ['Acme Infra']);
    first.unmount();

    // A new instance (the list is unmounted while a profile is edited) opens in that folder.
    renderList({ folderPaths: { 'ssh/v1': ['Acme Infra'] }, onFolderPathChange });
    expect(await screen.findByText('web-1')).toBeInTheDocument();
  });

  it('keeps a position per tab: the S3 tab does not inherit the SSH tab\'s folder', async () => {
    renderList({ tab: 's3', folderPaths: { 'ssh/v1': ['Acme Infra'] } });
    await screen.findByText(/No profiles|New Profile/);
    expect(screen.queryByText('web-1')).not.toBeInTheDocument();
  });
});

describe('TeamProfileTreeList folder sidebar', () => {
  const unlocked = { ...lockedStatus, unlocked: true } as TeamVaultStatus;
  const nested = {
    ssh: [
      { id: 'p1', name: 'web-1', host: 'web-1.example.com', username: 'root', authType: 'password', group: 'Acme Infra' },
      { id: 'p2', name: 'node-1', host: 'node-1.example.com', username: 'root', authType: 'password', group: 'Acme Infra/Cluster A' },
    ],
    s3: [],
    folders: ['Acme Infra', 'Acme Infra/Cluster A'],
  } as unknown as TeamVaultPayload;

  beforeEach(() =>
    setApi({
      teamVaultList: vi.fn().mockResolvedValue([unlocked]),
      teamVaultGetStatus: vi.fn().mockResolvedValue(unlocked),
      teamVaultGetPayload: vi.fn().mockResolvedValue(nested),
    })
  );

  it('shows the folder tree beside the list, with the number of profiles in each folder', async () => {
    renderList();
    const tree = await screen.findByRole('navigation', { name: 'Folders' });
    expect(tree).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Acme Infra (2 profiles)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All folders (2 profiles)' })).toBeInTheDocument();
  });

  it('browses a folder picked in the tree with the same position the breadcrumb uses', async () => {
    const onFolderPathChange = vi.fn();
    renderList({ folderPaths: {}, onFolderPathChange });
    fireEvent.click(await screen.findByRole('button', { name: 'Acme Infra (2 profiles)' }));
    expect(onFolderPathChange).toHaveBeenCalledWith('ssh/v1', ['Acme Infra']);
  });

  it('highlights, and opens the tree down to, the folder the list is showing', async () => {
    renderList({ folderPaths: { 'ssh/v1': ['Acme Infra', 'Cluster A'] }, onFolderPathChange: vi.fn() });
    expect(await screen.findByRole('button', { name: 'Cluster A (1 profile)' })).toHaveAttribute('aria-current', 'page');
  });

  it('is not shown while searching, when the results are one flat list', async () => {
    renderList({ query: 'web' });
    await screen.findByText(/Search results for/);
    expect(screen.queryByRole('navigation', { name: 'Folders' })).not.toBeInTheDocument();
  });

  it('is not shown for a team without folders', async () => {
    window.multissh.teamVaultGetPayload = vi.fn().mockResolvedValue({
      ssh: [{ id: 'p1', name: 'web-1', host: 'h', username: 'root', authType: 'password' }],
      s3: [],
      folders: [],
    });
    renderList();
    await screen.findByText('web-1');
    expect(screen.queryByRole('navigation', { name: 'Folders' })).not.toBeInTheDocument();
  });
});
