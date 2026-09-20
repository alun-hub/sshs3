// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { App } from '../../src/renderer/src/App';

// Polyfill ResizeObserver and matchMedia for JSDOM
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('App Component', () => {
  let dataCallback: ((sessionId: string, data: string) => void) | null = null;

  beforeEach(() => {
    dataCallback = null;
    window.multissh = {
      ...(window.multissh || {}),
      terminalCreate: vi.fn().mockResolvedValue({ sessionId: 'app-term-1' }),
      terminalWrite: vi.fn().mockResolvedValue(undefined),
      terminalResize: vi.fn().mockResolvedValue(undefined),
      terminalKill: vi.fn().mockResolvedValue(undefined),
      onTerminalData: vi.fn((cb) => {
        dataCallback = cb;
        return vi.fn();
      }),
      onTerminalExit: vi.fn(() => vi.fn()),
      onAskpassPrompt: vi.fn(() => vi.fn()),
      submitAskpassPin: vi.fn().mockResolvedValue(undefined),
      connectStorage: vi.fn().mockResolvedValue({ id: 'local' }),
      storageList: vi.fn().mockResolvedValue([]),
      transferGetJobs: vi.fn().mockResolvedValue([]),
      onTransferProgress: vi.fn(() => vi.fn()),
      sessionGet: vi.fn().mockResolvedValue(null),
      sessionSave: vi.fn().mockResolvedValue(undefined),
      settingsGet: vi.fn().mockResolvedValue(undefined),
      settingsSave: vi.fn().mockResolvedValue(undefined),
      profilesGet: vi.fn().mockResolvedValue({ ssh: [], s3: [] }),
      profilesSaveSSH: vi.fn().mockResolvedValue(undefined),
      getHostname: vi.fn().mockResolvedValue('my-laptop'),
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders application header, initial terminal tab, and tab bar', async () => {
    render(<App />);

    expect(screen.getByText('sshs3')).toBeInTheDocument();
    expect(screen.getByTestId('add-tab-btn')).toBeInTheDocument();

    // Default terminal tab exists and is active
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('opens a new filemanager tab when selected from new tab menu', async () => {
    render(<App />);

    // Click "+" button
    fireEvent.click(screen.getByTestId('add-tab-btn'));

    // Click "Ny filhanterare"
    fireEvent.click(screen.getByTestId('new-filemanager-btn'));

    // Should now have 2 tabs
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);

    // The new tab should be selected
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('File Manager 1')).toBeInTheDocument();
  });

  it('maintains non-active tabs mounted in DOM with display none', async () => {
    render(<App />);

    // Add a filemanager tab
    fireEvent.click(screen.getByTestId('add-tab-btn'));
    fireEvent.click(screen.getByTestId('new-filemanager-btn'));

    const tabPanels = screen.getAllByTestId(/^tab-panel-/);
    expect(tabPanels.length).toBe(2);

    // Panel 0 (terminal) should be hidden, Panel 1 (filemanager) should be visible
    expect(tabPanels[0]).toHaveStyle({ display: 'none' });
    expect(tabPanels[1]).toHaveStyle({ display: 'flex' });

    // Switch back to tab 0
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[0]);

    // Now Panel 0 is visible and Panel 1 is hidden
    expect(tabPanels[0]).toHaveStyle({ display: 'flex' });
    expect(tabPanels[1]).toHaveStyle({ display: 'none' });
  });

  it('closes a tab and switches active tab when close button is clicked', async () => {
    render(<App />);

    // Add a second tab
    fireEvent.click(screen.getByTestId('add-tab-btn'));
    fireEvent.click(screen.getByTestId('new-terminal-btn'));

    let tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);

    // Close the second tab
    const closeButtons = screen.getAllByTestId(/^close-tab-/);
    fireEvent.click(closeButtons[1]);

    tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(1);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('opens settings modal when settings gear button is clicked', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('quick-settings-btn'));
    expect(await screen.findByText('Settings')).toBeInTheDocument();
  });

  it('restores saved tabs from session on mount', async () => {
    window.multissh.sessionGet = vi.fn().mockResolvedValue({
      tabs: [
        { id: 'saved-term', type: 'terminal', title: 'Saved Terminal' },
        { id: 'saved-fm', type: 'filemanager', title: 'Saved Explorer' },
      ],
      activeTabId: 'saved-fm',
    });

    render(<App />);

    await vi.waitFor(() => {
      expect(screen.getByText('Saved Terminal')).toBeInTheDocument();
      expect(screen.getByText('Saved Explorer')).toBeInTheDocument();
    });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('splits a pane without recreating the existing session, and lets you close a specific pane', async () => {
    render(<App />);

    // A fresh tab always has exactly one (root) pane.
    let panes = screen.getAllByTestId(/^terminal-pane-/);
    expect(panes.length).toBe(1);
    const rootPaneId = panes[0].getAttribute('data-testid')!.replace('terminal-pane-', '');

    // Splitting must never call terminalKill for the existing pane's session (it must survive).
    (window.multissh.terminalCreate as any).mockClear();
    (window.multissh.terminalKill as any).mockClear();

    fireEvent.click(screen.getByTestId(`split-row-${rootPaneId}`));

    panes = screen.getAllByTestId(/^terminal-pane-/);
    expect(panes.length).toBe(2);
    // The original pane keeps its id and DOM node (no unmount/remount of the existing terminal).
    expect(screen.getByTestId(`terminal-pane-${rootPaneId}`)).toBeInTheDocument();
    expect(window.multissh.terminalKill).not.toHaveBeenCalled();

    // Close the *other* pane (not the original) — original must remain, its own session untouched.
    const otherPaneId = panes
      .map((p) => p.getAttribute('data-testid')!.replace('terminal-pane-', ''))
      .find((id) => id !== rootPaneId)!;
    fireEvent.click(screen.getByTestId(`close-pane-${otherPaneId}`));

    panes = screen.getAllByTestId(/^terminal-pane-/);
    expect(panes.length).toBe(1);
    expect(screen.getByTestId(`terminal-pane-${rootPaneId}`)).toBeInTheDocument();
  });

  it('handles keyboard shortcuts for new terminal, split vertical, and close tab', async () => {
    render(<App />);

    expect(screen.getAllByRole('tab').length).toBe(1);

    // Trigger Ctrl+Shift+T to open new terminal tab
    fireEvent.keyDown(window, {
      key: 'T',
      ctrlKey: true,
      shiftKey: true,
    });

    // Should have 2 tabs now
    expect(screen.getAllByRole('tab').length).toBe(2);

    // Trigger Ctrl+Shift+D to split vertical on active tab
    fireEvent.keyDown(window, {
      key: 'D',
      ctrlKey: true,
      shiftKey: true,
    });

    // 1 pane in the first (now hidden) tab + 2 panes in the newly-split active tab
    expect(screen.getAllByTestId(/^terminal-pane-/).length).toBe(3);

    // Trigger Ctrl+W to close active tab
    fireEvent.keyDown(window, {
      key: 'w',
      ctrlKey: true,
    });

    expect(screen.getAllByRole('tab').length).toBe(1);
  });

  it('reuses closed tab numbers instead of incrementing endlessly', async () => {
    render(<App />);

    expect(screen.getByText('Terminal 1')).toBeInTheDocument();

    // Create a new terminal tab -> should be Terminal 2
    fireEvent.click(screen.getByTestId('add-tab-btn'));
    fireEvent.click(screen.getByTestId('new-terminal-btn'));
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();

    // Close Terminal 2
    const closeBtns = screen.getAllByTestId(/^close-tab-/);
    fireEvent.click(closeBtns[closeBtns.length - 1]);
    expect(screen.queryByText('Terminal 2')).not.toBeInTheDocument();

    // Create another terminal tab -> should reuse number 2
    fireEvent.click(screen.getByTestId('add-tab-btn'));
    fireEvent.click(screen.getByTestId('new-terminal-btn'));
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
  });

  it('updates tab title from Terminal 1 to profile name when connecting an SSH profile in an empty tab', async () => {
    (window.multissh.profilesGet as any).mockResolvedValue({
      ssh: [
        {
          id: 'ssh-test-1',
          name: 'Production Server',
          host: 'prod.example.com',
          port: 22,
          username: 'admin',
          authType: 'password',
        },
      ],
      s3: [],
    });

    render(<App />);

    expect(within(screen.getByTestId('tab-term-1')).getByText('Terminal 1')).toBeInTheDocument();

    // Click "Select SSH Connection" in the empty pane
    fireEvent.click(screen.getByText('Select SSH Connection'));

    // Wait for the modal to finish loading profiles
    expect(await screen.findByText('Production Server')).toBeInTheDocument();

    // Click "Connect" on the profile row
    const connectBtn = screen.getByRole('button', { name: /^connect$/i });
    fireEvent.click(connectBtn);

    // The tab should now be renamed from Terminal 1 to the profile name!
    await vi.waitFor(() => {
      expect(within(screen.getByTestId('tab-term-1')).getByText('Production Server')).toBeInTheDocument();
    });
  });

  it('dynamically updates tab title when SSHing further to a new host and restores on exit', async () => {
    render(<App />);

    expect(within(screen.getByTestId('tab-term-1')).getByText('Terminal 1')).toBeInTheDocument();

    // Open local terminal in the tab
    fireEvent.click(screen.getByText('Open Local Terminal'));

    await vi.waitFor(() => {
      expect(within(screen.getByTestId('tab-term-1')).getByText('Local Shell')).toBeInTheDocument();
    });

    // Shell starts on local host, sends prompt OSC sequence
    act(() => {
      dataCallback?.('app-term-1', '\x1b]0;alun@my-laptop: ~\x07');
    });

    // Still Local Shell because my-laptop is the base host
    expect(within(screen.getByTestId('tab-term-1')).getByText('Local Shell')).toBeInTheDocument();

    // User runs `ssh remote-prod-1` which outputs OSC title for remote host
    act(() => {
      dataCallback?.('app-term-1', '\x1b]0;root@remote-prod-1: /var/log\x07');
    });

    // Tab title dynamically updates to remote-prod-1!
    await vi.waitFor(() => {
      expect(within(screen.getByTestId('tab-term-1')).getByText('remote-prod-1')).toBeInTheDocument();
    });

    // User exits back to local host
    act(() => {
      dataCallback?.('app-term-1', '\x1b]0;alun@my-laptop: ~\x07');
    });

    // Tab title restores to Local Shell!
    await vi.waitFor(() => {
      expect(within(screen.getByTestId('tab-term-1')).getByText('Local Shell')).toBeInTheDocument();
    });
  });

  it('detects nested hostname from plain prompt output and restores on exit', async () => {
    render(<App />);

    // Open local terminal
    fireEvent.click(screen.getByText('Open Local Terminal'));
    await vi.waitFor(() => {
      expect(within(screen.getByTestId('tab-term-1')).getByText('Local Shell')).toBeInTheDocument();
    });

    // Remote machine gnarg outputs standard bash prompt without OSC title
    act(() => {
      dataCallback?.('app-term-1', '[alun@gnarg ~]$ ');
    });

    // Tab title dynamically updates to gnarg!
    await vi.waitFor(() => {
      expect(within(screen.getByTestId('tab-term-1')).getByText('gnarg')).toBeInTheDocument();
    });

    // When exiting, local prompt outputs
    act(() => {
      dataCallback?.('app-term-1', '[alun@my-laptop ~]$ ');
    });

    // Tab title restores to Local Shell!
    await vi.waitFor(() => {
      expect(within(screen.getByTestId('tab-term-1')).getByText('Local Shell')).toBeInTheDocument();
    });
  });
});

