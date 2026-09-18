// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FileList } from '../../src/renderer/src/components/FileManager/FileList';
import type { FileEntry } from '../../src/shared/types/storage';

const mockEntries: FileEntry[] = [
  { name: 'config.json', path: '/config.json', size: 120, isDirectory: false, mtime: '2026-09-15 10:00' },
  { name: 'documents', path: '/documents', size: 0, isDirectory: true, mtime: '2026-09-15 11:00' },
  { name: 'image.png', path: '/image.png', size: 2048, isDirectory: false, mtime: '2026-09-15 12:00' },
  { name: 'backup.tar.gz', path: '/backup.tar.gz', size: 1048576, isDirectory: false, mtime: '2026-09-15 09:00' },
];

describe('FileList Component', () => {
  it('renders all entries when no filter is provided', () => {
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText('documents')).toBeInTheDocument();
    expect(screen.getByText('config.json')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
    expect(screen.getByText('backup.tar.gz')).toBeInTheDocument();
  });

  it('filters entries case-insensitively based on filterText', () => {
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        filterText="DOC"
      />
    );

    expect(screen.getByText('documents')).toBeInTheDocument();
    expect(screen.queryByText('config.json')).not.toBeInTheDocument();
    expect(screen.queryByText('image.png')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
  });

  it('shows no match message when filter yields zero results', () => {
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        filterText="nonexistent"
      />
    );

    expect(screen.getByText('No files match "nonexistent"')).toBeInTheDocument();
  });

  it('renders permissions header and file permissions', () => {
    const permEntries: FileEntry[] = [
      { name: 'app.sh', path: '/app.sh', size: 100, isDirectory: false, permissions: '755' },
    ];

    render(
      <FileList
        entries={permEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    expect(screen.getByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('755')).toBeInTheDocument();
  });

  it('virtualizes large collections of files efficiently', () => {
    const largeEntries: FileEntry[] = Array.from({ length: 1000 }, (_, i) => ({
      name: `file_${i}.txt`,
      path: `/file_${i}.txt`,
      size: 1024 * i,
      isDirectory: false,
      mtime: '2026-09-17 12:00',
    }));

    render(
      <FileList
        entries={largeEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
      />
    );

    // Initial window items should render
    expect(screen.getByText('file_0.txt')).toBeInTheDocument();
  });

  it('sets dropEffect to copy on dragOver for both files and directories', () => {
    const onEntryDragOver = vi.fn();
    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        isDropTarget={(entry) => entry.isDirectory}
        onEntryDragOver={onEntryDragOver}
      />
    );

    const docRow = screen.getByText('documents').closest('[role="row"]')!;
    const fileRow = screen.getByText('config.json').closest('[role="row"]')!;

    const docDataTransfer = { dropEffect: 'none' };
    const preventDefaultDoc = vi.fn();
    fireEvent.dragOver(docRow, {
      dataTransfer: docDataTransfer,
      preventDefault: preventDefaultDoc,
    });
    expect(docDataTransfer.dropEffect).toBe('copy');
    expect(onEntryDragOver).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'documents' }),
      expect.anything()
    );

    const fileDataTransfer = { dropEffect: 'none' };
    const preventDefaultFile = vi.fn();
    fireEvent.dragOver(fileRow, {
      dataTransfer: fileDataTransfer,
      preventDefault: preventDefaultFile,
    });
    expect(fileDataTransfer.dropEffect).toBe('copy');
  });

  it('delegates drop on files or container to onPaneDrop, and directory drop to onEntryDrop', () => {
    const onEntryDrop = vi.fn();
    const onPaneDrop = vi.fn();

    render(
      <FileList
        entries={mockEntries}
        loading={false}
        selectedPaths={new Set()}
        onSelectionChange={vi.fn()}
        onOpen={vi.fn()}
        isDropTarget={(entry) => entry.isDirectory}
        onEntryDrop={onEntryDrop}
        onPaneDrop={onPaneDrop}
      />
    );

    const docRow = screen.getByText('documents').closest('[role="row"]')!;
    const fileRow = screen.getByText('config.json').closest('[role="row"]')!;

    // Dropping on folder calls onEntryDrop
    fireEvent.drop(docRow, { dataTransfer: {} });
    expect(onEntryDrop).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'documents' }),
      expect.anything()
    );

    // Dropping on file calls onPaneDrop
    fireEvent.drop(fileRow, { dataTransfer: {} });
    expect(onPaneDrop).toHaveBeenCalled();
  });
});
