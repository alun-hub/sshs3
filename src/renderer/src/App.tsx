import React, { useState, useEffect, useCallback } from 'react';
import { Columns2, Grid2x2, Rows2, Square, Terminal } from 'lucide-react';
import { TabBar, type TabItem, type TabType } from './components/TabBar';
import { TerminalView } from './components/TerminalView';
import { SmartcardPinModal } from './components/SmartcardPinModal';
import { HostKeyTrustModal } from './components/HostKeyTrustModal';
import { TransferConflictModal } from './components/TransferConflictModal';
import { DualPaneExplorer } from './components/FileManager/DualPaneExplorer';
import { ConnectionManagerModal } from './components/ConnectionModal/ConnectionManagerModal';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, type AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { SplitLayout, TerminalPaneConfig } from '@shared/types/session';

export interface AppTab extends TabItem {
  config?: SSHConnectionConfig;
  splitLayout?: SplitLayout;
  panes?: TerminalPaneConfig[];
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
  const [termCounter, setTermCounter] = useState(2);
  const [fmCounter, setFmCounter] = useState(1);
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [connectTarget, setConnectTarget] = useState<{ tabId: string; paneId?: string } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

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
        const termNums = session.tabs
          .filter((t) => t.type === 'terminal')
          .map((t) => {
            const m = t.title.match(/Terminal\s+(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
          });
        const fmNums = session.tabs
          .filter((t) => t.type === 'filemanager')
          .map((t) => {
            const m = t.title.match(/Filhanterare\s+(\d+)/);
            return m ? parseInt(m[1], 10) : 0;
          });
        if (termNums.length > 0) setTermCounter(Math.max(...termNums) + 1);
        if (fmNums.length > 0) setFmCounter(Math.max(...fmNums) + 1);
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
    if (tabType === 'terminal') {
      const newId = `term-${Date.now()}`;
      const newTab: AppTab = {
        id: newId,
        type: 'terminal',
        title: `Terminal ${termCounter}`,
      };
      setTermCounter((c) => c + 1);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
    } else if (tabType === 'filemanager') {
      const newId = `fm-${Date.now()}`;
      const newTab: AppTab = {
        id: newId,
        type: 'filemanager',
        title: `Filhanterare ${fmCounter}`,
      };
      setFmCounter((c) => c + 1);
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newId);
    }
  }, [settings.defaultNewTabType, termCounter, fmCounter]);

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
            p.id === target.paneId ? { ...p, config } : p
          );
          return { ...t, panes: updatedPanes, title: t.title || config.name };
        }
        const updatedPanes =
          t.panes && t.panes.length > 0
            ? t.panes.map((p, i) => (i === 0 ? { ...p, config } : p))
            : [{ id: `${t.id}-p1`, config }];
        return { ...t, config, panes: updatedPanes, title: config.name };
      })
    );
    setConnectTarget(null);
  };

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
    <div
      className={`flex h-screen w-screen flex-col overflow-hidden select-none ${
        isLight ? 'bg-slate-100 text-slate-900' : 'bg-slate-900 text-slate-100'
      }`}
    >
      {/* Top Bar with Brand & TabBar */}
      <header
        className={`flex h-10 shrink-0 items-center border-b ${
          isLight ? 'border-slate-300 bg-slate-200' : 'border-slate-700 bg-slate-800'
        }`}
      >
        <div
          className={`flex items-center gap-2 border-r px-3.5 font-semibold text-sm ${
            isLight ? 'border-slate-300' : 'border-slate-700'
          }`}
        >
          <Terminal className="h-4 w-4 text-sky-500" />
          <span className={`font-bold tracking-wide ${isLight ? 'text-slate-900' : 'text-white'}`}>
            sshs3
          </span>
        </div>
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
      <main className="relative flex flex-1 w-full overflow-hidden">
        {tabs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-500">
            <p className="text-sm">Inga öppna flikar</p>
            <button
              type="button"
              onClick={() => handleNewTab('terminal')}
              className="mt-3 rounded bg-sky-500/20 px-3 py-1.5 text-xs text-sky-400 hover:bg-sky-500/30"
            >
              Öppna ny terminal
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
                    <div
                      className={`flex h-7 shrink-0 items-center justify-between border-b px-2 text-xs ${
                        isLight
                          ? 'border-slate-300 bg-slate-200/80 text-slate-700'
                          : 'border-slate-800 bg-slate-900/80 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Terminal className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                        <span className="truncate font-medium">
                          {layout !== 'single'
                            ? `Delad vy (${
                                layout === 'split-vertical'
                                  ? '2 kolumner'
                                  : layout === 'split-horizontal'
                                  ? '2 rader'
                                  : '2x2 grid'
                              })`
                            : tab.config?.name || 'Ingen anslutning vald'}
                        </span>
                        {tab.config?.username && layout === 'single' && (
                          <span className="text-[11px] text-slate-500">
                            ({tab.config.username}@{tab.config.host}:{tab.config.port ?? 22})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Enkel vy"
                          data-testid={`layout-single-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'single')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'single'
                              ? 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                          }`}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Vertikal delning (2 kolumner)"
                          data-testid={`layout-vertical-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'split-vertical')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'split-vertical'
                              ? 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                          }`}
                        >
                          <Columns2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Horisontell delning (2 rader)"
                          data-testid={`layout-horizontal-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'split-horizontal')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'split-horizontal'
                              ? 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                          }`}
                        >
                          <Rows2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="2x2 Grid (4 terminaler)"
                          data-testid={`layout-grid-${tab.id}`}
                          onClick={() => handleSetSplitLayout(tab.id, 'grid-2x2')}
                          className={`rounded p-1 transition-colors ${
                            layout === 'grid-2x2'
                              ? 'bg-sky-600 text-white'
                              : 'text-slate-400 hover:bg-slate-700 hover:text-slate-200'
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
                          />
                        ) : (
                          <div
                            className={`flex h-full flex-1 flex-col items-center justify-center gap-3 ${
                              isLight ? 'bg-slate-100 text-slate-600' : 'bg-slate-900 text-slate-400'
                            }`}
                          >
                            <Terminal className="h-10 w-10 text-slate-500" />
                            <p className="text-sm">Ingen anslutning vald för den här fliken</p>
                            <button
                              type="button"
                              onClick={() => setConnectTarget({ tabId: tab.id })}
                              className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
                            >
                              Välj SSH-anslutning
                            </button>
                          </div>
                        )
                      ) : (
                        <div
                          className={`h-full w-full ${
                            layout === 'split-vertical'
                              ? 'grid grid-cols-2 divide-x divide-slate-800'
                              : layout === 'split-horizontal'
                              ? 'grid grid-rows-2 divide-y divide-slate-800'
                              : 'grid grid-cols-2 grid-rows-2 divide-x divide-y divide-slate-800'
                          }`}
                        >
                          {displayPanes.map((pane, pIdx) => (
                            <div
                              key={pane.id}
                              data-testid={`terminal-pane-${pane.id}`}
                              className="relative flex flex-col h-full w-full overflow-hidden"
                            >
                              <div className="flex h-6 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-2 text-[11px] text-slate-400">
                                <span className="truncate font-mono">
                                  {pane.config?.name || `Terminal ${pIdx + 1}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConnectTarget({ tabId: tab.id, paneId: pane.id })
                                  }
                                  className="rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-slate-800"
                                >
                                  {pane.config ? 'Byt' : 'Välj anslutning'}
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
                                ) : (
                                  <div className="flex h-full flex-1 flex-col items-center justify-center gap-2 text-slate-500">
                                    <p className="text-xs">Ingen anslutning vald</p>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConnectTarget({ tabId: tab.id, paneId: pane.id })
                                      }
                                      className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500"
                                    >
                                      Välj SSH-anslutning
                                    </button>
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
                    <DualPaneExplorer />
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

      {/* Per-tab or per-pane: pick an SSH profile to connect */}
      <ConnectionManagerModal
        open={connectTarget !== null}
        initialTab="ssh"
        onClose={() => setConnectTarget(null)}
        onConnectSSH={(config) => {
          if (connectTarget) handleConnectTerminal(connectTarget, config);
        }}
      />

      {/* Quick-link: manage saved SSH/S3 profiles without connecting anything */}
      <ConnectionManagerModal open={profilesModalOpen} onClose={() => setProfilesModalOpen(false)} />

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
