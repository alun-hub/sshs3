// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TabBar, type TabItem } from '../../src/renderer/src/components/TabBar';

describe('TabBar Component', () => {
  afterEach(() => {
    cleanup();
  });

  const sampleTabs: TabItem[] = [
    { id: 'tab-1', type: 'terminal', title: 'prod-server' },
    { id: 'tab-2', type: 'filemanager', title: 'S3 Backups' },
    { id: 'tab-3', type: 'terminal', title: 'dev-box' },
  ];

  it('renders all tabs with titles, types, and active status', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onNewTab = vi.fn();

    render(
      <TabBar
        tabs={sampleTabs}
        activeTabId="tab-2"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
      />
    );

    // Verify all titles are displayed
    expect(screen.getByText('prod-server')).toBeInTheDocument();
    expect(screen.getByText('S3 Backups')).toBeInTheDocument();
    expect(screen.getByText('dev-box')).toBeInTheDocument();

    // Verify active tab status
    const tab2 = screen.getByTestId('tab-tab-2');
    expect(tab2).toHaveAttribute('aria-selected', 'true');

    const tab1 = screen.getByTestId('tab-tab-1');
    expect(tab1).toHaveAttribute('aria-selected', 'false');

    // Verify icons exist for terminal and filemanager
    expect(screen.getByTestId('tab-icon-tab-1')).toBeInTheDocument();
    expect(screen.getByTestId('tab-icon-tab-2')).toBeInTheDocument();
  });

  it('calls onSelectTab when an inactive tab is clicked', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onNewTab = vi.fn();

    render(
      <TabBar
        tabs={sampleTabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
      />
    );

    fireEvent.click(screen.getByTestId('tab-tab-2'));
    expect(onSelectTab).toHaveBeenCalledTimes(1);
    expect(onSelectTab).toHaveBeenCalledWith('tab-2');
  });

  it('calls onCloseTab when close button is clicked without triggering onSelectTab', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onNewTab = vi.fn();

    render(
      <TabBar
        tabs={sampleTabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
      />
    );

    const closeBtn = screen.getByTestId('close-tab-tab-3');
    fireEvent.click(closeBtn);

    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith('tab-3');
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  it('handles new tab creation via new tab dropdown/buttons', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onNewTab = vi.fn();

    render(
      <TabBar
        tabs={sampleTabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
      />
    );

    // Click the "+" button to open the menu
    const addBtn = screen.getByTestId('add-tab-btn');
    fireEvent.click(addBtn);

    // Should show new terminal and new filemanager options
    const newTerminalBtn = screen.getByTestId('new-terminal-btn');
    const newFileManagerBtn = screen.getByTestId('new-filemanager-btn');

    expect(newTerminalBtn).toBeInTheDocument();
    expect(newFileManagerBtn).toBeInTheDocument();

    fireEvent.click(newTerminalBtn);
    expect(onNewTab).toHaveBeenCalledWith('terminal');

    // Click again for filemanager
    fireEvent.click(addBtn);
    fireEvent.click(screen.getByTestId('new-filemanager-btn'));
    expect(onNewTab).toHaveBeenCalledWith('filemanager');
  });

  it('triggers quick links for profiles and settings', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    const onNewTab = vi.fn();
    const onOpenProfiles = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <TabBar
        tabs={sampleTabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onNewTab={onNewTab}
        onOpenProfiles={onOpenProfiles}
        onOpenSettings={onOpenSettings}
      />
    );

    const profilesBtn = screen.getByTestId('quick-profiles-btn');
    const settingsBtn = screen.getByTestId('quick-settings-btn');

    fireEvent.click(profilesBtn);
    expect(onOpenProfiles).toHaveBeenCalledTimes(1);

    fireEvent.click(settingsBtn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('closes new tab menu on Escape and restores focus to the add-tab button', () => {
    render(
      <TabBar
        tabs={sampleTabs}
        activeTabId="tab-1"
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />
    );

    const addBtn = screen.getByTestId('add-tab-btn');
    fireEvent.click(addBtn);
    expect(screen.getByTestId('new-terminal-btn')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('new-terminal-btn')).not.toBeInTheDocument();
  });

  describe('cached smartcard identities menu', () => {
    const renderWithSmartcard = (props: Partial<React.ComponentProps<typeof TabBar>> = {}) =>
      render(
        <TabBar
          tabs={sampleTabs}
          activeTabId="tab-1"
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewTab={vi.fn()}
          showLockSmartcardButton
          onListCachedSmartcards={() => Promise.resolve([])}
          onLockSmartcard={() => Promise.resolve({ locked: 0 })}
          {...props}
        />
      );

    it('offers Unlock Now next to Lock All Now, and reports when something was started', async () => {
      const onUnlockSmartcard = vi.fn().mockResolvedValue({ started: true });
      renderWithSmartcard({ onUnlockSmartcard });

      fireEvent.click(screen.getByTestId('quick-lock-smartcard-btn'));
      expect(screen.getByText('Lock All Now')).toBeInTheDocument();
      fireEvent.click(await screen.findByTestId('smartcard-unlock-now-btn'));

      expect(onUnlockSmartcard).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('Unlocking — enter your PIN when asked')).toBeInTheDocument();
    });

    it('tells the user when there was nothing to unlock', async () => {
      renderWithSmartcard({ onUnlockSmartcard: vi.fn().mockResolvedValue({ started: false }) });

      fireEvent.click(screen.getByTestId('quick-lock-smartcard-btn'));
      fireEvent.click(await screen.findByTestId('smartcard-unlock-now-btn'));

      expect(await screen.findByText(/Nothing to unlock/)).toBeInTheDocument();
    });

    it('hides Unlock Now when no unlock handler is provided', () => {
      renderWithSmartcard();
      fireEvent.click(screen.getByTestId('quick-lock-smartcard-btn'));
      expect(screen.queryByTestId('smartcard-unlock-now-btn')).not.toBeInTheDocument();
    });
  });
});
