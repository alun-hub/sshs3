// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SearchModal } from '../../src/renderer/src/components/FileManager/SearchModal';

describe('SearchModal Component', () => {
  let searchErrorCb: ((event: any) => void) | null = null;

  beforeEach(() => {
    searchErrorCb = null;

    window.multissh = {
      searchStart: vi.fn().mockResolvedValue({ searchId: 'search-1' }),
      searchCancel: vi.fn().mockResolvedValue(undefined),
      searchPreview: vi.fn().mockResolvedValue({ content: 'test content\nline 2', startLine: 1 }),
      onSearchResult: vi.fn(() => () => {}),
      onSearchProgress: vi.fn(() => () => {}),
      onSearchError: vi.fn((cb) => {
        searchErrorCb = cb;
        return () => {};
      }),
      onSearchDone: vi.fn(() => () => {}),
    } as unknown as typeof window.multissh;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders modal with search header and input', () => {
    render(
      <SearchModal
        open={true}
        providerId="local"
        sourceType="local"
        rootPath="/tmp"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Search in Files/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search inside files...')).toBeInTheDocument();
  });

  it('toggles maximize and restore view', () => {
    render(
      <SearchModal
        open={true}
        providerId="local"
        sourceType="local"
        rootPath="/tmp"
        onClose={vi.fn()}
      />
    );

    const maxBtn = screen.getByTitle('Maximize');
    expect(maxBtn).toBeInTheDocument();

    fireEvent.click(maxBtn);
    expect(screen.getByTitle('Restore size')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Restore size'));
    expect(screen.getByTitle('Maximize')).toBeInTheDocument();
  });

  it('allows clearing search query via clear button', () => {
    render(
      <SearchModal
        open={true}
        providerId="local"
        sourceType="local"
        rootPath="/tmp"
        onClose={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search inside files...');
    fireEvent.change(input, { target: { value: 'some query' } });
    expect(input).toHaveValue('some query');

    const clearBtn = screen.getByTitle('Clear search query');
    expect(clearBtn).toBeInTheDocument();
    fireEvent.click(clearBtn);

    expect(input).toHaveValue('');
  });

  it('renders non-fatal search warnings without truncating and allows expand, copy, dismiss', async () => {
    render(
      <SearchModal
        open={true}
        providerId="local"
        sourceType="local"
        rootPath="/tmp"
        onClose={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search inside files...');
    fireEvent.change(input, { target: { value: 'root' } });
    const searchBtn = screen.getByRole('button', { name: 'Search' });

    await act(async () => {
      fireEvent.click(searchBtn);
    });

    // Simulate warning event
    act(() => {
      searchErrorCb?.({
        searchId: 'search-1',
        fatal: false,
        path: '/tmp/systemd-private-1234',
        message: 'Permission denied',
      });
    });

    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();

    // Toggle expand
    const warningToggle = screen.getByText(/1 warning/i);
    fireEvent.click(warningToggle);

    // Full message is visible and readable
    expect(screen.getByText('/tmp/systemd-private-1234:')).toBeInTheDocument();
    expect(screen.getByText('Permission denied')).toBeInTheDocument();

    // Copy warnings
    const copyBtn = screen.getByTitle('Copy all warnings to clipboard');
    expect(copyBtn).toBeInTheDocument();

    // Dismiss warnings
    const dismissBtn = screen.getByTitle('Dismiss warning bar');
    fireEvent.click(dismissBtn);

    expect(screen.queryByText(/1 warning/i)).not.toBeInTheDocument();
  });

  it('renders a draggable separator divider with resize capability', () => {
    render(
      <SearchModal
        open={true}
        providerId="local"
        sourceType="local"
        rootPath="/tmp"
        onClose={vi.fn()}
      />
    );

    const separator = screen.getByRole('separator');
    expect(separator).toBeInTheDocument();
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');

    // Trigger mouse down on separator
    fireEvent.mouseDown(separator);
    // Mouse move on window
    fireEvent.mouseMove(window, { clientX: 500 });
    fireEvent.mouseUp(window);
  });
});
