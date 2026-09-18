// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AddToDotfilePoolModal } from '../../src/renderer/src/components/FileManager/AddToDotfilePoolModal';
import type { FileEntry } from '../../src/shared/types/storage';

describe('AddToDotfilePoolModal Component', () => {
  const mockEntry: FileEntry = {
    name: '.bashrc',
    path: '/home/user/.bashrc',
    size: 1024,
    isDirectory: false,
    permissions: '644',
  };

  beforeEach(() => {
    window.multissh = {
      dotfilePoolsGet: vi.fn().mockResolvedValue([
        {
          id: 'p1',
          name: 'Main Pool',
          files: [],
        },
      ]),
      dotfilePoolsSave: vi.fn().mockResolvedValue(undefined),
      dotfilePoolAddFromStorage: vi.fn().mockResolvedValue({
        id: 'p1',
        name: 'Main Pool',
        files: [],
      }),
    } as unknown as typeof window.multissh;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders modal with pre-populated remote path and pool selection', async () => {
    render(
      <AddToDotfilePoolModal
        open={true}
        onClose={vi.fn()}
        sourceProviderId="sftp-1"
        entry={mockEntry}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Add to Dotfiles Pool')).toBeInTheDocument();
      expect(screen.getByDisplayValue('~/.bashrc')).toBeInTheDocument();
      expect(screen.getByText(/Main Pool/)).toBeInTheDocument();
    });
  });

  it('saves file as master file in selected pool', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <AddToDotfilePoolModal
        open={true}
        onClose={onClose}
        sourceProviderId="sftp-1"
        entry={mockEntry}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Save as Master File')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save as Master File'));

    await waitFor(() => {
      expect(window.multissh.dotfilePoolAddFromStorage).toHaveBeenCalledWith({
        poolId: 'p1',
        providerId: 'sftp-1',
        filePath: '/home/user/.bashrc',
        targetRemotePath: '~/.bashrc',
      });
      expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining('Saved .bashrc as a master file'));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
