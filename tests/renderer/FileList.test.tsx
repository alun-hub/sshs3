// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('1 av 4')).toBeInTheDocument();
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

    expect(screen.getByText('Inga filer matchar "nonexistent"')).toBeInTheDocument();
  });
});
