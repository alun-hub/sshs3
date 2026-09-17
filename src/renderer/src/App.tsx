import React, { useState, useEffect, useCallback } from 'react';
import { Columns2, Grid2x2, Rows2, Square, Terminal } from 'lucide-react';
import { TabBar, type TabItem, type TabType } from './components/TabBar';
import { TerminalView } from './components/TerminalView';
import { SmartcardPinModal } from './components/SmartcardPinModal';
import { HostKeyTrustModal } from './components/HostKeyTrustModal';
import { TransferConflictModal } from './components/TransferConflictModal';
import { DotfilesSyncBanner } from './components/DotfilesSyncBanner';
import { DualPaneExplorer } from './components/FileManager/DualPaneExplorer';
import { ConnectionManagerModal } from './components/ConnectionModal/ConnectionManagerModal';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, type AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig, LocalShellType } from '@shared/types/ssh';
import type { SplitLayout, TerminalPaneConfig } from '@shared/types/session';

/** Buttons for launching a local shell (no SSH connection) in a tab or pane. */
const LocalTerminalButtons: React.FC<{ platform: string; onOpen: (shellType?: LocalShellType) => void }> = ({
  platform,
  onOpen,
}) => {
  if (platform !== 'win32') {
    return (
      <button
        type="button"
        onClick={() => onOpen()}
        className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
      >
        Open Local Terminal
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onOpen('cmd')}
        className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
      >
        Command Prompt
      </button>
      <button
        type="button"
        onClick={() => onOpen('powershell')}
        className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
      >
        PowerShell
      </button>
      <button
        type="button"
        onClick={() => onOpen('pwsh')}
        title="PowerShell 7+ (pwsh.exe) — requires it to be installed and on PATH"
        className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
      >
        PowerShell 7
      </button>
    </div>
  );
};

export interface AppTab extends TabItem {
  config?: SSHConnectionConfig;
  local?: boolean;
  shellType?: LocalShellType;
  splitLayout?: SplitLayout;
  panes?: TerminalPaneConfig[];
  initialCwd?: string;
}

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<AppTab[]>([
    {
      id: 'term-1',
      type: 'terminal',
      title: 'Terminal 1',
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('term-1');
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
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
        setTabs(session.tabs);
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

  const handleSetSplitLayout = useCallback((tabId: string, layout: SplitLayout) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.type !== 'terminal') return t;
        const currentPanes =
          t.panes && t.panes.length > 0 ? [...t.panes] : [{ id: `${t.id}-p1`, config: t.config }];
        const requiredCount = layout === 'single' ? 1 : layout === 'grid-2x2' ? 4 : 2;

        while (currentPanes.length < requiredCount) {
          const pIndex = currentPanes.length + 1;
          currentPanes.push({
            id: `${t.id}-p${pIndex}-${Date.now()}`,
            config: t.config,
          });
        }

        return {
          ...t,
          splitLayout: layout,
          panes: currentPanes,
        };
      })
    );
  }, []);

  const handleConnectTerminal = (
    target: { tabId: string; paneId?: string },
    config: SSHConnectionConfig
  ) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== target.tabId) return t;
        if (target.paneId && t.panes) {
          const updatedPanes = t.panes.map((p) =>
            p.id === target.paneId ? { ...p, config, local: false, shellType: undefined } : p
          );
          return { ...t, panes: updatedPanes, title: t.title || config.name };
        }
        const updatedPanes =
          t.panes && t.panes.length > 0
            ? t.panes.map((p, i) => (i === 0 ? { ...p, config, local: false, shellType: undefined } : p))
            : [{ id: `${t.id}-p1`, config }];
        return { ...t, config, local: false, shellType: undefined, panes: updatedPanes, title: config.name };
      })
    );
    setConnectTarget(null);
  };

  const handleOpenLocalTerminal = useCallback(
    (target: { tabId: string; paneId?: string }, shellType?: LocalShellType) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== target.tabId) return t;
          if (target.paneId && t.panes) {
            const updatedPanes = t.panes.map((p) =>
              p.id === target.paneId ? { ...p, config: undefined, local: true, shellType } : p
            );
            return { ...t, panes: updatedPanes };
          }
          const updatedPanes =
            t.panes && t.panes.length > 0
              ? t.panes.map((p, i) =>
                  i === 0 ? { ...p, config: undefined, local: true, shellType } : p
                )
              : [{ id: `${t.id}-p1`, local: true, shellType }];
          return {
            ...t,
            config: undefined,
            local: true,
            shellType,
            panes: updatedPanes,
            title: t.title || 'Local Shell',
          };
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
        config,
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
              if (activeTabId) handleSetSplitLayout(activeTabId, 'split-vertical');
              break;
            case 'splitHorizontal':
              if (activeTabId) handleSetSplitLayout(activeTabId, 'split-horizontal');
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
  }, [tabs, activeTabId, settings.shortcuts, handleNewTab, handleCloseTab, handleSetSplitLayout]);

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
          </div>
        ) : (
          tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const layout = tab.splitLayout || 'single';
            const paneCount = layout === 'grid-2x2' ? 4 : layout === 'single' ? 1 : 2;
            const displayPanes =
              tab.panes && tab.panes.length > 0
                ? tab.panes.slice(0, paneCount)
                : [{ id: `${tab.id}-p1`, config: tab.config }];

            return (
              <div
                key={tab.id}
                data-testid={`tab-panel-${tab.id}`}
                className={`h-full w-full ${isActive ? 'flex flex-1 flex-col' : 'hidden'}`}
                style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column' }}
              >
                {tab.type === 'terminal' ? (
                  <div className="flex flex-1 flex-col h-full w-full overflow-hidden">
                    {/* Top Pane Bar with status and split layout buttons */}
                    <div className="flex h-7 shrink-0 items-center justify-between border-b border-border-subtle bg-app-surface-subtle px-2.5 text-xs text-txt-secondary">
                      <div className="flex items-center gap-2 truncate">
                        <Terminal className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                        <span className="truncate font-medium text-txt-primary">
                          {layout !== 'single'
                            ? `Split View (${
                                layout === 'split-vertical'
                                  ? '2 columns'
                                  : layout === 'split-horizontal'
                                  ? '2 rows'
                                  : '2x2 grid'
                              })`
                            : tab.config?.name || (tab.local ? 'Local Shell' : 'No connection selected')}
                        </span>
                        {tab.config?.username && layout === 'single' && (
                          <span className="text-[11px] text-txt-muted">
                            ({tab.config.username}@{tab.config.host}:{tab.config.port ?? 22})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Single view"
                          data-testid={`layout-single-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'single')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'single'
                              ? 'bg-sky-600 text-white'
                              : 'text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary'
                          }`}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Vertical split (2 columns)"
                          data-testid={`layout-vertical-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'split-vertical')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'split-vertical'
                              ? 'bg-sky-600 text-white'
                              : 'text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary'
                          }`}
                        >
                          <Columns2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Horizontal split (2 rows)"
                          data-testid={`layout-horizontal-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'split-horizontal')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'split-horizontal'
                              ? 'bg-sky-600 text-white'
                              : 'text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary'
                          }`}
                        >
                          <Rows2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="2x2 Grid (4 terminals)"
                          data-testid={`layout-grid-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'grid-2x2')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'grid-2x2'
                              ? 'bg-sky-600 text-white'
                              : 'text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary'
                          }`}
                        >
                          <Grid2x2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Pane content */}
                    <div className="flex-1 min-h-0 relative">
                      {layout === 'single' ? (
                        tab.config ? (
                          <TerminalView
                            config={tab.config}
                            isActive={isActive}
                            fontSize={settings.terminalFontSize}
                            fontFamily={settings.terminalFontFamily}
                            theme={settings.theme}
                            initialCwd={tab.initialCwd}
                          />
                        ) : tab.local ? (
                          <TerminalView
                            local
                            shellType={tab.shellType}
                            isActive={isActive}
                            fontSize={settings.terminalFontSize}
                            fontFamily={settings.terminalFontFamily}
                            theme={settings.theme}
                          />
                        ) : (
                          <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-app text-txt-muted">
                            <Terminal className="h-10 w-10 text-txt-muted" />
                            <p className="text-sm text-txt-secondary">No connection selected for this tab</p>
                            <button
                              type="button"
                              onClick={() => setConnectTarget({ tabId: tab.id })}
                              className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
                            >
                              Select SSH Connection
                            </button>
                            <LocalTerminalButtons
                              platform={platform}
                              onOpen={(shellType) => handleOpenLocalTerminal({ tabId: tab.id }, shellType)}
                            />
                          </div>
                        )
                      ) : (
                        <div
                          className={`h-full w-full ${
                            layout === 'split-vertical'
                              ? 'grid grid-cols-2 divide-x divide-border-subtle'
                              : layout === 'split-horizontal'
                              ? 'grid grid-rows-2 divide-y divide-border-subtle'
                              : 'grid grid-cols-2 grid-rows-2 divide-x divide-y divide-border-subtle'
                          }`}
                        >
                          {displayPanes.map((pane, pIdx) => (
                            <div
                              key={pane.id}
                              data-testid={`terminal-pane-${pane.id}`}
                              className="relative flex flex-col h-full w-full overflow-hidden"
                            >
                              <div className="flex h-6 shrink-0 items-center justify-between border-b border-border-subtle bg-app-surface px-2 text-[11px] text-txt-muted">
                                <span className="truncate font-mono">
                                  {pane.config?.name || (pane.local ? 'Local Shell' : `Terminal ${pIdx + 1}`)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConnectTarget({ tabId: tab.id, paneId: pane.id })
                                  }
                                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400 hover:bg-app-surface-hover transition-colors"
                                >
                                  {pane.config ? 'Change' : 'Select connection'}
                                </button>
                              </div>
                              <div className="flex-1 min-h-0">
                                {pane.config ? (
                                  <TerminalView
                                    config={pane.config}
                                    isActive={isActive}
                                    fontSize={settings.terminalFontSize}
                                    fontFamily={settings.terminalFontFamily}
                                    theme={settings.theme}
                                  />
                                ) : pane.local ? (
                                  <TerminalView
                                    local
                                    shellType={pane.shellType}
                                    isActive={isActive}
                                    fontSize={settings.terminalFontSize}
                                    fontFamily={settings.terminalFontFamily}
                                    theme={settings.theme}
                                  />
                                ) : (
                                  <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-txt-muted bg-app">
                                    <p className="text-xs text-txt-secondary">No connection selected</p>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConnectTarget({ tabId: tab.id, paneId: pane.id })
                                      }
                                      className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
                                    >
                                      Select SSH Connection
                                    </button>
                                    <LocalTerminalButtons
                                      platform={platform}
                                      onOpen={(shellType) =>
                                        handleOpenLocalTerminal({ tabId: tab.id, paneId: pane.id }, shellType)
                                      }
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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
          if (activeTab && activeTab.type === 'terminal' && !activeTab.config) {
            handleConnectTerminal({ tabId: activeTab.id }, config);
          } else {
            const newId = `term-${Date.now()}`;
            const newTab: AppTab = {
              id: newId,
              type: 'terminal',
              title: config.name,
              config,
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
    </div>
  );
};

export default App;
