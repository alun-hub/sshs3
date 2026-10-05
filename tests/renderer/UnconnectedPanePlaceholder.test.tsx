// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { UnconnectedPanePlaceholder } from '../../src/renderer/src/components/UnconnectedPanePlaceholder';

describe('UnconnectedPanePlaceholder Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders "No connection selected for this tab" on sole pane', () => {
    render(
      <UnconnectedPanePlaceholder
        leafId="leaf-1"
        isSole={true}
        isActive={true}
        platform="linux"
        onChangeConnection={vi.fn()}
        onOpenLocalTerminal={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    expect(screen.getByText('No connection selected for this tab')).toBeInTheDocument();
    expect(screen.getByTestId('select-ssh-connection-btn')).toBeInTheDocument();
    expect(screen.getByTestId('open-local-terminal-btn')).toBeInTheDocument();
  });

  it('auto-focuses the primary Select SSH Connection button when active', () => {
    render(
      <UnconnectedPanePlaceholder
        leafId="leaf-1"
        isSole={true}
        isActive={true}
        platform="linux"
        onChangeConnection={vi.fn()}
        onOpenLocalTerminal={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const selectBtn = screen.getByTestId('select-ssh-connection-btn');
    expect(document.activeElement).toBe(selectBtn);
  });

  it('calls onNavigateToTabBar on Escape when isSole is true', () => {
    const onNavigateToTabBar = vi.fn();
    const { container } = render(
      <UnconnectedPanePlaceholder
        leafId="leaf-1"
        isSole={true}
        isActive={true}
        platform="linux"
        onChangeConnection={vi.fn()}
        onOpenLocalTerminal={vi.fn()}
        onNavigateToTabBar={onNavigateToTabBar}
      />
    );

    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'Escape' });
    expect(onNavigateToTabBar).toHaveBeenCalledTimes(1);
  });

  it('calls onNavigateToTabBar on ArrowUp when the primary button is focused', () => {
    const onNavigateToTabBar = vi.fn();
    const { container } = render(
      <UnconnectedPanePlaceholder
        leafId="leaf-1"
        isSole={true}
        isActive={true}
        platform="linux"
        onChangeConnection={vi.fn()}
        onOpenLocalTerminal={vi.fn()}
        onNavigateToTabBar={onNavigateToTabBar}
      />
    );

    const selectBtn = screen.getByTestId('select-ssh-connection-btn');
    selectBtn.focus();

    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'ArrowUp' });
    expect(onNavigateToTabBar).toHaveBeenCalledTimes(1);
  });

  it('triggers onChangeConnection when Select SSH Connection is clicked', () => {
    const onChangeConnection = vi.fn();
    render(
      <UnconnectedPanePlaceholder
        leafId="leaf-1"
        isSole={true}
        isActive={true}
        platform="linux"
        onChangeConnection={onChangeConnection}
        onOpenLocalTerminal={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('select-ssh-connection-btn'));
    expect(onChangeConnection).toHaveBeenCalledWith('leaf-1');
  });

  it('triggers onOpenLocalTerminal when Open Local Terminal is clicked', () => {
    const onOpenLocalTerminal = vi.fn();
    render(
      <UnconnectedPanePlaceholder
        leafId="leaf-1"
        isSole={true}
        isActive={true}
        platform="linux"
        onChangeConnection={vi.fn()}
        onOpenLocalTerminal={onOpenLocalTerminal}
        onNavigateToTabBar={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('open-local-terminal-btn'));
    expect(onOpenLocalTerminal).toHaveBeenCalledWith('leaf-1', undefined, undefined);
  });
});
