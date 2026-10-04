import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, Cloud, Columns2, Folder, Plus, Rows2, Server, Square, Terminal } from 'lucide-react';
import { SftpButton } from './components/SftpButton';
import { TabBar, type TabItem, type TabType } from './components/TabBar';
import { BrandLogo } from './components/BrandLogo';
import { PaneTreeView } from './components/PaneTree';
import { SmartcardPinModal } from './components/SmartcardPinModal';
import { TouchPresenceBanner } from './components/TouchPresenceBanner';
import { HostKeyTrustModal } from './components/HostKeyTrustModal';
import { AwsSsoLoginModal } from './components/AwsSsoLoginModal';
import { TransferConflictModal } from './components/TransferConflictModal';
import { QuitConfirmBridge } from './components/QuitConfirmBridge';
import { ConfirmProvider } from './components/ConfirmDialog';
import { DotfilesSyncBanner } from './components/DotfilesSyncBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { CredentialEncryptionWarningBanner } from './components/CredentialEncryptionWarningBanner';
import { SmartcardStartupUnlockBanner } from './components/SmartcardStartupUnlockBanner';
import { DualPaneExplorer } from './components/FileManager/DualPaneExplorer';
import { DirSyncSavedProfilesModal } from './components/FileManager/DirSyncSavedProfilesModal';
import { DirectorySyncModal } from './components/FileManager/DirectorySyncModal';
import { ConnectionManagerModal, type Tab as ConnectionManagerTab } from './components/ConnectionModal/ConnectionManagerModal';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { SyncBootstrapModal } from './components/SettingsModal/SyncBootstrapModal';
import { SSHGlobalTunnelsModal } from './components/SSH/SSHGlobalTunnelsModal';
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, type AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig, LocalShellType } from '@shared/types/ssh';
import type { PaneNode, PaneOrientation } from '@shared/types/session';
import type { K8sTerminalTarget } from '@shared/types/kubernetes';
import type { DirectorySyncProfile } from '@shared/types/dirsync';
import { formatDateTime } from './lib/format';
import {
  closePane,
  collectLeafIds,
  countLeaves,
  createLeaf,
  findLeaf,
  getFirstLeafId,
  splitPane,
  updateLeaf,
} from './lib/paneTree';
import { extractHostnameFromTitle, isSameHost } from './lib/terminalTitle';
import { comboFromKeyboardEvent } from './lib/shortcuts';
import { Kbd } from './components/ui/Kbd';

export interface AppTab extends TabItem {
  /** Terminal tabs always carry a pane tree, even when it's a single leaf. */
  paneTree?: PaneNode;
  /** The pane the user last interacted with; keyboard shortcuts (split/close) target this pane. */
  activePaneId?: string;
  initialCwd?: string;
  /** Set when opening a filemanager tab focused on a K8s container. */
  initialK8sTarget?: K8sTerminalTarget;
  /** Set when opening a filemanager tab focused on an SSH/SFTP profile. */
  initialSSHConfig?: SSHConnectionConfig;
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

function sanitizePaneNode(node: PaneNode): PaneNode {
  if (node.type === 'leaf') {
    if (!node.config) return node;
    const { password: _password, passphrase: _passphrase, ...restConfig } = node.config;
    return {
      ...node,
      config: restConfig,
    };
  }
  if (node.type === 'split' && Array.isArray(node.children)) {
    return {
      ...node,
      children: node.children.map(sanitizePaneNode),
    };
  }
  return node;
}

function sanitizeTabForSession(tab: AppTab): AppTab {
  if (!tab.paneTree) return tab;
  return {
    ...tab,
    paneTree: sanitizePaneNode(tab.paneTree),
  };
}

export const App: React.FC = () => {
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
  const [syncBootstrapModalOpen, setSyncBootstrapModalOpen] = useState(false);
  const [dirSyncProfilesOpen, setDirSyncProfilesOpen] = useState(false);
  const [tunnelsModalOpen, setTunnelsModalOpen] = useState(false);
  // Design audit Phase 1: Connection Manager, Settings, Tunnels and Dir Sync
  // are independent toggles that used to be able to open simultaneously
  // (e.g. Settings opened from the toolbar while Connection Manager was
  // still open, stacking two full-screen modals). Route every "open" call
  // for these four through here so opening one always closes the others.
  const openTopLevelModal = (open: () => void) => {
    setProfilesModalOpen(false);
    setSettingsModalOpen(false);
    setTunnelsModalOpen(false);
    setDirSyncProfilesOpen(false);
    open();
  };
  // UX audit finding #4: these four full-screen modals render as `fixed`
  // overlays, but the header behind them (tab bar, "+" new-tab menu, toolbar
  // icons) stayed in the normal tab/click order — you could open the "+"
  // dropdown on top of an already-open Connection Manager modal. `inert`
  // (native DOM, not React-typed pre-19) removes the header from hit-testing
  // and keyboard focus entirely while any of the four is open.
  const anyTopLevelModalOpen =
    profilesModalOpen || settingsModalOpen || tunnelsModalOpen || dirSyncProfilesOpen;
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current as (HTMLElement & { inert?: boolean }) | null;
    if (el) el.inert = anyTopLevelModalOpen;
  }, [anyTopLevelModalOpen]);
  const [dirSyncRunProfile, setDirSyncRunProfile] = useState<DirectorySyncProfile | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [connectTarget, setConnectTarget] = useState<{ tabId: string; paneId?: string } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
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
        tabs: tabs.map(sanitizeTabForSession),
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
  const isBreeze = settings.theme === 'breeze';

  useEffect(() => {
    // index.html ships with a static class="dark" (so the window isn't
    // unstyled before this runs). Toggling theme classes ensures they remain
    // mutually exclusive on <html>.
    document.documentElement.classList.toggle('breeze', isBreeze);
    document.documentElement.classList.toggle('light', isLight);
    document.documentElement.classList.toggle('dark', !isLight && !isBreeze);
  }, [isLight, isBreeze]);

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
            const m = t.title.match(/File Manager\s+(\d+)/);
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
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId || t.type !== 'terminal' || !t.paneTree) return t;
        const leaf = findLeaf(t.paneTree, paneId);
        const baseTitle =
          leaf?.config?.name ||
          (leaf?.local
            ? leaf.shellType === 'wsl'
              ? leaf.wslDistro
                ? `WSL: ${leaf.wslDistro}`
                : 'WSL'
              : 'Local Shell'
            : t.title);
        const title = leaf?.dynamicHost || baseTitle || t.title;
        return { ...t, activePaneId: paneId, title };
      })
    );
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
          baseHost: config.host,
          dynamicHost: undefined,
        }));
        const leavesCount = countLeaves(paneTree);
        const isDefaultTitle = !t.title || /^Terminal\s+\d+$/.test(t.title);
        const title = isDefaultTitle || leavesCount <= 1 ? config.name : t.title;
        return { ...t, paneTree, title };
      })
    );
    setConnectTarget(null);
  };

  const handleConnectK8sTerminal = (
    target: { tabId: string; paneId?: string },
    k8sTarget: K8sTerminalTarget
  ) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== target.tabId || t.type !== 'terminal' || !t.paneTree) return t;
        const paneId = target.paneId ?? getFirstLeafId(t.paneTree);
        const paneTree = updateLeaf(t.paneTree, paneId, (leaf) => ({
          ...leaf,
          config: undefined,
          local: false,
          shellType: undefined,
          k8sTarget,
          baseHost: `${k8sTarget.podName}/${k8sTarget.containerName}`,
          dynamicHost: undefined,
        }));
        const leavesCount = countLeaves(paneTree);
        const isDefaultTitle = !t.title || /^Terminal\s+\d+$/.test(t.title);
        const title = isDefaultTitle || leavesCount <= 1 ? k8sTarget.podName : t.title;
        return { ...t, paneTree, title };
      })
    );
    setConnectTarget(null);
  };

  const handleViewK8sLogs = useCallback((k8sLogTarget: K8sTerminalTarget) => {
    const newId = `term-${Date.now()}`;
    const newTab: AppTab = {
      id: newId,
      type: 'terminal',
      title: `Logs: ${k8sLogTarget.podName}`,
      paneTree: createLeaf(`${newId}-root`, { k8sLogTarget }),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, []);

  const handleOpenLocalTerminal = useCallback(
    (target: { tabId: string; paneId?: string }, shellType?: LocalShellType, wslDistro?: string) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== target.tabId || t.type !== 'terminal' || !t.paneTree) return t;
          const paneId = target.paneId ?? getFirstLeafId(t.paneTree);
          const baseHost = localHostname || undefined;
          const paneTree = updateLeaf(t.paneTree, paneId, (leaf) => ({
            ...leaf,
            config: undefined,
            local: true,
            shellType,
            wslDistro,
            baseHost,
            dynamicHost: undefined,
          }));
          const defaultTitle =
            shellType === 'wsl'
              ? wslDistro
                ? `WSL: ${wslDistro}`
                : 'WSL'
              : 'Local Shell';
          const leavesCount = countLeaves(paneTree);
          const isDefaultTitle = !t.title || /^Terminal\s+\d+$/.test(t.title);
          const title = isDefaultTitle || leavesCount <= 1 ? defaultTitle : t.title;
          return { ...t, paneTree, title };
        })
      );
    },
    [localHostname]
  );

  const handlePaneTitleChange = useCallback(
    async (tabId: string, paneId: string, rawTitle: string) => {
      const host = extractHostnameFromTitle(rawTitle);
      if (!host && rawTitle !== '__EXIT__') return;

      let activeLocalHostname = localHostname;
      if (!activeLocalHostname && window.multissh?.getHostname) {
        try {
          activeLocalHostname = (await window.multissh.getHostname()) || '';
        } catch {
          activeLocalHostname = '';
        }
      }

      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId || t.type !== 'terminal' || !t.paneTree) return t;
          const leaf = findLeaf(t.paneTree, paneId);
          if (!leaf) return t;

          const baseTitle =
            leaf.config?.name ||
            (leaf.local
              ? leaf.shellType === 'wsl'
                ? leaf.wslDistro
                  ? `WSL: ${leaf.wslDistro}`
                  : 'WSL'
                : 'Local Shell'
              : 'Terminal');

          // User typed exit, logout, or pressed Ctrl+D
          if (rawTitle === '__EXIT__') {
            if (!leaf.dynamicHost) return t;
            const updatedTree = updateLeaf(t.paneTree, paneId, (l) => ({
              ...l,
              dynamicHost: undefined,
            }));
            const isSoleOrActive = countLeaves(t.paneTree) === 1 || t.activePaneId === paneId;
            const nextTitle = isSoleOrActive ? baseTitle : t.title;
            return { ...t, paneTree: updatedTree, title: nextTitle };
          }

          if (!host) return t;

          const effectiveBaseHost =
            leaf.baseHost || (leaf.local ? (activeLocalHostname || 'localhost') : leaf.config?.host);

          // Check if current host is the base host
          const isBase =
            (Boolean(effectiveBaseHost) && isSameHost(host, effectiveBaseHost)) ||
            (Boolean(leaf.config?.host) && isSameHost(host, leaf.config!.host)) ||
            (Boolean(activeLocalHostname) && isSameHost(host, activeLocalHostname)) ||
            isSameHost(host, baseTitle) ||
            isSameHost(host, 'localhost') ||
            isSameHost(host, '127.0.0.1');

          const nextDynamicHost = isBase ? undefined : host;
          if (leaf.dynamicHost === nextDynamicHost) return t;

          const updatedTree = updateLeaf(t.paneTree, paneId, (l) => ({
            ...l,
            baseHost: effectiveBaseHost,
            dynamicHost: nextDynamicHost,
          }));

          const isSoleOrActive = countLeaves(t.paneTree) === 1 || t.activePaneId === paneId;
          const nextTitle = isSoleOrActive ? (nextDynamicHost || baseTitle) : t.title;

          return { ...t, paneTree: updatedTree, title: nextTitle };
        })
      );
    },
    [localHostname]
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

  const handleOpenK8sTerminalAt = useCallback((target: K8sTerminalTarget, folderPath: string) => {
    const newId = `term-${Date.now()}`;
    const shellCommand = folderPath && folderPath !== '/' ? `cd ${JSON.stringify(folderPath)} && exec /bin/sh` : undefined;
    const newTab: AppTab = {
      id: newId,
      type: 'terminal',
      title: target.podName,
      paneTree: createLeaf(`${newId}-root`, {
        k8sTarget: shellCommand ? { ...target, shell: shellCommand } : target,
      }),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, []);

  const handleBrowseK8sFiles = useCallback((target: K8sTerminalTarget) => {
    const newId = `fm-${Date.now()}`;
    const newTab: AppTab = {
      id: newId,
      type: 'filemanager',
      title: `${target.podName} (${target.containerName})`,
      initialK8sTarget: target,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
    setProfilesModalOpen(false);
  }, []);

  const handleConnectSFTP = useCallback((config: SSHConnectionConfig) => {
    const newId = `fm-${Date.now()}`;
    const newTab: AppTab = {
      id: newId,
      type: 'filemanager',
      title: `${config.name} (SFTP)`,
      initialSSHConfig: config,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
    setProfilesModalOpen(false);
    setConnectTarget(null);
  }, []);

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

  // UX audit finding #3: clicking this landing-page card used to create an
  // empty, unconnected leaf — landing on a "No connection selected for this
  // tab" screen that then needed a second click ("Open Local Terminal") for
  // what the card itself frames as the single most common action. Open a
  // local shell immediately instead, same as that second click would have
  // done. Ctrl+Shift+T and the "+" menu's "New Terminal" keep the original
  // unconnected-tab behavior (tab-number reuse relies on it being possible
  // to have a placeholder "Terminal N" tab open).
  const handleQuickStartTerminal = useCallback(() => {
    const newId = `term-${Date.now()}`;
    const newTab: AppTab = {
      id: newId,
      type: 'terminal',
      title: 'Local Shell',
      paneTree: createLeaf(`${newId}-root`, { local: true, baseHost: localHostname || undefined }),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, [localHostname]);

  const handleConnectRecentSSH = useCallback((profile: SSHConnectionConfig) => {
    const updated = { ...profile, lastUsedAt: formatDateTime(new Date()) };
    void window.multissh?.profilesSaveSSH?.(updated).catch(() => {});
    const newId = `term-${Date.now()}`;
    const newTab: AppTab = {
      id: newId,
      type: 'terminal',
      title: updated.name,
      paneTree: createLeaf(`${newId}-root`, { config: updated }),
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }, []);

  const handleOpenProfiles = () => {
    setProfilesModalTab('ssh');
    openTopLevelModal(() => setProfilesModalOpen(true));
  };

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

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    void window.multissh.settingsSave?.(newSettings);
  };

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // xterm.js captures keyboard input via a hidden <textarea class="xterm-helper-textarea">
      // inside every terminal pane. Treating it as a real input field would swallow every
      // app-level shortcut (tab switching, split, etc.) whenever a terminal has focus, which
      // is effectively always — so it's explicitly excluded from the "is a text field" check.
      const isInput =
        target &&
        !target.classList?.contains('xterm-helper-textarea') &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (isInput) return;

      // Quick Connect shortcut Ctrl+K (not Ctrl+Shift+K, which is a separate,
      // user-rebindable shortcut — see 'searchInFiles' below).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openTopLevelModal(() => setProfilesModalOpen(true));
        return;
      }

      const rawCombo = comboFromKeyboardEvent(e);
      if (rawCombo === null) return;
      const combo = rawCombo.toLowerCase();
      const normalizedCombo = combo.replace(/^cmd\+/, 'ctrl+');
      const activeShortcuts = { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) };

      for (const [actionId, keyBinding] of Object.entries(activeShortcuts)) {
        const bindingLower = keyBinding.toLowerCase();
        const isMatch =
          combo === bindingLower ||
          normalizedCombo === bindingLower ||
          (actionId === 'increaseFontSize' &&
            (bindingLower === 'ctrl++' || bindingLower === 'ctrl+=') &&
            (normalizedCombo === 'ctrl++' || normalizedCombo === 'ctrl+=' || normalizedCombo === 'ctrl+shift+=')) ||
          (actionId === 'decreaseFontSize' &&
            bindingLower === 'ctrl+-' &&
            (normalizedCombo === 'ctrl+-' || normalizedCombo === 'ctrl+shift+-'));

        if (isMatch) {
          e.preventDefault();
          e.stopPropagation();
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
              if (tabs.length > 1) {
                const idx = tabs.findIndex((t) => t.id === activeTabId);
                const currentIdx = idx >= 0 ? idx : 0;
                const nextIdx = (currentIdx + 1) % tabs.length;
                setActiveTabId(tabs[nextIdx].id);
              }
              break;
            }
            case 'prevTab': {
              if (tabs.length > 1) {
                const idx = tabs.findIndex((t) => t.id === activeTabId);
                const currentIdx = idx >= 0 ? idx : 0;
                const prevIdx = (currentIdx - 1 + tabs.length) % tabs.length;
                setActiveTabId(tabs[prevIdx].id);
              }
              break;
            }
            case 'openProfiles':
              openTopLevelModal(() => setProfilesModalOpen(true));
              break;
            case 'openSettings':
              openTopLevelModal(() => setSettingsModalOpen(true));
              break;
            case 'splitVertical':
              if (activeTabId) handleSplitPane(activeTabId, 'row');
              break;
            case 'splitHorizontal':
              if (activeTabId) handleSplitPane(activeTabId, 'column');
              break;
            case 'nextPane':
            case 'prevPane': {
              const activeTab = tabs.find((t) => t.id === activeTabId);
              if (!activeTab || activeTab.type !== 'terminal' || !activeTab.paneTree) break;
              const leafIds = collectLeafIds(activeTab.paneTree);
              if (leafIds.length < 2) break;
              const currentIdx = activeTab.activePaneId ? leafIds.indexOf(activeTab.activePaneId) : -1;
              const step = actionId === 'nextPane' ? 1 : -1;
              const nextIdx = currentIdx === -1 ? 0 : (currentIdx + step + leafIds.length) % leafIds.length;
              const nextPaneId = leafIds[nextIdx];
              handleSelectPane(activeTab.id, nextPaneId);
              document
                .querySelector<HTMLTextAreaElement>(
                  `[data-testid="terminal-pane-${nextPaneId}"] .xterm-helper-textarea`
                )
                ?.focus();
              break;
            }
            case 'increaseFontSize': {
              setSettings((prev) => {
                const current = prev.terminalFontSize || DEFAULT_SETTINGS.terminalFontSize;
                const next = Math.min(current + 1, 32);
                if (next === current) return prev;
                const updated = { ...prev, terminalFontSize: next };
                void window.multissh?.settingsSave?.(updated);
                return updated;
              });
              break;
            }
            case 'decreaseFontSize': {
              setSettings((prev) => {
                const current = prev.terminalFontSize || DEFAULT_SETTINGS.terminalFontSize;
                const next = Math.max(current - 1, 8);
                if (next === current) return prev;
                const updated = { ...prev, terminalFontSize: next };
                void window.multissh?.settingsSave?.(updated);
                return updated;
              });
              break;
            }
            case 'resetFontSize': {
              setSettings((prev) => {
                const defaultSize = DEFAULT_SETTINGS.terminalFontSize;
                if (prev.terminalFontSize === defaultSize) return prev;
                const updated = { ...prev, terminalFontSize: defaultSize };
                void window.multissh?.settingsSave?.(updated);
                return updated;
              });
              break;
            }
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [tabs, activeTabId, settings.shortcuts, handleNewTab, handleCloseTab, handleSplitPane, handleSelectPane]);

  return (
    <ConfirmProvider>
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-app text-txt-primary">
      {/* Top Bar with Brand, TabBar, and Quick Connect. select-none here only
          (not on the whole app, see UX review #5) so tab titles, toolbar
          icons etc. don't show a text cursor/selection highlight, while
          file names, hostnames and other content below stays selectable. */}
      <header
        ref={headerRef}
        className="flex h-10 shrink-0 items-center border-b border-border-subtle bg-app-surface select-none"
      >
        {/* Clicking the brand shows the landing page again; tabs stay open and mounted (no tab is active). */}
        <button
          type="button"
          title="Home"
          onClick={() => setActiveTabId('')}
          className="flex items-center gap-2.5 border-r border-border-subtle px-3.5 font-semibold text-sm hover:bg-app-surface-hover transition-colors"
        >
          <BrandLogo className="h-5 w-auto" />
          <span className="font-bold tracking-wide">
            <span className="text-txt-primary">ssh</span>
            <span className="text-[#EAB308]">S3</span>
          </span>
        </button>

        {/* TabBar */}
        <div className="flex-1 min-w-0">
          {/* LOW finding (code review): window.multissh! throws if the preload
              bridge is somehow missing, unlike the otherwise-consistent
              window.multissh?.x pattern used everywhere else in this file —
              the two callbacks below degrade gracefully instead (no cached
              agents / nothing locked) rather than crashing the tab bar. */}
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onNewTab={handleNewTab}
            onNewK8sSession={handleNewK8sSession}
            onOpenProfiles={handleOpenProfiles}
            onOpenSettings={handleOpenSettings}
            onOpenTunnels={handleOpenTunnels}
            onOpenDirSyncProfiles={() => openTopLevelModal(() => setDirSyncProfilesOpen(true))}
            showLockSmartcardButton={settings.smartcardAuthMode === 'agent-global'}
            onLockSmartcard={() => window.multissh?.smartcardLockAll() ?? Promise.resolve({ locked: 0 })}
            onListCachedSmartcards={() => window.multissh?.smartcardListCached() ?? Promise.resolve([])}
          />
        </div>
      </header>

      {/* Main Content Area: non-active tabs stay mounted with display: none */}
      <main className="relative flex flex-1 w-full overflow-hidden bg-app">
        {!sessionLoaded ? null : (
          <>
        {(tabs.length === 0 || activeTabId === '') && (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-txt-secondary animate-in fade-in duration-200">
            <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-6">
              {/* Brand Header — smaller once there's real usage history to
                  show instead (UX audit finding #14): the onboarding-sized
                  logo/tagline made sense on a first run, not on the
                  thousandth time this screen shows up between tabs. */}
              <div className="flex flex-col items-center space-y-3">
                <BrandLogo className={recentSSH.length > 0 ? 'h-20 w-auto' : 'h-32 w-auto'} />
                <h1
                  className={
                    recentSSH.length > 0
                      ? 'text-base font-bold tracking-tight'
                      : 'text-3xl font-extrabold tracking-tight'
                  }
                >
                  <span className="text-txt-primary">ssh</span>
                  <span className="text-[#EAB308]">S3</span>
                </h1>
                {recentSSH.length === 0 && (
                  <p className="text-xs text-txt-muted max-w-md">
                    Multi-session SSH & SFTP client with dual-pane file management, Kubernetes support and cloud sync.
                  </p>
                )}
              </div>

              {/* Recent Connections — reuses the same lastUsedAt tracking
                  Connection Manager's own "Recently Used" section shows, so
                  getting back to what you were doing doesn't require opening
                  that modal first. */}
              {recentSSH.length > 0 && (
                <div className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5 text-left">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Recent Connections</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {recentSSH.map((profile) => (
                      <div
                        key={profile.id}
                        onDoubleClick={() => handleConnectRecentSSH(profile)}
                        title="Double-click to connect"
                        className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-card px-3 py-1.5 hover:border-border-default transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-txt-primary">{profile.name}</div>
                          <div className="truncate text-xs text-txt-muted">
                            {profile.username}@{profile.host}:{profile.port ?? 22}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConnectRecentSSH(profile);
                            }}
                            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                          >
                            Connect
                          </button>
                          <SftpButton authType={profile.authType} onOpen={() => handleConnectSFTP(profile)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Cards — demoted to a slim icon row once Recent
                  Connections above is doing the primary job this screen
                  needs to do; full-sized only for a first run with no
                  history yet. */}
              {recentSSH.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 w-full text-left">
                  <button
                    type="button"
                    onClick={handleQuickStartTerminal}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2.5 py-2 hover:border-sky-500/40 hover:bg-app-surface-hover transition-all"
                  >
                    <Terminal className="h-4 w-4 text-sky-400 shrink-0" />
                    <span className="truncate text-xs font-medium text-txt-primary">New Terminal</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNewTab('filemanager')}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2.5 py-2 hover:border-amber-500/40 hover:bg-app-surface-hover transition-all"
                  >
                    <Folder className="h-4 w-4 text-amber-400 shrink-0" />
                    <span className="truncate text-xs font-medium text-txt-primary">File Manager</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenProfiles}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2.5 py-2 hover:border-emerald-500/40 hover:bg-app-surface-hover transition-all"
                  >
                    <Server className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="truncate text-xs font-medium text-txt-primary">Connections</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncBootstrapModalOpen(true)}
                    className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2.5 py-2 hover:border-purple-500/40 hover:bg-app-surface-hover transition-all"
                  >
                    <Cloud className="h-4 w-4 text-purple-400 shrink-0" />
                    <span className="truncate text-xs font-medium text-txt-primary">Cloud Sync</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNewProfile}
                    className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-2 hover:bg-sky-500/20 transition-all"
                  >
                    <Plus className="h-4 w-4 text-sky-400 shrink-0" />
                    <span className="truncate text-xs font-medium text-txt-primary">New Profile</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
                  <button
                    type="button"
                    onClick={handleQuickStartTerminal}
                    className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-sky-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between w-full">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 group-hover:bg-sky-500/25 group-hover:scale-105 transition-all">
                        <Terminal className="h-5 w-5" />
                      </div>
                      <Kbd>Ctrl+Shift+T</Kbd>
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-txt-primary group-hover:text-sky-400 transition-colors">
                        Open New Terminal
                      </div>
                      <div className="text-xs text-txt-muted mt-0.5">
                        Launch a local shell — pick a saved connection or type user@host for SSH
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNewTab('filemanager')}
                    className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-amber-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between w-full">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 group-hover:scale-105 transition-all">
                        <Folder className="h-5 w-5" />
                      </div>
                      <Kbd>Ctrl+Shift+F</Kbd>
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-txt-primary group-hover:text-amber-400 transition-colors">
                        New File Manager
                      </div>
                      <div className="text-xs text-txt-muted mt-0.5">
                        Dual-pane explorer for SFTP, S3 and local drives
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenProfiles}
                    className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-emerald-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between w-full">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500/25 group-hover:scale-105 transition-all">
                        <Server className="h-5 w-5" />
                      </div>
                      <Kbd>Ctrl+Shift+P</Kbd>
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-txt-primary group-hover:text-emerald-400 transition-colors">
                        Saved Connections
                      </div>
                      <div className="text-xs text-txt-muted mt-0.5">
                        Manage profiles, SSH keys and credentials
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSyncBootstrapModalOpen(true)}
                    className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-purple-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between w-full">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400 group-hover:bg-purple-500/25 group-hover:scale-105 transition-all">
                        <Cloud className="h-5 w-5" />
                      </div>
                      <span className="rounded border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-2xs font-medium text-purple-400">
                        Cloud Sync
                      </span>
                    </div>
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-txt-primary group-hover:text-purple-400 transition-colors">
                        Import / Cloud Sync
                      </div>
                      <div className="text-xs text-txt-muted mt-0.5">
                        Restore configuration and profiles from cloud storage
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleNewProfile}
                    className="sm:col-span-2 flex items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-xs font-semibold text-txt-primary hover:bg-sky-500/20 transition-all"
                  >
                    <Plus className="h-4 w-4 text-sky-400" />
                    New Profile
                  </button>
                </div>
              )}

              {/* Keyboard shortcuts reminder */}
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-txt-muted pt-2 border-t border-border-subtle/50 w-full">
                <span><Kbd variant="plain">Ctrl+Tab</Kbd> Cycle tabs</span>
                <span><Kbd variant="plain">Ctrl+W</Kbd> Close tab</span>
                <span><Kbd variant="plain">Ctrl+,</Kbd> Settings</span>
              </div>
            </div>
          </div>
        )}
        {tabs.map((tab) => {
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
                    {/* Top Pane Bar with status and quick "unsplit" action. For a single pane without
                        connection details it only repeated the tab and pane-header names, so skip it. */}
                    {(totalPanes > 1 ||
                      rootLeaf?.config?.username ||
                      rootLeaf?.k8sTarget ||
                      rootLeaf?.k8sLogTarget) && (
                    <div className="flex h-6 shrink-0 items-center justify-between border-b border-border-subtle bg-app-surface-subtle px-2.5 text-xs text-txt-secondary">
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
                          <button
                            type="button"
                            title="Split horizontally (add pane below)"
                            onClick={() => handleSplitPane(tab.id, 'column', tab.activePaneId)}
                            className="flex items-center gap-1 rounded p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                          >
                            <Rows2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Split vertically (add pane to right)"
                            onClick={() => handleSplitPane(tab.id, 'row', tab.activePaneId)}
                            className="flex items-center gap-1 rounded p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                          >
                            <Columns2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Unsplit: close every other pane, keep only the active one"
                            data-testid={`unsplit-${tab.id}`}
                            onClick={() => handleUnsplit(tab.id)}
                            className="flex items-center gap-1 rounded p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                          >
                            <Square className="h-3.5 w-3.5" />
                          </button>
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
                        onClosePane={(paneId) => handleClosePane(tab.id, paneId)}
                        onChangeConnection={(paneId) => setConnectTarget({ tabId: tab.id, paneId })}
                        onOpenLocalTerminal={(paneId, shellType, wslDistro) =>
                          handleOpenLocalTerminal({ tabId: tab.id, paneId }, shellType, wslDistro)
                        }
                        onCloseTab={() => handleCloseTab(tab.id)}
                        onTitleChange={(paneId, title) => handlePaneTitleChange(tab.id, paneId, title)}
                        initialCwdPaneId={rootLeaf?.id}
                        initialCwd={tab.initialCwd}
                      />
                    </div>
                  </div>
                ) : (
                  <div data-testid={`filemanager-panel-${tab.id}`} className="flex min-h-0 flex-1 flex-col">
                    <DualPaneExplorer
                      onOpenTerminal={handleOpenTerminalAt}
                      onOpenK8sTerminal={handleOpenK8sTerminalAt}
                      shortcuts={settings.shortcuts}
                      initialK8sTarget={tab.initialK8sTarget}
                      initialSSHConfig={tab.initialSSHConfig}
                      showHiddenFiles={settings.showHiddenFiles ?? false}
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

      {/* Global Smartcard PIN Modal */}
      <SmartcardPinModal />

      {/* Global "touch your YubiKey/smartcard" banner */}
      <TouchPresenceBanner />

      {/* Global SFTP host key trust-on-first-use dialog */}
      <HostKeyTrustModal />

      {/* Global AWS SSO device-authorization login dialog */}
      <AwsSsoLoginModal />

      {/* Global transfer conflict (overwrite/skip/rename) dialog */}
      <TransferConflictModal />
      <QuitConfirmBridge />

      {/* Global dotfiles pool sync prompt (opt-in feature, see Settings) */}
      <DotfilesSyncBanner />

      {/* New-version notice (poll against GitHub Releases, user-driven download/install) */}
      <UpdateBanner />

      {/* Warns if saved credentials can't be OS-keyring-encrypted and are falling back to plaintext */}
      <CredentialEncryptionWarningBanner />

      {/* Surfaces a wrong/missing PIN from smartcardUnlockAtStartup, which otherwise fails silently */}
      <SmartcardStartupUnlockBanner />

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

      {/* Quick-link / Ctrl+K / Top Bar: manage or connect to saved SSH/S3 profiles */}
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
        onConnectSFTP={handleConnectSFTP}
        onConnectK8s={(target) => {
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab && activeTab.type === 'terminal' && isEmptyUnconnectedTab(activeTab)) {
            handleConnectK8sTerminal({ tabId: activeTab.id }, target);
          } else {
            const newId = `term-${Date.now()}`;
            const newTab: AppTab = {
              id: newId,
              type: 'terminal',
              title: target.podName,
              paneTree: createLeaf(`${newId}-root`, { k8sTarget: target }),
            };
            setTabs((prev) => [...prev, newTab]);
            setActiveTabId(newId);
          }
          setProfilesModalOpen(false);
        }}
        onViewK8sLogs={handleViewK8sLogs}
        onBrowseK8sFiles={handleBrowseK8sFiles}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsModalOpen}
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
    </ConfirmProvider>
  );
};

export default App;
