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
        onQuickConnectSSH={vi.fn()}
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

  it('auto-focuses the quick-connect field after mount', () => {
    render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickConnectSSH={vi.fn()}
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

    expect(document.activeElement).toBe(screen.getByPlaceholderText(/Type user@host to connect/));
  });

  it('jumps to TabBar on ArrowUp from anywhere in the quick-connect row (the first row)', () => {
    const onNavigateToTabBar = vi.fn();
    const { container } = render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickConnectSSH={vi.fn()}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={onNavigateToTabBar}
      />
    );

    const quickConnectInput = screen.getByPlaceholderText(/Type user@host to connect/);
    quickConnectInput.focus();
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
        onQuickConnectSSH={vi.fn()}
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
        onQuickConnectSSH={vi.fn()}
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

  it('connects via the quick-connect field for a typed user@host, without saving it as a profile', () => {
    const onQuickConnectSSH = vi.fn();
    render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickConnectSSH={onQuickConnectSSH}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText(/Type user@host to connect/);
    fireEvent.change(input, { target: { value: 'deploy@staging.example.com' } });
    fireEvent.click(screen.getByTestId('quick-connect-btn'));

    expect(onQuickConnectSSH).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'staging.example.com', username: 'deploy', authType: 'password' })
    );
    expect(input).toHaveValue('');
  });

  it('disables the quick-connect Connect button until the typed value looks like user@host', () => {
    render(
      <LandingView
        recentSSH={mockRecentSSH}
        onConnectRecentSSH={vi.fn()}
        onConnectSFTP={vi.fn()}
        onQuickConnectSSH={vi.fn()}
        onQuickStartTerminal={vi.fn()}
        onNewTab={vi.fn()}
        onOpenProfiles={vi.fn()}
        onNewProfile={vi.fn()}
        onOpenSyncBootstrap={vi.fn()}
        onNavigateToTabBar={vi.fn()}
      />
    );

    expect(screen.getByTestId('quick-connect-btn')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Type user@host to connect/), { target: { value: 'not a target' } });
    expect(screen.getByTestId('quick-connect-btn')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Type user@host to connect/), { target: { value: 'root@example.com' } });
    expect(screen.getByTestId('quick-connect-btn')).not.toBeDisabled();
  });
});
