// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DotfilePoolManagerModal } from '../../src/renderer/src/components/SettingsModal/DotfilePoolManagerModal';
import type { DotfilePool } from '../../src/shared/types/dotfiles';

describe('DotfilePoolManagerModal Component', () => {
  const mockPools: DotfilePool[] = [
    {
      id: 'p1',
      name: 'Linux Servers',
      files: [
        {
          id: 'f1',
          remotePath: '~/.bashrc',
          content: 'export EDITOR=vim',
          mode: '644',
          masterFileName: '.bashrc',
          updatedAt: '2026-09-17 19:40',
        },
      ],
      masterDirectory: '/home/user/.sshs3/dotfiles/p1',
      updatedAt: '2026-09-17 19:40',
    },
  ];

  beforeEach(() => {
    window.multissh = {
      dotfilePoolsGet: vi.fn().mockResolvedValue(mockPools),
      dotfilePoolsSave: vi.fn().mockResolvedValue(undefined),
      dotfilePoolsDelete: vi.fn().mockResolvedValue(undefined),
      dotfilePoolOpenFolder: vi.fn().mockResolvedValue(''),
      dotfilePoolSelectFiles: vi.fn().mockResolvedValue([
        {
          name: '.zshrc',
          path: '/home/user/.zshrc',
          content: 'export ZSH=1',
          mode: '644',
        },
      ]),
    } as unknown as typeof window.multissh;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(<DotfilePoolManagerModal open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('loads and displays pools with master file details', async () => {
    render(<DotfilePoolManagerModal open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Linux Servers')).toBeInTheDocument();
    });

    // Select the pool
    fireEvent.click(screen.getByText('Linux Servers'));

    expect(screen.getByDisplayValue('Linux Servers')).toBeInTheDocument();
    expect(screen.getByText(/Master file: \.bashrc/)).toBeInTheDocument();
    expect(screen.getByText(/Last saved: 2026-09-17 19:40/)).toBeInTheDocument();
    expect(screen.getByText('Open Master Directory')).toBeInTheDocument();
  });

  it('triggers file upload and adds imported file to draft pool', async () => {
    render(<DotfilePoolManagerModal open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Linux Servers')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Linux Servers'));

    const uploadBtn = screen.getByTitle('Select and upload existing files from your computer as master files');
    fireEvent.click(uploadBtn);

    await waitFor(() => {
      expect(window.multissh.dotfilePoolSelectFiles).toHaveBeenCalled();
      expect(screen.getByDisplayValue('~/.zshrc')).toBeInTheDocument();
    });
  });

  it('opens master directory on disk when clicking open folder button', async () => {
    render(<DotfilePoolManagerModal open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Linux Servers')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Linux Servers'));

    const openFolderBtn = screen.getByText('Open Master Directory');
    fireEvent.click(openFolderBtn);

    expect(window.multissh.dotfilePoolOpenFolder).toHaveBeenCalledWith('p1');
  });

  it('saves master files and pool changes', async () => {
    render(<DotfilePoolManagerModal open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Linux Servers')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Linux Servers'));

    const saveBtn = screen.getByText('Save Master Files');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(window.multissh.dotfilePoolsSave).toHaveBeenCalled();
    });
  });
});
