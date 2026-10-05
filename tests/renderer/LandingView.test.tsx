// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LandingView } from '../../src/renderer/src/components/LandingView';
import type { SSHConnectionConfig } from '@shared/types/ssh';

describe('LandingView Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const mockRecentSSH: SSHConnectionConfig[] = [
    {
      id: 'conn-1',
      name: 'gnarg-yubi-pkcs11',
      host: 'gnarg',
      port: 22,
      username: 'alun',
      authType: 'smartcard',
    },
    {
      id: 'conn-2',
      name: 'demoserver',
      host: '206.168.215.216',
      port: 22,
      username: 'root',
      authType: 'password',
    },
  ];

  it('renders recent connections and action buttons', () => {
    render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    expect(screen.getByText('Recent Connections')).toBeInTheDocument();
    expect(screen.getByText('gnarg-yubi-pkcs11')).toBeInTheDocument();
    expect(screen.getByText('demoserver')).toBeInTheDocument();
    expect(screen.getByTestId('landing-new-terminal-btn')).toBeInTheDocument();
    expect(screen.getByTestId('landing-file-manager-btn')).toBeInTheDocument();
  });

  it('auto-focuses the first button after mount', () => {
    render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const firstConnectBtn = screen.getByTestId('recent-connect-conn-1');
    expect(document.activeElement).toBe(firstConnectBtn);
  });

  it('navigates with ArrowDown and ArrowUp between buttons', () => {
    const onNavigateToTabBar = vi.fn();
    const { container } = render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={onNavigateToTabBar}
      />
    );

    const firstConnectBtn = screen.getByTestId('recent-connect-conn-1');
    firstConnectBtn.focus();

    // ArrowUp on the very first element jumps up to TabBar
    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'ArrowUp' });
    expect(onNavigateToTabBar).toHaveBeenCalledTimes(1);
  });

  it('calls onNavigateToTabBar when Escape is pressed', () => {
    const onNavigateToTabBar = vi.fn();
    const { container } = render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={onNavigateToTabBar}
      />
    );

    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'Escape' });
    expect(onNavigateToTabBar).toHaveBeenCalledTimes(1);
  });

  it('triggers onConnectRecentSSH when Connect is clicked', () => {
    const onConnectRecentSSH = vi.fn();
    render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={onConnectRecentSSH}
        onConnectSFTP={vi.fn()}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('recent-connect-conn-1'));
    expect(onConnectRecentSSH).toHaveBeenCalledWith(mockRecentSSH[0]);
  });
});
