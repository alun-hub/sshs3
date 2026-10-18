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

  describe('searching saved profiles from the quick-connect box', () => {
    const allSSH: SSHConnectionConfig[] = [
      ...mockRecentSSH,
      { id: 'conn-3', name: 'build-box', host: 'ci.example.com', port: 22, username: 'deploy', authType: 'password' },
    ];

    const renderLanding = (overrides: Partial<React.ComponentProps<typeof LandingView>> = {}) =>
      render(
        <LandingView
          recentSSH={mockRecentSSH}
          allSSH={allSSH}
          onConnectRecentSSH={vi.fn()}
          onConnectSFTP={vi.fn()}
          onQuickConnectSSH={vi.fn()}
          onQuickStartTerminal={vi.fn()}
          onNewTab={vi.fn()}
          onOpenProfiles={vi.fn()}
          onNewProfile={vi.fn()}
          onOpenSyncBootstrap={vi.fn()}
          onNavigateToTabBar={vi.fn()}
          {...overrides}
        />
      );

    const type = (text: string) =>
      fireEvent.change(screen.getByPlaceholderText(/search saved profiles/i), { target: { value: text } });

    it('lists profiles outside the recent ones that match what is typed', () => {
      renderLanding();
      type('build');
      expect(screen.getByText('Matching Profiles')).toBeInTheDocument();
      expect(screen.getByText('build-box')).toBeInTheDocument();
      expect(screen.queryByText('demoserver')).not.toBeInTheDocument();
    });

    it('matches on host and user too, and says so when nothing matches', () => {
      renderLanding();
      type('ci.example');
      expect(screen.getByText('build-box')).toBeInTheDocument();
      type('zzz-nothing');
      expect(screen.getByText(/No saved profile matches/)).toBeInTheDocument();
    });

    it('connects to the first match on submit', () => {
      const onConnectRecentSSH = vi.fn();
      const onQuickConnectSSH = vi.fn();
      renderLanding({ onConnectRecentSSH, onQuickConnectSSH });
      type('build');
      fireEvent.click(screen.getByTestId('quick-connect-btn'));
      expect(onConnectRecentSSH).toHaveBeenCalledWith(expect.objectContaining({ id: 'conn-3' }));
      expect(onQuickConnectSSH).not.toHaveBeenCalled();
    });

    it('keeps user@host as an ad-hoc connection', () => {
      const onConnectRecentSSH = vi.fn();
      const onQuickConnectSSH = vi.fn();
      renderLanding({ onConnectRecentSSH, onQuickConnectSSH });
      type('deploy@ci.example.com');
      fireEvent.click(screen.getByTestId('quick-connect-btn'));
      expect(onQuickConnectSSH).toHaveBeenCalledWith(expect.objectContaining({ host: 'ci.example.com', username: 'deploy' }));
      expect(onConnectRecentSSH).not.toHaveBeenCalled();
    });

    it('greys out SFTP together with Connect while there is nothing to open', () => {
      renderLanding();
      const sftp = () => screen.getAllByRole('button', { name: /SFTP/ })[0];
      expect(screen.getByTestId('quick-connect-btn')).toBeDisabled();
      expect(sftp()).toBeDisabled();
      type('build');
      expect(screen.getByTestId('quick-connect-btn')).toBeEnabled();
      expect(sftp()).toBeEnabled();
    });

    it('shows recent connections again when the box is cleared', () => {
      renderLanding();
      type('build');
      type('');
      expect(screen.getByText('Recent Connections')).toBeInTheDocument();
    });
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
