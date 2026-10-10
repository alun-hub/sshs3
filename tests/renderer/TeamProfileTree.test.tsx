// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TeamProfileTree } from '../../src/renderer/src/components/ConnectionModal/TeamProfileTree';
import { buildTeamFolderTree } from '../../src/renderer/src/components/ConnectionModal/teamProfileTree';

interface P {
  id: string;
  name: string;
  group?: string;
}

function renderTree(folders: string[], profiles: P[], overrides: Partial<Parameters<typeof TeamProfileTree<P>>[0]> = {}) {
  const { roots, ungrouped } = buildTeamFolderTree(folders, profiles);
  const onDropProfile = vi.fn();
  const onCreateFolder = vi.fn();
  const onRenameFolder = vi.fn();
  const onDeleteFolder = vi.fn();
  const utils = render(
    <TeamProfileTree
      roots={roots}
      ungrouped={ungrouped}
      renderProfile={(p) => <div key={p.id}>{p.name}</div>}
      onDropProfile={onDropProfile}
      onCreateFolder={onCreateFolder}
      onRenameFolder={onRenameFolder}
      onDeleteFolder={onDeleteFolder}
      {...overrides}
    />
  );
  return { ...utils, onDropProfile, onCreateFolder, onRenameFolder, onDeleteFolder };
}

describe('TeamProfileTree', () => {
  afterEach(() => cleanup());

  it('renders nested folders and their profiles', () => {
    const profiles: P[] = [
      { id: 'p1', name: 'web-1', group: 'Acme Infra' },
      { id: 'p2', name: 'node-1', group: 'Acme Infra/Cluster A' },
    ];
    renderTree(['Acme Infra', 'Acme Infra/Cluster A'], profiles);

    expect(screen.getByText('Acme Infra')).toBeInTheDocument();
    expect(screen.getByText('Cluster A')).toBeInTheDocument();
    expect(screen.getByText('web-1')).toBeInTheDocument();
    expect(screen.getByText('node-1')).toBeInTheDocument();
  });

  it('shows an ungrouped section for profiles without a group', () => {
    renderTree([], [{ id: 'p1', name: 'standalone' }]);
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    expect(screen.getByText('standalone')).toBeInTheDocument();
  });

  it('collapsing a folder hides its children and profiles', () => {
    const profiles: P[] = [{ id: 'p1', name: 'web-1', group: 'Acme Infra' }];
    renderTree(['Acme Infra'], profiles);

    expect(screen.getByText('web-1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Acme Infra'));
    expect(screen.queryByText('web-1')).not.toBeInTheDocument();
  });

  it('creating a top-level folder calls onCreateFolder with the typed name', () => {
    const { onCreateFolder } = renderTree([], []);

    fireEvent.click(screen.getByRole('button', { name: /New top-level folder/i }));
    const input = screen.getByPlaceholderText('Folder name');
    fireEvent.change(input, { target: { value: 'New System' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateFolder).toHaveBeenCalledWith('New System');
  });

  it('creating a subfolder calls onCreateFolder with the joined path', () => {
    const { onCreateFolder } = renderTree(['Acme Infra'], []);

    fireEvent.click(screen.getByTitle('New subfolder'));
    const input = screen.getByPlaceholderText('Folder name');
    fireEvent.change(input, { target: { value: 'Cluster A' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCreateFolder).toHaveBeenCalledWith('Acme Infra/Cluster A');
  });

  it('renaming a folder calls onRenameFolder with the old and new full paths', () => {
    const { onRenameFolder } = renderTree(['Acme Infra/Cluster A'], []);

    const clusterRow = screen.getByText('Cluster A').closest('button')!.parentElement!;
    fireEvent.click(within(clusterRow).getByTitle('Rename folder'));
    const input = screen.getByDisplayValue('Cluster A');
    fireEvent.change(input, { target: { value: 'Cluster B' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameFolder).toHaveBeenCalledWith('Acme Infra/Cluster A', 'Acme Infra/Cluster B');
  });

  it('deleting a folder calls onDeleteFolder with its full path', () => {
    const { onDeleteFolder } = renderTree(['Acme Infra'], []);

    fireEvent.click(screen.getByTitle(/Delete folder/));
    expect(onDeleteFolder).toHaveBeenCalledWith('Acme Infra');
  });

  it('dropping a profile on a folder header calls onDropProfile with that folder path', () => {
    const { onDropProfile } = renderTree(['Acme Infra'], []);
    const header = screen.getByText('Acme Infra').closest('button')!.parentElement!;

    const dataTransfer = { getData: () => JSON.stringify({ type: 'ssh', id: 'p1' }) };
    fireEvent.drop(header, { dataTransfer });

    expect(onDropProfile).toHaveBeenCalledWith('Acme Infra', expect.anything());
  });

  it('dropping a profile on the Ungrouped zone calls onDropProfile with undefined', () => {
    const { onDropProfile } = renderTree([], [{ id: 'p1', name: 'standalone' }]);
    const zone = screen.getByText('Ungrouped').parentElement!;

    const dataTransfer = { getData: () => JSON.stringify({ type: 'ssh', id: 'p1' }) };
    fireEvent.drop(zone, { dataTransfer });

    expect(onDropProfile).toHaveBeenCalledWith(undefined, expect.anything());
  });
});
