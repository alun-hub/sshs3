import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { UnsplitButton } from './components/UnsplitButton';
import { TabBar } from './components/TabBar';
import type { AppTab } from './lib/tabs';
import { useAppKeyboard } from './lib/useAppKeyboard';
import { useTabActions } from './lib/useTabActions';
import { useSessionPersistence } from './lib/useSessionPersistence';
import { useTabTransfer } from './lib/useTabTransfer';
import { BrandLogo } from './components/BrandLogo';
import { GlobalOverlays } from './components/GlobalOverlays';
import { LandingView } from './components/LandingView';
import { PaneTreeView } from './components/PaneTree';
import { ConfirmProvider, useConfirm } from './components/ConfirmDialog';
import { DualPaneExplorer } from './components/FileManager/DualPaneExplorer';
import { DirSyncSavedProfilesModal } from './components/FileManager/DirSyncSavedProfilesModal';
import { DirectorySyncModal } from './components/FileManager/DirectorySyncModal';
import { ConnectionManagerModal, type Tab as ConnectionManagerTab } from './components/ConnectionModal/ConnectionManagerModal';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { GlobalSearchPalette } from './components/GlobalSearchPalette';
import { AppNotice } from './components/AppNotice';
import { runGlobalAction, type GlobalActionId } from './lib/globalActions';
import type { SettingsCategory } from './components/SettingsModal/settingsConstants';
import { SyncBootstrapModal } from './components/SettingsModal/SyncBootstrapModal';
import { SSHGlobalTunnelsModal } from './components/SSH/SSHGlobalTunnelsModal';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { DirectorySyncProfile } from '@shared/types/dirsync';
import { countLeaves, createLeaf, findLeaf, getFirstLeafId } from './lib/paneTree';
import { installSpatialNavPointerReset } from './lib/spatialNavigation';
import { FILEMANAGER_FOCUS_SIDE_EVENT } from './components/FileManager/types';
import { FileEditorModal } from './components/FileManager/FileEditorModal';
import { OPEN_EDITOR_TAB_EVENT, type OpenEditorTabDetail } from './lib/editorTabEvents';
import { createRendererLogger } from './lib/log';
import { mergeSavedSettings, settingsPatchFromForm } from './lib/settingsSave';

const log = createRendererLogger('App');

const AppContent: React.FC = () => {
  const confirm = useConfirm();
  // Starts empty rather than seeded with a default terminal tab so that a
  // genuinely fresh install (no saved session) falls straight into the same
  // "all tabs closed" hero view as an existing user who closes their last
  // tab, instead of a different, less helpful per-pane empty state (UX
  // review, section 7). Real saved sessions overwrite this once loaded.
  const [tabs, setTabs] = useState<AppTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [profilesModalOpen, setProfilesModalOpen] = useState(false);
  const [profilesModalTab, setProfilesModalTab] = useState<ConnectionManagerTab>('ssh');
  /** Opens the profile manager straight into the empty "new SSH profile" form (welcome screen shortcut). */
  const [profilesModalNew, setProfilesModalNew] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  /** Category the Settings dialog opens on (the shortcuts overview); General when unset. */
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory | undefined>();
  const [syncBootstrapModalOpen, setSyncBootstrapModalOpen] = useState(false);
  const [dirSyncProfilesOpen, setDirSyncProfilesOpen] = useState(false);
  const [tunnelsModalOpen, setTunnelsModalOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  /** A short message for something that happened with no dialog open to show it (see AppNotice). */
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  // Design audit Phase 1: Connection Manager, Settings, Tunnels and Dir Sync
  // are independent toggles that used to be able to open simultaneously
  // (e.g. Settings opened from the toolbar while Connection Manager was
  // still open, stacking two full-screen modals). Route every "open" call
  // for these four through here so opening one always closes the others.
  const modalOpenerRef = useRef<HTMLElement | null>(null);
  const openTopLevelModal = useCallback((open: () => void) => {
    const active = document.activeElement;
    if (!modalOpenerRef.current && active instanceof HTMLElement && active !== document.body) {
      modalOpenerRef.current = active;
    }
    setProfilesModalOpen(false);
    setSettingsModalOpen(false);
    setTunnelsModalOpen(false);
    setDirSyncProfilesOpen(false);
    setGlobalSearchOpen(false);
    open();
  }, []);
  // UX audit finding #4: these four full-screen modals render as `fixed`
  // overlays, but the header behind them (tab bar, "+" new-tab menu, toolbar
  // icons) stayed in the normal tab/click order — you could open the "+"
  // dropdown on top of an already-open Connection Manager modal. `inert`
  // (native DOM, not React-typed pre-19) removes the header from hit-testing
  // and keyboard focus entirely while any of the four is open.
  const anyTopLevelModalOpen =
    profilesModalOpen || settingsModalOpen || tunnelsModalOpen || dirSyncProfilesOpen || globalSearchOpen;
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current as (HTMLElement & { inert?: boolean }) | null;
    if (el) el.inert = anyTopLevelModalOpen;
  }, [anyTopLevelModalOpen]);
  const [dirSyncRunProfile, setDirSyncRunProfile] = useState<DirectorySyncProfile | null>(null);
  const [tabBarFocused, setTabBarFocused] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [connectTarget, setConnectTarget] = useState<{ tabId: string; paneId?: string } | null>(null);
  const [platform, setPlatform] = useState<string>('');
  const [localHostname, setLocalHostname] = useState<string>('');

  useEffect(() => {
    void window.multissh.getPlatform?.().then((p) => setPlatform(p));
    void window.multissh.getHostname?.().then((h) => setLocalHostname(h));
    // No-op unless 'agent-global' PIN caching + "unlock at startup" are both
    // on; SmartcardPinModal (rendered unconditionally below) is already
    // mounted and listening by the time this resolves, so the PIN prompt
    // it may trigger is never missed.
    void window.multissh.smartcardUnlockAtStartup?.();
  }, []);

  const sessionLoaded = useSessionPersistence(tabs, activeTabId, setTabs, setActiveTabId);
  const { moveTab } = useTabTransfer(tabs, activeTabId, sessionLoaded, setTabs, setActiveTabId);
  const handleMoveTabToNewWindow = useCallback((id: string) => void moveTab(id, 'new'), [moveTab]);

  // Load saved settings on mount
  useEffect(() => {
    void window.multissh.settingsGet?.().then((saved) => {
      if (saved) setSettings(saved);
    });
  }, []);

  const openShortcutsHelp = useCallback(
    () =>
      openTopLevelModal(() => {
        setSettingsCategory('shortcuts');
        setSettingsModalOpen(true);
      }),
    [openTopLevelModal]
  );

  // Apply theme to root
  const isLight =
    settings.theme === 'light' ||
    (settings.theme === 'system' && Boolean(window.matchMedia?.('(prefers-color-scheme: light)')?.matches));
  const isBreeze = settings.theme === 'breeze';

  useEffect(() => {
    // index.html ships with a static class="dark" (so the window isn't
    // unstyled before this runs). Toggling theme classes ensures they remain
    // mutually exclusive on <html>.
    document.documentElement.classList.toggle('breeze', isBreeze);
    document.documentElement.classList.toggle('light', isLight);
    document.documentElement.classList.toggle('dark', !isLight && !isBreeze);
  }, [isLight, isBreeze]);

  const {
    handleSelectTab,
    handleCloseTab,
    handleNewTab,
    handleSplitPane,
    handleResizeSplit,
    handleClosePane,
    handleToggleZoom,
    handleUnsplit,
    handleSelectPane,
    handleConnectTerminal,
    handleConnectK8sTerminal,
    handleOpenSSHInTab,
    handleOpenK8sInTab,
    handleConnectSystem,
    handleViewK8sLogs,
    handleOpenLocalTerminal,
    handlePaneTitleChange,
    handleOpenTerminalAt,
    handleOpenRemotePath,
    handleOpenLocalPath,
    handleOpenK8sTerminalAt,
    handleBrowseK8sFiles,
    handleConnectSFTP,
    handleConnectS3,
    handleQuickStartTerminal,
    handleConnectRecentSSH,
    handleOpenEditorTab,
  } = useTabActions({
    tabs,
    activeTabId,
    settings,
    localHostname,
    setTabs,
    setActiveTabId,
    setTabBarFocused,
    setConnectTarget,
    setProfilesModalOpen,
    confirm,
    notify: setNotice,
  });

  const handleUpdateTabDirty = useCallback((tabId: string, isDirty: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId && t.isDirty !== isDirty ? { ...t, isDirty } : t))
    );
  }, []);

  useEffect(() => {
    const handleOpenEditor = (e: Event) => {
      const customEvent = e as CustomEvent<OpenEditorTabDetail>;
      if (customEvent.detail) {
        handleOpenEditorTab(customEvent.detail);
      }
    };
    window.addEventListener(OPEN_EDITOR_TAB_EVENT, handleOpenEditor);
    return () => window.removeEventListener(OPEN_EDITOR_TAB_EVENT, handleOpenEditor);
  }, [handleOpenEditorTab]);

  // UX audit finding #14: the landing page shown whenever no tabs are open
  // was a static onboarding screen — four cards explaining what the app can
  // do — that stayed exactly the same whether you had zero saved profiles or
  // twenty. Surfacing the same "recently used" list Connection Manager
  // already tracks turns that dead space into a one-click way back into
  // whatever you were last connected to.
  const [recentSSHProfiles, setRecentSSHProfiles] = useState<SSHConnectionConfig[]>([]);
  useEffect(() => {
    if (tabs.length !== 0) return;
    let cancelled = false;
    void window.multissh?.profilesGet?.()
      .then((profiles) => {
        if (!cancelled) setRecentSSHProfiles(profiles.ssh || []);
      })
      .catch(() => {
        // Landing page recents are a nice-to-have; ignore failures
      });
    return () => {
      cancelled = true;
    };
  }, [tabs.length]);

  const recentSSH = [...recentSSHProfiles]
    .filter((p) => Boolean(p.lastUsedAt))
    .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
    .slice(0, 4);

  const handleOpenProfiles = () => {
    setProfilesModalTab('ssh');
    openTopLevelModal(() => setProfilesModalOpen(true));
  };

  const globalSearchEnabled = settings.enableGlobalSearch !== false;
  const handleOpenGlobalSearch = () => openTopLevelModal(() => setGlobalSearchOpen(true));

  const handleNewProfile = () => {
    setProfilesModalTab('ssh');
    setProfilesModalNew(true);
    openTopLevelModal(() => setProfilesModalOpen(true));
  };

  const handleNewK8sSession = () => {
    setProfilesModalTab('k8s');
    openTopLevelModal(() => setProfilesModalOpen(true));
  };

  const handleOpenSettings = () => {
    openTopLevelModal(() => setSettingsModalOpen(true));
  };

  const handleRunGlobalAction = (id: GlobalActionId) =>
    runGlobalAction(id, {
      newTab: handleNewTab,
      openProfiles: handleOpenProfiles,
      openSettings: handleOpenSettings,
      newWindow: () => void window.multissh.windowNew(),
      showShortcuts: openShortcutsHelp,
    });

  const handleOpenTunnels = () => {
    openTopLevelModal(() => setTunnelsModalOpen(true));
  };

  const handleSyncBootstrapComplete = () => {
    // Settings may have just been pulled in; profiles/dotfile pools are
    // already re-read fresh from disk whenever their own modals open.
    void window.multissh.settingsGet?.().then((saved) => {
      if (saved) setSettings(saved);
    });
  };

  /** Sends only what changed, and takes back what the main process kept (it merges, and applies the policy). */
  const saveSettingsPatch = async (patch: Partial<AppSettings>) => {
    try {
      const saved = await window.multissh.settingsSave?.(patch);
      if (saved) setSettings((prev) => mergeSavedSettings(prev, saved, patch));
    } catch (err) {
      log.error('Failed to save settings:', err);
    }
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    void saveSettingsPatch(settingsPatchFromForm(newSettings));
  };

  const handleToggleHiddenFiles = () => {
    // Just this key: a copy of every setting from this component can be out of date.
    const showHiddenFiles = !(settings.showHiddenFiles ?? false);
    setSettings((prev) => ({ ...prev, showHiddenFiles }));
    void saveSettingsPatch({ showHiddenFiles });
  };

  const focusActiveTabContent = useCallback(() => {
    setTabBarFocused(false);
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) {
      const landingBtn = document.querySelector<HTMLElement>(
        '[data-testid="landing-view"] button:not([disabled])'
      );
      landingBtn?.focus();
      return;
    }
    if (activeTab?.type === 'terminal') {
      const targetPaneId =
        activeTab.activePaneId || (activeTab.paneTree ? getFirstLeafId(activeTab.paneTree) : null);
      if (targetPaneId) {
        handleSelectPane(activeTab.id, targetPaneId);
        const xtermTextarea = document.querySelector<HTMLTextAreaElement>(
          `[data-testid="terminal-pane-${targetPaneId}"] .xterm-helper-textarea`
        );
        if (xtermTextarea) {
          xtermTextarea.focus();
        } else {
          const paneBtn = document.querySelector<HTMLElement>(
            `[data-testid="unconnected-pane-${targetPaneId}"] button:not([disabled]), [data-testid="terminal-pane-${targetPaneId}"] button:not([disabled])`
          );
          paneBtn?.focus();
        }
      }
    } else if (activeTab?.type === 'filemanager') {
      window.dispatchEvent(
        new CustomEvent(FILEMANAGER_FOCUS_SIDE_EVENT, { detail: 'left' })
      );
    } else if (activeTab?.type === 'editor') {
      const editorEl = document.querySelector<HTMLElement>(
        `[data-testid="editor-panel-${activeTab.id}"] .cm-content`
      );
      editorEl?.focus();
    }
  }, [tabs, activeTabId, handleSelectPane]);

  useEffect(() => installSpatialNavPointerReset(), []);

  // A modal owns the keyboard while open: drop tab-bar focus on open, and on close give
  // focus back to whatever opened it (falling back to the active tab's content).
  const prevModalOpenRef = useRef(false);
  useEffect(() => {
    if (anyTopLevelModalOpen) {
      setTabBarFocused(false);
    } else if (prevModalOpenRef.current) {
      const opener = modalOpenerRef.current;
      modalOpenerRef.current = null;
      // Only restore when nothing else claimed focus meanwhile (e.g. a tab opened from the modal).
      const focusFree = !document.activeElement || document.activeElement === document.body;
      if (focusFree) {
        if (opener?.isConnected && opener.offsetParent !== null) opener.focus();
        else focusActiveTabContent();
      }
    }
    prevModalOpenRef.current = anyTopLevelModalOpen;
  }, [anyTopLevelModalOpen, focusActiveTabContent]);

  useAppKeyboard({
    tabs,
    activeTabId,
    tabBarFocused,
    anyTopLevelModalOpen,
    settings,
    setActiveTabId,
    setTabBarFocused,
    setSettings,
    setProfilesModalOpen,
    setSettingsModalOpen,
    setGlobalSearchOpen,
    openTopLevelModal,
    handleNewTab,
    handleCloseTab,
    handleMoveTabToNewWindow,
    handleSplitPane,
    handleClosePane,
    handleToggleZoom,
    handleSelectPane,
    openShortcutsHelp,
    focusActiveTabContent,
  });

  // Forget the requested category once Settings closes so the next plain open starts on General.
  useEffect(() => {
    if (!settingsModalOpen) setSettingsCategory(undefined);
  }, [settingsModalOpen]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app text-txt-primary">
      {/* Top Bar with Brand, TabBar, and Quick Connect. select-none here only
          (not on the whole app, see UX review #5) so tab titles, toolbar
          icons etc. don't show a text cursor/selection highlight, while
          file names, hostnames and other content below stays selectable. */}
      <header
        ref={headerRef}
        className="relative flex h-10 shrink-0 items-center bg-app-surface select-none after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-px after:bg-divider"
      >
        {/* Clicking the brand shows the landing page again; tabs stay open and mounted (no tab is active). */}
        <button
          type="button"
          title="Home"
          onClick={() => setActiveTabId('')}
          className="flex items-center gap-2.5 self-stretch border-r border-divider px-3.5 font-semibold text-sm hover:bg-app-surface-hover transition-colors"
        >
          <BrandLogo className="h-5 w-auto" />
          <span className="font-bold tracking-wide">
            <span className="text-txt-primary">ssh</span>
            <span className="text-brand-s3">S3</span>
          </span>
        </button>

        {/* TabBar */}
        <div className="min-w-0 flex-1 self-stretch">
          {/* LOW finding (code review): window.multissh! throws if the preload
              bridge is somehow missing, unlike the otherwise-consistent
              window.multissh?.x pattern used everywhere else in this file —
              the two callbacks below degrade gracefully instead (no cached
              agents / nothing locked) rather than crashing the tab bar. */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            tabBarFocused={tabBarFocused}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onMoveTab={(id, target) => void moveTab(id, target)}
            onListWindows={() => window.multissh?.windowList?.() ?? Promise.resolve([])}
            onNewTab={handleNewTab}
            onNewK8sSession={handleNewK8sSession}
            onOpenProfiles={handleOpenProfiles}
            onOpenGlobalSearch={globalSearchEnabled ? handleOpenGlobalSearch : undefined}
            onOpenSettings={handleOpenSettings}
            onOpenTunnels={handleOpenTunnels}
            onOpenDirSyncProfiles={() => openTopLevelModal(() => setDirSyncProfilesOpen(true))}
            showLockSmartcardButton={settings.smartcardAuthMode === 'agent-global'}
            onLockSmartcard={() => window.multissh?.smartcardLockAll() ?? Promise.resolve({ locked: 0 })}
            onUnlockSmartcard={() => window.multissh?.smartcardUnlockNow?.() ?? Promise.resolve({ started: false })}
            onListCachedSmartcards={() => window.multissh?.smartcardListCached() ?? Promise.resolve([])}
            shortcuts={settings.shortcuts}
          />
        </div>
      </header>

      {/* Main Content Area: non-active tabs stay mounted with display: none */}
      <main
        onMouseDownCapture={() => setTabBarFocused(false)}
        className="relative flex flex-1 w-full overflow-hidden bg-app"
      >
        {!sessionLoaded ? null : (
          <>
        {(tabs.length === 0 || activeTabId === '') && (
          <LandingView
            recentSSH={recentSSH}
            allSSH={recentSSHProfiles}
            onConnectRecentSSH={handleConnectRecentSSH}
            onConnectSFTP={handleConnectSFTP}
            onQuickStartTerminal={handleQuickStartTerminal}
            onNewTab={handleNewTab}
            onOpenProfiles={handleOpenProfiles}
            onNewProfile={handleNewProfile}
            onOpenSyncBootstrap={() => setSyncBootstrapModalOpen(true)}
            onNavigateToTabBar={() => setTabBarFocused(true)}
            onQuickConnectSSH={(config) => {
              const newId = `term-${Date.now()}`;
              const newTab: AppTab = {
                id: newId,
                type: 'terminal',
                title: config.name,
                paneTree: createLeaf(`${newId}-root`, { config }),
              };
              setTabs((prev) => [...prev, newTab]);
              setActiveTabId(newId);
            }}
            shortcuts={settings.shortcuts}
          />
        )}
        {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const totalPanes = tab.type === 'terminal' && tab.paneTree ? countLeaves(tab.paneTree) : 1;
            const rootLeaf =
              tab.type === 'terminal' && tab.paneTree ? findLeaf(tab.paneTree, getFirstLeafId(tab.paneTree)) : null;

            return (
              <div
                key={tab.id}
                id={`tab-panel-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`tab-button-${tab.id}`}
                data-testid={`tab-panel-${tab.id}`}
                className={`h-full w-full ${isActive ? 'flex flex-1 flex-col' : 'hidden'}`}
                style={{ display: isActive ? 'flex' : 'none', flexDirection: 'column' }}
              >
                {tab.type === 'terminal' && tab.paneTree ? (
                  <div className="flex flex-1 flex-col h-full w-full overflow-hidden">
                    {/* Top Pane Bar with status and quick "unsplit" action. For a single pane without
                        connection details it only repeated the tab and pane-header names, so skip it. */}
                    {(totalPanes > 1 ||
                      rootLeaf?.config?.username ||
                      rootLeaf?.k8sTarget ||
                      rootLeaf?.k8sLogTarget) && (
                    <div className="flex h-6 shrink-0 items-center justify-between border-b border-divider bg-app-surface-subtle px-2.5 text-xs text-txt-secondary">
                      <div className="flex items-center gap-2 truncate">
                        <Terminal className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                        {/* A single pane already shows its name in the pane header; only name the split view. */}
                        {totalPanes > 1 && (
                          <span className="truncate font-medium text-txt-primary">
                            {`Split view (${totalPanes} panes)`}
                          </span>
                        )}
                        {totalPanes === 1 && rootLeaf?.config?.username && (
                          <span className="text-xs text-txt-muted select-text">
                            ({rootLeaf.config.username}@{rootLeaf.config.host}:{rootLeaf.config.port ?? 22})
                          </span>
                        )}
                        {totalPanes === 1 && (rootLeaf?.k8sTarget || rootLeaf?.k8sLogTarget) && (
                          <span className="text-xs text-txt-muted select-text">
                            ({(rootLeaf.k8sTarget || rootLeaf.k8sLogTarget)!.namespace} ·{' '}
                            {(rootLeaf.k8sTarget || rootLeaf.k8sLogTarget)!.contextName})
                          </span>
                        )}
                      </div>

                      {totalPanes > 1 && (
                        <div className="flex items-center gap-1">
                          <UnsplitButton
                            tabId={tab.id}
                            paneTree={tab.paneTree}
                            activePaneId={tab.activePaneId}
                            onUnsplit={handleUnsplit}
                          />
                        </div>
                      )}
                    </div>
                    )}

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
                        onResizeSplit={(splitId, weights) => handleResizeSplit(tab.id, splitId, weights)}
                        onClosePane={(paneId) => handleClosePane(tab.id, paneId)}
                        zoomedPaneId={tab.zoomedPaneId}
                        onToggleZoom={(paneId) => handleToggleZoom(tab.id, paneId)}
                        onChangeConnection={(paneId) => setConnectTarget({ tabId: tab.id, paneId })}
                        onOpenLocalTerminal={(paneId, shellType, wslDistro) =>
                          handleOpenLocalTerminal({ tabId: tab.id, paneId }, shellType, wslDistro)
                        }
                        onCloseTab={() => handleCloseTab(tab.id)}
                        onTitleChange={(paneId, title) => handlePaneTitleChange(tab.id, paneId, title)}
                        onOpenRemotePath={handleOpenRemotePath}
                        onOpenLocalPath={handleOpenLocalPath}
                        onNavigateToTabBar={() => setTabBarFocused(true)}
                        initialCwdPaneId={rootLeaf?.id}
                        initialCwd={tab.initialCwd}
                      />
                    </div>
                  </div>
                ) : tab.type === 'editor' ? (
                  <div data-testid={`editor-panel-${tab.id}`} className="flex min-h-0 flex-1 flex-col">
                    {tab.editorEntry && (
                      <FileEditorModal
                        open={true}
                        embedded={true}
                        providerId={tab.editorProviderId || 'local'}
                        sourceType={tab.editorSourceType || 'local'}
                        entry={tab.editorEntry}
                        initialMode={tab.editorInitialMode}
                        isTailMode={tab.editorTailMode}
                        initialContentOverride={tab.editorInitialContent}
                        onDirtyChange={(dirty) => handleUpdateTabDirty(tab.id, dirty)}
                        onClose={() => handleCloseTab(tab.id)}
                      />
                    )}
                  </div>
                ) : (
                  <div data-testid={`filemanager-panel-${tab.id}`} className="flex min-h-0 flex-1 flex-col">
                    <DualPaneExplorer
                      onOpenTerminal={handleOpenTerminalAt}
                      onOpenK8sTerminal={handleOpenK8sTerminalAt}
                      shortcuts={settings.shortcuts}
                      tabId={tab.id}
                      restoredPanes={tab.restoredPanes}
                      initialK8sTarget={tab.initialK8sTarget}
                      initialSSHConfig={tab.initialSSHConfig}
                      initialS3Config={tab.initialS3Config}
                      promptRemote={tab.promptRemote}
                      initialLocalPath={tab.initialLocalPath}
                      initialSelectedPath={tab.initialSelectedPath}
                      showHiddenFiles={settings.showHiddenFiles ?? false}
                      onToggleHiddenFiles={handleToggleHiddenFiles}
                      gitIntegrationEnabled={settings.fileManagerGitIntegration ?? true}
                    />
                  </div>
                )}
              </div>
            );
          })}
          </>
        )}
      </main>

      <GlobalOverlays />
      <AppNotice message={notice} onDismiss={dismissNotice} />

      {/* Per-tab or per-pane: pick an SSH profile to connect */}
      <ConnectionManagerModal
        open={connectTarget !== null}
        initialTab="ssh"
        dotfilesPoolEnabled={settings.dotfilesPoolEnabled ?? false}
        enableOpenShift={settings.enableOpenShift ?? false}
        shareFoldersAcrossTypes={settings.shareFoldersAcrossTypes ?? false}
        onClose={() => setConnectTarget(null)}
        onConnectSSH={(config) => {
          if (connectTarget) handleConnectTerminal(connectTarget, config);
        }}
        onConnectSFTP={handleConnectSFTP}
        onConnectK8s={(target) => {
          if (connectTarget) handleConnectK8sTerminal(connectTarget, target);
        }}
        onViewK8sLogs={handleViewK8sLogs}
      />

      {/* Quick-link / Top Bar / Ctrl+Shift+O: manage or connect to saved SSH/S3 profiles */}
      <ConnectionManagerModal
        open={profilesModalOpen}
        initialTab={profilesModalTab}
        startNewProfile={profilesModalNew}
        dotfilesPoolEnabled={settings.dotfilesPoolEnabled ?? false}
        enableOpenShift={settings.enableOpenShift ?? false}
        shareFoldersAcrossTypes={settings.shareFoldersAcrossTypes ?? false}
        onClose={() => {
          setProfilesModalOpen(false);
          setProfilesModalNew(false);
        }}
        onConnectSSH={handleOpenSSHInTab}
        onConnectSFTP={handleConnectSFTP}
        onConnectS3={handleConnectS3}
        onConnectSystem={(members, source) => void handleConnectSystem(members, source)}
        onConnectK8s={handleOpenK8sInTab}
        onViewK8sLogs={handleViewK8sLogs}
        onBrowseK8sFiles={handleBrowseK8sFiles}
      />

      {/* Ctrl+Shift+G / top bar: find a profile, tab or user@host and go to it */}
      {globalSearchOpen && globalSearchEnabled && (
        <GlobalSearchPalette
          tabs={tabs}
          onClose={() => setGlobalSearchOpen(false)}
          onConnectSSH={handleOpenSSHInTab}
          onOpenSFTP={handleConnectSFTP}
          onConnectS3={handleConnectS3}
          onSelectTab={handleSelectTab}
          onOpenConnectionManager={handleOpenProfiles}
          shortcuts={settings.shortcuts}
          onRunAction={handleRunGlobalAction}
          onConnectSystem={(members, source) => void handleConnectSystem(members, source)}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        open={settingsModalOpen}
        initialCategory={settingsCategory}
        currentSettings={settings}
        onSave={handleSaveSettings}
        onClose={() => setSettingsModalOpen(false)}
      />

      {/* SSH Tunnels Modal (global, across all connections) */}
      <SSHGlobalTunnelsModal open={tunnelsModalOpen} onClose={() => setTunnelsModalOpen(false)} />

      <SyncBootstrapModal
        open={syncBootstrapModalOpen}
        onClose={() => setSyncBootstrapModalOpen(false)}
        onComplete={handleSyncBootstrapComplete}
      />

      {/* Saved directory-sync profiles: "Run" always jumps to a fresh diff review, never straight to applying */}
      <DirSyncSavedProfilesModal
        open={dirSyncProfilesOpen}
        onClose={() => setDirSyncProfilesOpen(false)}
        onRun={(profile) => {
          setDirSyncProfilesOpen(false);
          setDirSyncRunProfile(profile);
        }}
      />
      <DirectorySyncModal
        open={dirSyncRunProfile !== null}
        onClose={() => setDirSyncRunProfile(null)}
        runProfile={dirSyncRunProfile}
      />
    </div>
  );
};

/** The provider sits outside AppContent so the hooks in AppContent can ask for confirmations too. */
export const App: React.FC = () => (
  <ConfirmProvider>
    <AppContent />
  </ConfirmProvider>
);

export default App;
