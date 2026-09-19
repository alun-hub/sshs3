import React, { useState, useEffect, useCallback } from 'react';
import { Square, Terminal } from 'lucide-react';
import { TabBar, type TabItem, type TabType } from './components/TabBar';
import { PaneTreeView } from './components/PaneTree';
import { SmartcardPinModal } from './components/SmartcardPinModal';
import { HostKeyTrustModal } from './components/HostKeyTrustModal';
import { AwsSsoLoginModal } from './components/AwsSsoLoginModal';
import { TransferConflictModal } from './components/TransferConflictModal';
import { DotfilesSyncBanner } from './components/DotfilesSyncBanner';
import { DualPaneExplorer } from './components/FileManager/DualPaneExplorer';
import { ConnectionManagerModal } from './components/ConnectionModal/ConnectionManagerModal';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { SyncBootstrapModal } from './components/SettingsModal/SyncBootstrapModal';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, type AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig, LocalShellType } from '@shared/types/ssh';
import type { PaneNode, PaneOrientation } from '@shared/types/session';
import { closePane, countLeaves, createLeaf, findLeaf, getFirstLeafId, splitPane, updateLeaf } from './lib/paneTree';

export interface AppTab extends TabItem {
  /** Terminal tabs always carry a pane tree, even when it's a single leaf. */
  paneTree?: PaneNode;
  /** The pane the user last interacted with; keyboard shortcuts (split/close) target this pane. */
  activePaneId?: string;
  initialCwd?: string;
}

/** True when a terminal tab has a single, not-yet-connected pane (safe to fill in-place instead of opening a new tab). */
function isEmptyUnconnectedTab(tab: AppTab): boolean {
  if (tab.type !== 'terminal' || !tab.paneTree) return true;
  return tab.paneTree.type === 'leaf' && !tab.paneTree.config && !tab.paneTree.local;
}

/** Ensures every terminal tab carries a pane tree, synthesizing a single leaf for legacy/corrupted saved state. */
function normalizeTab(tab: AppTab): AppTab {
  if (tab.type !== 'terminal') return tab;
  if (tab.paneTree) return tab;
  return { ...tab, paneTree: createLeaf(`${tab.id}-root`) };
}

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<AppTab[]>([
    {
      id: 'term-1',
      type: 'terminal',
      title: 'Terminal 1',
      paneTree: createLeaf('term-1-root'),
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('term-1');
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [syncBootstrapModalOpen, setSyncBootstrapModalOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [connectTarget, setConnectTarget] = useState<{ tabId: string; paneId?: string } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [platform, setPlatform] = useState<string>('');

  useEffect(() => {
    void window.multissh.getPlatform?.().then((p) => setPlatform(p));
  }, []);

  // Load saved session on mount
  useEffect(() => {
    void window.multissh.sessionGet?.().then((session) => {
      if (session?.tabs && session.tabs.length > 0) {
        setTabs(session.tabs.map(normalizeTab));
        if (session.activeTabId && session.tabs.some((t) => t.id === session.activeTabId)) {
          setActiveTabId(session.activeTabId);
        } else {
          setActiveTabId(session.tabs[0].id);
        }
      }
      setSessionLoaded(true);
    });
  }, []);

  // Persist session whenever tabs or active tab change
  useEffect(() => {
    if (!sessionLoaded) return;
    void window.multissh.sessionGet?.().then((current) => {
      void window.multissh.sessionSave?.({
        tabs,
        activeTabId,
        lastPaths: current?.lastPaths || {},
        panes: current?.panes,
      });
    });
  }, [tabs, activeTabId, sessionLoaded]);

  // Load saved settings on mount
  useEffect(() => {
    void window.multissh.settingsGet?.().then((saved) => {
      if (saved) setSettings(saved);
    });
  }, []);

  // Apply theme to root
  const isLight =
    settings.theme === 'light' ||
    (settings.theme === 'system' && Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches));

  useEffect(() => {
    document.documentElement.classList.toggle('light', isLight);
  }, [isLight]);

  const handleSelectTab = (id: string) => {
    setActiveTabId(id);
  };

  const handleCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === id);
      const remaining = prev.filter((t) => t.id !== id);

      if (id === activeTabId && remaining.length > 0) {
        const nextIndex = Math.max(0, index - 1);
        setActiveTabId(remaining[nextIndex].id);
      }

      return remaining;
    });
  }, [activeTabId]);

  const handleNewTab = useCallback((type?: TabType) => {
    const tabType = type || settings.defaultNewTabType || 'terminal';
    const newId = `${tabType === 'terminal' ? 'term' : 'fm'}-${Date.now()}`;

    setTabs((prev) => {
      let nextNum = 1;
      const usedNums = new Set<number>();

      if (tabType === 'terminal') {
        for (const t of prev) {
          if (t.type === 'terminal') {
            const m = t.title.match(/Terminal\s+(\d+)/);
            if (m) usedNums.add(parseInt(m[1], 10));
          }
        }
        while (usedNums.has(nextNum)) {
          nextNum++;
        }
        const newTab: AppTab = {
          id: newId,
          type: 'terminal',
          title: `Terminal ${nextNum}`,
          paneTree: createLeaf(`${newId}-root`),
        };
        return [...prev, newTab];
      } else {
        for (const t of prev) {
          if (t.type === 'filemanager') {
            const m = t.title.match(/(?:File Manager|Filhanterare)\s+(\d+)/);
            if (m) usedNums.add(parseInt(m[1], 10));
          }
        }
        while (usedNums.has(nextNum)) {
          nextNum++;
        }
        const newTab: AppTab = {
          id: newId,
          type: 'filemanager',
          title: `File Manager ${nextNum}`,
        };
        return [...prev, newTab];
      }
    });

    setActiveTabId(newId);
  }, [settings.defaultNewTabType]);

  /** Splits `paneId` (defaulting to the tab's active/first pane) without ever recreating existing panes. */
  const handleSplitPane = useCallback((tabId: string, orientation: PaneOrientation, paneId?: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.type !== 'terminal' || !t.paneTree) return t;
        const targetPaneId = paneId ?? t.activePaneId ?? getFirstLeafId(t.paneTree);
        const { tree, newPaneId } = splitPane(t.paneTree, targetPaneId, orientation, t.id);
        return { ...t, paneTree: tree, activePaneId: newPaneId };
      })
    );
  }, []);

  /** Closes one specific pane (à la Konsole), leaving every other pane's session untouched. */
  const handleClosePane = useCallback((tabId: string, paneId: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.type !== 'terminal' || !t.paneTree) return t;
        const nextTree = closePane(t.paneTree, paneId);
        if (!nextTree) return t; // sole pane: caller should close the whole tab instead
        return {
          ...t,
          paneTree: nextTree,
          activePaneId: t.activePaneId === paneId ? getFirstLeafId(nextTree) : t.activePaneId,
        };
      })
    );
  }, []);

  /** Keeps only the active pane, closing every other split in the tab (a quick "unsplit"). */
  const handleUnsplit = useCallback((tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.type !== 'terminal' || !t.paneTree) return t;
        const keepId = t.activePaneId ?? getFirstLeafId(t.paneTree);
        const keptLeaf = findLeaf(t.paneTree, keepId);
        if (!keptLeaf) return t;
        return { ...t, paneTree: keptLeaf, activePaneId: keptLeaf.id };
      })
    );
  }, []);

  const handleSelectPane = useCallback((tabId: string, paneId: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)));
  }, []);

  const handleConnectTerminal = (
    target: { tabId: string; paneId?: string },
    config: SSHConnectionConfig
  ) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== target.tabId || t.type !== 'terminal' || !t.paneTree) return t;
        const paneId = target.paneId ?? getFirstLeafId(t.paneTree);
        const paneTree = updateLeaf(t.paneTree, paneId, (leaf) => ({
          ...leaf,
          config,
          local: false,
          shellType: undefined,
        }));
        return { ...t, paneTree, title: t.title || config.name };
      })
    );
    setConnectTarget(null);
  };

  const handleOpenLocalTerminal = useCallback(
    (target: { tabId: string; paneId?: string }, shellType?: LocalShellType, wslDistro?: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== target.tabId || t.type !== 'terminal' || !t.paneTree) return t;
          const paneId = target.paneId ?? getFirstLeafId(t.paneTree);
          const paneTree = updateLeaf(t.paneTree, paneId, (leaf) => ({
            ...leaf,
            config: undefined,
            local: true,
            shellType,
            wslDistro,
          }));
          const defaultTitle =
            shellType === 'wsl'
              ? wslDistro
                ? `WSL: ${wslDistro}`
                : 'WSL'
              : 'Local Shell';
          const title = !t.title || /^Terminal\s+\d+$/.test(t.title) ? defaultTitle : t.title;
          return { ...t, paneTree, title };
        })
      );
    },
    []
  );

  const handleOpenTerminalAt = useCallback(
    (config: SSHConnectionConfig, path: string) => {
      const newId = `term-${Date.now()}`;
      const newTab: AppTab = {
        id: newId,
        type: 'terminal',
        title: config.name,
        paneTree: createLeaf(`${newId}-root`, { config }),
        initialCwd: path,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
    },
    []
  );

  const handleOpenProfiles = () => {
    setProfilesModalOpen(true);
  };

  const handleOpenSettings = () => {
    setSettingsModalOpen(true);
  };

  const handleSyncBootstrapComplete = () => {
    // Settings may have just been pulled in; profiles/dotfile pools are
    // already re-read fresh from disk whenever their own modals open.
    void window.multissh.settingsGet?.().then((saved) => {
      if (saved) setSettings(saved);
    });
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    void window.multissh.settingsSave?.(newSettings);
  };

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput) return;

      // Quick Connect shortcut Ctrl+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setProfilesModalOpen(true);
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.metaKey) parts.push('Cmd');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      let key = e.key;
      if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') {
        return;
      }
      if (key === ' ') key = 'Space';
      else if (key.length === 1) key = key.toUpperCase();
      parts.push(key);

      const combo = parts.join('+').toLowerCase();
      const activeShortcuts = settings.shortcuts || DEFAULT_SHORTCUTS;

      for (const [actionId, keyBinding] of Object.entries(activeShortcuts)) {
        if (combo === keyBinding.toLowerCase()) {
          e.preventDefault();
          switch (actionId) {
            case 'newTerminal':
              handleNewTab('terminal');
              break;
            case 'newFileManager':
              handleNewTab('filemanager');
              break;
            case 'closeTab':
              if (activeTabId) handleCloseTab(activeTabId);
              break;
            case 'nextTab': {
              const idx = tabs.findIndex((t) => t.id === activeTabId);
              if (idx >= 0 && tabs.length > 1) {
                const nextIdx = (idx + 1) % tabs.length;
                setActiveTabId(tabs[nextIdx].id);
              }
              break;
            }
            case 'prevTab': {
              const idx = tabs.findIndex((t) => t.id === activeTabId);
              if (idx >= 0 && tabs.length > 1) {
                const prevIdx = (idx - 1 + tabs.length) % tabs.length;
                setActiveTabId(tabs[prevIdx].id);
              }
              break;
            }
            case 'openProfiles':
              setProfilesModalOpen(true);
              break;
            case 'openSettings':
              setSettingsModalOpen(true);
              break;
            case 'splitVertical':
              if (activeTabId) handleSplitPane(activeTabId, 'row');
              break;
            case 'splitHorizontal':
              if (activeTabId) handleSplitPane(activeTabId, 'column');
              break;
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [tabs, activeTabId, settings.shortcuts, handleNewTab, handleCloseTab, handleSplitPane]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden select-none bg-app text-txt-primary">
      {/* Top Bar with Brand, TabBar, and Quick Connect */}
      <header className="flex h-10 shrink-0 items-center border-b border-border-subtle bg-app-surface">
        <div className="flex items-center gap-2 border-r border-border-subtle px-3.5 font-semibold text-sm">
          <Terminal className="h-4 w-4 text-sky-500" />
          <span className="font-bold tracking-wide text-txt-primary">
            sshs3
          </span>
        </div>

        {/* TabBar */}
        <div className="flex-1 min-w-0">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
            onOpenProfiles={handleOpenProfiles}
            onOpenSettings={handleOpenSettings}
            showLockSmartcardButton={settings.smartcardAuthMode === 'agent-global'}
            onLockSmartcard={() => window.multissh!.smartcardLockAll()}
            onListCachedSmartcards={() => window.multissh!.smartcardListCached()}
          />
        </div>
      </header>

      {/* Main Content Area: non-active tabs stay mounted with display: none */}
      <main className="relative flex flex-1 w-full overflow-hidden bg-app">
        {tabs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-txt-muted gap-3">
            <p className="text-sm">No tabs open</p>
            <button
              type="button"
              onClick={() => handleNewTab('terminal')}
              className="rounded-lg bg-sky-500/15 border border-sky-500/30 px-3.5 py-1.5 text-xs text-sky-400 hover:bg-sky-500/25 transition-colors"
            >
              Open New Terminal
            </button>
            <button
              type="button"
              onClick={() => setSyncBootstrapModalOpen(true)}
              className="text-[11px] text-txt-muted hover:text-sky-400 hover:underline transition-colors"
            >
              Import existing profile from the cloud
            </button>
          </div>
        ) : (
          tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const totalPanes = tab.type === 'terminal' && tab.paneTree ? countLeaves(tab.paneTree) : 1;
            const rootLeaf =
              tab.type === 'terminal' && tab.paneTree ? findLeaf(tab.paneTree, getFirstLeafId(tab.paneTree)) : null;

            return (
              <div
                key={tab.id}
                data-testid={`tab-panel-${tab.id}`}
                className={`h-full w-full ${isActive ? 'flex flex-1 flex-col' : 'hidden'}`}
                style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column' }}
              >
                {tab.type === 'terminal' && tab.paneTree ? (
                  <div className="flex flex-1 flex-col h-full w-full overflow-hidden">
                    {/* Top Pane Bar with status and quick "unsplit" action */}
                    <div className="flex h-7 shrink-0 items-center justify-between border-b border-border-subtle bg-app-surface-subtle px-2.5 text-xs text-txt-secondary">
                      <div className="flex items-center gap-2 truncate">
                        <Terminal className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                        <span className="truncate font-medium text-txt-primary">
                          {totalPanes > 1
                            ? `Split view (${totalPanes} panes)`
                            : rootLeaf?.config?.name || (rootLeaf?.local ? 'Local Shell' : 'No connection selected')}
                        </span>
                        {totalPanes === 1 && rootLeaf?.config?.username && (
                          <span className="text-[11px] text-txt-muted">
                            ({rootLeaf.config.username}@{rootLeaf.config.host}:{rootLeaf.config.port ?? 22})
                          </span>
                        )}
                      </div>

                      {totalPanes > 1 && (
                        <button
                          type="button"
                          title="Unsplit: close every other pane, keep only the active one"
                          data-testid={`unsplit-${tab.id}`}
                          onClick={() => handleUnsplit(tab.id)}
                          className="flex items-center gap-1 rounded p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                        >
                          <Square className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Pane content */}
                    <div className="flex-1 min-h-0 relative">
                      <PaneTreeView
                        node={tab.paneTree}
                        isActive={isActive}
                        activePaneId={tab.activePaneId}
                        totalPanes={totalPanes}
                        settings={settings}
                        platform={platform}
                        onSelectPane={(paneId) => handleSelectPane(tab.id, paneId)}
                        onSplitPane={(paneId, orientation) => handleSplitPane(tab.id, orientation, paneId)}
                        onClosePane={(paneId) => handleClosePane(tab.id, paneId)}
                        onChangeConnection={(paneId) => setConnectTarget({ tabId: tab.id, paneId })}
                        onOpenLocalTerminal={(paneId, shellType, wslDistro) =>
                          handleOpenLocalTerminal({ tabId: tab.id, paneId }, shellType, wslDistro)
                        }
                        onCloseTab={() => handleCloseTab(tab.id)}
                        initialCwdPaneId={rootLeaf?.id}
                        initialCwd={tab.initialCwd}
                      />
                    </div>
                  </div>
                ) : (
                  <div data-testid={`filemanager-panel-${tab.id}`} className="flex min-h-0 flex-1 flex-col">
                    <DualPaneExplorer onOpenTerminal={handleOpenTerminalAt} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>

      {/* Global Smartcard PIN Modal */}
      <SmartcardPinModal />

      {/* Global SFTP host key trust-on-first-use dialog */}
      <HostKeyTrustModal />

      {/* Global AWS SSO device-authorization login dialog */}
      <AwsSsoLoginModal />

      {/* Global transfer conflict (overwrite/skip/rename) dialog */}
      <TransferConflictModal />

      {/* Global dotfiles pool sync prompt (opt-in feature, see Settings) */}
      <DotfilesSyncBanner />

      {/* Per-tab or per-pane: pick an SSH profile to connect */}
      <ConnectionManagerModal
        open={connectTarget !== null}
        initialTab="ssh"
        dotfilesPoolEnabled={settings.dotfilesPoolEnabled ?? false}
        onClose={() => setConnectTarget(null)}
        onConnectSSH={(config) => {
          if (connectTarget) handleConnectTerminal(connectTarget, config);
        }}
      />

      {/* Quick-link / Ctrl+K / Top Bar: manage or connect to saved SSH/S3 profiles */}
      <ConnectionManagerModal
        open={profilesModalOpen}
        dotfilesPoolEnabled={settings.dotfilesPoolEnabled ?? false}
        onClose={() => setProfilesModalOpen(false)}
        onConnectSSH={(config) => {
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab && activeTab.type === 'terminal' && isEmptyUnconnectedTab(activeTab)) {
            handleConnectTerminal({ tabId: activeTab.id }, config);
          } else {
            const newId = `term-${Date.now()}`;
            const newTab: AppTab = {
              id: newId,
              type: 'terminal',
              title: config.name,
              paneTree: createLeaf(`${newId}-root`, { config }),
            };
            setTabs((prev) => [...prev, newTab]);
            setActiveTabId(newId);
          }
          setProfilesModalOpen(false);
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsModalOpen}
        currentSettings={settings}
        onSave={handleSaveSettings}
        onClose={() => setSettingsModalOpen(false)}
      />

      <SyncBootstrapModal
        open={syncBootstrapModalOpen}
        onClose={() => setSyncBootstrapModalOpen(false)}
        onComplete={handleSyncBootstrapComplete}
      />
    </div>
  );
};

export default App;
