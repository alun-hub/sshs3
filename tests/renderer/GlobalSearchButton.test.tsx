// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { GlobalSearchButton } from '../../src/renderer/src/components/GlobalSearchButton';

afterEach(cleanup);

describe('GlobalSearchButton', () => {
  it('opens the search when clicked', () => {
    const onOpen = vi.fn();
    render(<GlobalSearchButton onOpen={onOpen} shortcuts={undefined} />);
    fireEvent.click(screen.getByTestId('global-search-btn'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('is named for assistive technology and shows the default shortcut in its tooltip', () => {
    render(<GlobalSearchButton onOpen={vi.fn()} shortcuts={undefined} />);
    const button = screen.getByRole('button', { name: 'Search profiles, tabs and hosts' });
    expect(button).toHaveAttribute('title', 'Search profiles, tabs and hosts (Ctrl+Shift+G)');
  });

  it('shows the shortcut the user has chosen', () => {
    render(<GlobalSearchButton onOpen={vi.fn()} shortcuts={{ globalSearch: 'Ctrl+Alt+P' }} />);
    expect(screen.getByTestId('global-search-btn')).toHaveAttribute('title', expect.stringContaining('Ctrl+Alt+P'));
    expect(screen.getByText('Ctrl+Alt+P')).toBeInTheDocument();
  });

  it('has a short label that always fits, and says what it searches in the tooltip instead', () => {
    render(<GlobalSearchButton onOpen={vi.fn()} shortcuts={undefined} />);
    const button = screen.getByTestId('global-search-btn');
    expect(button).toHaveTextContent(/^Search/);
    expect(button).not.toHaveTextContent('Search profiles and tabs');
    expect(button).toHaveAttribute('title', expect.stringContaining('profiles, tabs and hosts'));
  });

  it('keeps the shortcut visible longer than the label as the window narrows', () => {
    render(<GlobalSearchButton onOpen={vi.fn()} shortcuts={undefined} />);
    const button = screen.getByTestId('global-search-btn');
    expect(screen.getByText('Search')).toHaveClass('xl:inline');
    expect(screen.getByText('Ctrl+Shift+G')).toHaveClass('lg:inline-block');
    expect(button).toHaveClass('hover:border-sky-500');
  });
});
