// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TransferConflictModal } from '../../src/renderer/src/components/TransferConflictModal';
import type { TransferConflictPromptEvent } from '../../src/shared/types/ipc';

describe('TransferConflictModal Component', () => {
  let promptCallback: ((event: TransferConflictPromptEvent) => void) | null = null;
  const mockUnsubscribe = vi.fn();
  const mockRespond = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    promptCallback = null;
    mockUnsubscribe.mockClear();
    mockRespond.mockClear();

    window.multissh = {
      ...(window.multissh || {}),
      onTransferConflictPrompt: vi.fn((cb) => {
        promptCallback = cb;
        return mockUnsubscribe;
      }),
      respondTransferConflict: mockRespond,
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when there is no active prompt', () => {
    render(<TransferConflictModal />);
    expect(screen.queryByTestId('transfer-conflict-modal')).not.toBeInTheDocument();
  });

  it('shows the conflicting file name and target path', () => {
    render(<TransferConflictModal />);

    act(() => {
      promptCallback!({
        id: 'tc-1',
        sourcePath: '/src/report.pdf',
        targetPath: '/dst/report.pdf',
        fileName: 'report.pdf',
        isDirectory: false,
      });
    });

    expect(screen.getByTestId('transfer-conflict-modal')).toBeInTheDocument();
    expect(screen.getByText('/dst/report.pdf')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('overwrite button responds with resolution="overwrite" and the checkbox state', () => {
    render(<TransferConflictModal />);

    act(() => {
      promptCallback!({
        id: 'tc-2',
        sourcePath: '/src/a.txt',
        targetPath: '/dst/a.txt',
        fileName: 'a.txt',
        isDirectory: false,
      });
    });

    fireEvent.click(screen.getByTestId('transfer-conflict-apply-all'));
    fireEvent.click(screen.getByTestId('transfer-conflict-overwrite'));

    expect(mockRespond).toHaveBeenCalledWith('tc-2', 'overwrite', true);
    expect(screen.queryByTestId('transfer-conflict-modal')).not.toBeInTheDocument();
  });

  it('skip and rename buttons respond with the matching resolution', () => {
    render(<TransferConflictModal />);

    act(() => {
      promptCallback!({
        id: 'tc-3',
        sourcePath: '/src/b.txt',
        targetPath: '/dst/b.txt',
        fileName: 'b.txt',
        isDirectory: false,
      });
    });
    fireEvent.click(screen.getByTestId('transfer-conflict-skip'));
    expect(mockRespond).toHaveBeenCalledWith('tc-3', 'skip', false);

    act(() => {
      promptCallback!({
        id: 'tc-4',
        sourcePath: '/src/c.txt',
        targetPath: '/dst/c.txt',
        fileName: 'c.txt',
        isDirectory: false,
      });
    });
    fireEvent.click(screen.getByTestId('transfer-conflict-rename'));
    expect(mockRespond).toHaveBeenCalledWith('tc-4', 'rename', false);
  });

  it('Escape key responds with "skip"', () => {
    render(<TransferConflictModal />);

    act(() => {
      promptCallback!({
        id: 'tc-5',
        sourcePath: '/src/d.txt',
        targetPath: '/dst/d.txt',
        fileName: 'd.txt',
        isDirectory: false,
      });
    });

    fireEvent.keyDown(screen.getByTestId('transfer-conflict-modal'), { key: 'Escape', code: 'Escape' });
    expect(mockRespond).toHaveBeenCalledWith('tc-5', 'skip', false);
  });

  it('resets the "apply to all" checkbox between prompts', () => {
    render(<TransferConflictModal />);

    act(() => {
      promptCallback!({
        id: 'tc-6',
        sourcePath: '/src/e.txt',
        targetPath: '/dst/e.txt',
        fileName: 'e.txt',
        isDirectory: false,
      });
    });
    fireEvent.click(screen.getByTestId('transfer-conflict-apply-all'));
    expect(screen.getByTestId('transfer-conflict-apply-all')).toBeChecked();

    fireEvent.click(screen.getByTestId('transfer-conflict-skip'));

    act(() => {
      promptCallback!({
        id: 'tc-7',
        sourcePath: '/src/f.txt',
        targetPath: '/dst/f.txt',
        fileName: 'f.txt',
        isDirectory: false,
      });
    });
    expect(screen.getByTestId('transfer-conflict-apply-all')).not.toBeChecked();
  });

  it('cleans up the transfer conflict listener on unmount', () => {
    const { unmount } = render(<TransferConflictModal />);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('deduplicates duplicate conflict prompts so a single overwrite click dismisses the modal', () => {
    render(<TransferConflictModal />);

    // Simulate duplicate prompts arriving for the same conflict (e.g. from bubbled drop event)
    act(() => {
      promptCallback!({
        id: 'tc-dup-1',
        sourcePath: '/src/file.txt',
        targetPath: '/dst/file.txt',
        fileName: 'file.txt',
        isDirectory: false,
      });
      promptCallback!({
        id: 'tc-dup-2',
        sourcePath: '/src/file.txt',
        targetPath: '/dst/file.txt',
        fileName: 'file.txt',
        isDirectory: false,
      });
    });

    expect(screen.getByTestId('transfer-conflict-modal')).toBeInTheDocument();

    // Clicking overwrite should dismiss the modal on first click without leaving a ghost prompt
    fireEvent.click(screen.getByTestId('transfer-conflict-overwrite'));
    expect(mockRespond).toHaveBeenCalledWith('tc-dup-1', 'overwrite', false);
    expect(screen.queryByTestId('transfer-conflict-modal')).not.toBeInTheDocument();
  });
});
