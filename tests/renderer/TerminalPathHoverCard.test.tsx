// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TerminalPathHoverCard } from '../../src/renderer/src/components/TerminalPathHoverCard';

describe('TerminalPathHoverCard', () => {
  it('renders file details with correct category badge', () => {
    render(
      <TerminalPathHoverCard
        path="/etc/nginx/nginx.conf"
        x={100}
        y={100}
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
      />
    );

    expect(screen.getByText('nginx.conf')).toBeInTheDocument();
    expect(screen.getByText('/etc/nginx/nginx.conf')).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('triggers onCopyPath when copy button is clicked', () => {
    const onCopyPath = vi.fn();
    render(
      <TerminalPathHoverCard
        path="/var/log/app.log"
        x={50}
        y={50}
        onClose={vi.fn()}
        onCopyPath={onCopyPath}
      />
    );

    const copyBtn = screen.getByRole('button', { name: /copy path/i });
    fireEvent.click(copyBtn);
    expect(onCopyPath).toHaveBeenCalledWith('/var/log/app.log');
  });

  it('shows Edit button for files and calls onOpenEditor', () => {
    const onOpenEditor = vi.fn();
    render(
      <TerminalPathHoverCard
        path="/app/server.ts"
        x={50}
        y={50}
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
        onOpenEditor={onOpenEditor}
      />
    );

    const editBtn = screen.getByRole('button', { name: /edit/i });
    fireEvent.click(editBtn);
    expect(onOpenEditor).toHaveBeenCalledWith('/app/server.ts');
  });

  it('shows Browse button for directories instead of Edit', () => {
    const onOpenPath = vi.fn();
    const onOpenEditor = vi.fn();
    render(
      <TerminalPathHoverCard
        path="/var/log/"
        x={50}
        y={50}
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
        onOpenPath={onOpenPath}
        onOpenEditor={onOpenEditor}
      />
    );

    expect(screen.getByText('Browse')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    expect(onOpenPath).toHaveBeenCalledWith('/var/log/');
  });

  it('resolves relative file paths against currentCwd when provided', () => {
    render(
      <TerminalPathHoverCard
        path="nginx.conf"
        currentCwd="/etc/nginx"
        userHome="/home/alun"
        x={50}
        y={50}
        onClose={vi.fn()}
        onCopyPath={vi.fn()}
      />
    );

    expect(screen.getByText('nginx.conf')).toBeInTheDocument();
    expect(screen.getByText('/etc/nginx/nginx.conf')).toBeInTheDocument();
  });
});
