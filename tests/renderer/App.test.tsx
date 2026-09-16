// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
  beforeEach(() => {
    window.multissh = {
      ...(window.multissh || {}),
      terminalCreate: vi.fn().mockResolvedValue({ sessionId: 'app-term-1' }),
      terminalWrite: vi.fn().mockResolvedValue(undefined),
      terminalResize: vi.fn().mockResolvedValue(undefined),
      terminalKill: vi.fn().mockResolvedValue(undefined),
      onTerminalData: vi.fn(() => vi.fn()),
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

  it('splits terminal view into vertical, horizontal, and 2x2 grid layouts', async () => {
    render(<App />);

    // Initially single layout (no multi-panes)
    expect(screen.queryAllByTestId(/^terminal-pane-/).length).toBe(0);

    // Click vertical split button
    const vertBtn = screen.getByTestId('layout-vertical-term-1');
    fireEvent.click(vertBtn);

    // Should now have 2 panes
    let panes = screen.getAllByTestId(/^terminal-pane-/);
    expect(panes.length).toBe(2);

    // Click 2x2 grid button
    const gridBtn = screen.getByTestId('layout-grid-term-1');
    fireEvent.click(gridBtn);

    // Should now have 4 panes
    panes = screen.getAllByTestId(/^terminal-pane-/);
    expect(panes.length).toBe(4);

    // Switch back to single layout
    const singleBtn = screen.getByTestId('layout-single-term-1');
    fireEvent.click(singleBtn);
    expect(screen.queryAllByTestId(/^terminal-pane-/).length).toBe(0);
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

    expect(screen.getAllByTestId(/^terminal-pane-/).length).toBe(2);

    // Trigger Ctrl+W to close active tab
    fireEvent.keyDown(window, {
      key: 'w',
      ctrlKey: true,
    });

    expect(screen.getAllByRole('tab').length).toBe(1);
  });
});
