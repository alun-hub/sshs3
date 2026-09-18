// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FileEditorModal } from '../../src/renderer/src/components/FileManager/FileEditorModal';
import type { FileEntry } from '../../src/shared/types/storage';

describe('FileEditorModal', () => {
  const mockFileRead = vi.fn();
  const mockFileSave = vi.fn();
  const mockFileOpenExternal = vi.fn();
  const mockFileCloseExternal = vi.fn();
  const mockOnExternalFileStatus = vi.fn().mockReturnValue(() => {});

  const sampleEntry: FileEntry = {
    name: 'config.json',
    path: '/etc/app/config.json',
    size: 256,
    isDirectory: false,
    mtime: '2026-09-18 08:00',
  };

  beforeEach(() => {
    mockFileRead.mockResolvedValue({
      content: '{\n  "port": 8080,\n  "host": "localhost"\n}',
      size: 45,
      isBinary: false,
      truncated: false,
    });
    mockFileSave.mockResolvedValue(undefined);
    mockFileOpenExternal.mockResolvedValue({ sessionToken: 'ext-tok-1', localPath: '/tmp/config.json' });
    mockFileCloseExternal.mockResolvedValue(undefined);

    window.multissh = {
      ...(window.multissh || {}),
      fileRead: mockFileRead,
      fileSave: mockFileSave,
      fileOpenExternal: mockFileOpenExternal,
      fileCloseExternal: mockFileCloseExternal,
      onExternalFileStatus: mockOnExternalFileStatus,
    } as any;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not render when open is false or entry is null', () => {
    const { container: c1 } = render(
      <FileEditorModal
        open={false}
        providerId="sftp-1"
        sourceType="sftp"
        entry={sampleEntry}
        onClose={vi.fn()}
      />
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={null}
        onClose={vi.fn()}
      />
    );
    expect(c2.firstChild).toBeNull();
  });

  it('loads file content and displays file details in header and textarea', async () => {
    render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={sampleEntry}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('config.json')).toBeInTheDocument();
    expect(screen.getByText('sftp')).toBeInTheDocument();
    expect(screen.getByText('/etc/app/config.json')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFileRead).toHaveBeenCalledWith('sftp-1', '/etc/app/config.json');
      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveValue('{\n  "port": 8080,\n  "host": "localhost"\n}');
    });

    // Check statusbar line count
    expect(screen.getByText('4 lines')).toBeInTheDocument();
  });

  it('detects changes, marks dirty state, and allows saving', async () => {
    const onSaved = vi.fn();
    render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={sampleEntry}
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('{\n  "port": 8080,\n  "host": "localhost"\n}');
    });

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '{\n  "port": 9000\n}' } });

    // Should indicate unsaved changes
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Save button should be enabled
    const saveButton = screen.getByRole('button', { name: /Save/i });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockFileSave).toHaveBeenCalledWith('sftp-1', '/etc/app/config.json', '{\n  "port": 9000\n}');
      expect(onSaved).toHaveBeenCalled();
      expect(screen.getAllByText(/Saved/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays binary file warning when isBinary is true', async () => {
    mockFileRead.mockResolvedValueOnce({
      content: '',
      size: 1024,
      isBinary: true,
      truncated: false,
    });

    render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={{ ...sampleEntry, name: 'binary.exe' }}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Binary file detected/i)).toBeInTheDocument();
      expect(screen.getByText('Read-Only')).toBeInTheDocument();
    });
  });

  it('toggles search bar and matches query within content', async () => {
    render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={sampleEntry}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('{\n  "port": 8080,\n  "host": "localhost"\n}');
    });

    // Toggle search
    const searchBtn = screen.getByTitle('Search (Ctrl+F)');
    fireEvent.click(searchBtn);

    const searchInput = screen.getByPlaceholderText(/Find in file/i);
    expect(searchInput).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'port' } });
    expect(screen.getByText('1 of 1')).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('toggles read-only and word-wrap states', async () => {
    render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={sampleEntry}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('wrap', 'soft');

    // Toggle wrap
    const wrapBtn = screen.getByTitle('Disable Word Wrap');
    fireEvent.click(wrapBtn);
    expect(textarea).toHaveAttribute('wrap', 'off');

    // Toggle read-only
    const lockBtn = screen.getByTitle('Switch to Read-Only Mode');
    fireEvent.click(lockBtn);
    expect(textarea).toHaveAttribute('readonly');
    expect(screen.getByText('Read-Only')).toBeInTheDocument();
  });

  it('launches external editor when External Editor button is clicked', async () => {
    render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={sampleEntry}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    const extBtn = screen.getByRole('button', { name: /External Editor/i });
    fireEvent.click(extBtn);

    await waitFor(() => {
      expect(mockFileOpenExternal).toHaveBeenCalledWith('sftp-1', '/etc/app/config.json');
      expect(screen.getByText(/External editor active/i)).toBeInTheDocument();
    });
  });

  it('confirms discard if user closes with unsaved changes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const onClose = vi.fn();

    render(
      <FileEditorModal
        open={true}
        providerId="sftp-1"
        sourceType="sftp"
        entry={sampleEntry}
        onClose={onClose}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    // Make change
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'dirty change' } });

    // Close button
    const closeBtn = screen.getByTitle('Close editor (Esc)');

    // User cancels confirm
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(closeBtn);
    expect(confirmSpy).toHaveBeenCalledWith('You have unsaved changes. Discard them?');
    expect(onClose).not.toHaveBeenCalled();

    // User accepts confirm
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
