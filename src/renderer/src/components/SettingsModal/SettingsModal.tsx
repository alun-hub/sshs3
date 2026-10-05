import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useUpdateState } from '../../lib/useUpdateState';
import { metricApplies, PERF_METRIC_LABELS } from '../../lib/perfMetrics';
import {
  DEFAULT_PERF_ITEMS,
  PERF_INTERVALS_SEC,
  PERF_K8S_MIN_INTERVAL_SEC,
  PERF_METRIC_IDS,
  type PerfLayout,
  type PerfMetricId,
} from '@shared/types/perf';
import {
  Activity,
  Settings,
  X,
  Terminal,
  Monitor,
  Moon,
  Sun,
  Keyboard,
  Sliders,
  RotateCcw,
  Shield,
  FolderTree,
  Search,
  CheckCircle2,
  Lock,
  ShieldAlert,
  Globe,
  FileCode,
  RefreshCw,
  Play,
  Square,
  FolderOpen,
  Boxes,
  GitBranch,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  SHORTCUT_DEFINITIONS,
  DEFAULT_SHORTCUTS,
  type AppSettings,
  type AppTheme,
  type SessionExitAction,
  type SmartcardAuthMode,
} from '@shared/types/settings';
import { DEFAULT_K8S_DEBUG_IMAGES, type K8sDebugImage } from '@shared/types/kubernetes';
import type { DetectedSmartcardLib, XServerStatus } from '@shared/types/ssh';
import { DotfilePoolManagerModal } from './DotfilePoolManagerModal';
import { SyncSettingsPanel } from './SyncSettingsPanel';
import { GitSettingsPanel } from './GitSettingsPanel';
import { comboFromKeyboardEvent } from '../../lib/shortcuts';
import { useModalDismiss } from '../../lib/useModalDismiss';
import { IS_WINDOWS } from '../../lib/platform';
import { pkcs11LibDisplayName } from '../../lib/smartcard';
import { WindowsAgentPathNotice } from './WindowsAgentPathNotice';

interface SettingsModalProps {
  open: boolean;
  currentSettings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

interface FontPreset {
  label: string;
  value: string;
}

const FONT_PRESETS: FontPreset[] = [
  { label: 'JetBrains Mono (Bundled)', value: 'JetBrains Mono, monospace' },
  { label: 'Fira Code (Bundled)', value: 'Fira Code, monospace' },
  { label: 'Consolas (Windows)', value: 'Consolas, "Courier New", monospace' },
  { label: 'Menlo (macOS)', value: 'Menlo, Monaco, "Courier New", monospace, Consolas' },
  { label: 'Liberation Mono (Linux)', value: 'Liberation Mono, monospace' },
  { label: 'Ubuntu Mono (Linux)', value: 'Ubuntu Mono, monospace' },
  { label: 'System Default Monospace', value: 'monospace' },
];

type SettingsCategory = 'general' | 'terminal' | 'performance' | 'files' | 'security' | 'sync' | 'shortcuts' | 'kubernetes' | 'git';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  currentSettings,
  onSave,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [theme, setTheme] = useState<AppTheme>(currentSettings.theme);
  const [fontSize, setFontSize] = useState<number>(currentSettings.terminalFontSize);
  const [fontFamily, setFontFamily] = useState<string>(currentSettings.terminalFontFamily);
  const [cursorStyle, setCursorStyle] = useState<'block' | 'underline' | 'bar'>(
    currentSettings.terminalCursorStyle ?? 'block'
  );
  const [scrollback, setScrollback] = useState<number>(
    currentSettings.terminalScrollback ?? 5000
  );
  const [copyOnSelect, setCopyOnSelect] = useState<boolean>(
    currentSettings.copyOnSelect ?? false
  );
  const [clipboardScope, setClipboardScope] = useState<'global' | 'host'>(
    currentSettings.clipboardHistoryScope ?? 'global'
  );
  const [clipboardClearOnExit, setClipboardClearOnExit] = useState<boolean>(
    currentSettings.clipboardHistoryClearOnExit ?? false
  );
  const [perfEnabled, setPerfEnabled] = useState<boolean>(currentSettings.perfMetricsEnabled ?? false);
  const [perfLayout, setPerfLayout] = useState<PerfLayout>(currentSettings.perfMetricsLayout ?? 'text');
  const [perfItems, setPerfItems] = useState<PerfMetricId[]>(currentSettings.perfMetricsItems ?? DEFAULT_PERF_ITEMS);
  const [perfIntervalSec, setPerfIntervalSec] = useState<number>(currentSettings.perfMetricsIntervalSec ?? 5);
  const [sessionExitAction, setSessionExitAction] = useState<SessionExitAction>(
    currentSettings.sessionExitAction ?? 'reconnect'
  );
  const updateState = useUpdateState();
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(currentSettings.autoCheckUpdates ?? true);
  const [confirmBeforeQuit, setConfirmBeforeQuit] = useState<boolean>(
    currentSettings.confirmBeforeQuit ?? false
  );
  const [defaultNewTab, setDefaultNewTab] = useState<'terminal' | 'filemanager'>(
    currentSettings.defaultNewTabType
  );
  const [defaultConflictPolicy, setDefaultConflictPolicy] = useState<
    'ask' | 'overwrite' | 'skip' | 'rename'
  >(currentSettings.defaultConflictPolicy ?? 'ask');
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(
    currentSettings.showHiddenFiles ?? false
  );
  const [verifyTransferIntegrity, setVerifyTransferIntegrity] = useState<boolean>(
    currentSettings.verifyTransferIntegrity ?? true
  );
  const [shareFoldersAcrossTypes, setShareFoldersAcrossTypes] = useState<boolean>(
    currentSettings.shareFoldersAcrossTypes ?? false
  );
  const [confirmBeforeDelete, setConfirmBeforeDelete] = useState<boolean>(
    currentSettings.confirmBeforeDelete ?? true
  );
  const [dotfilesPoolEnabled, setDotfilesPoolEnabled] = useState<boolean>(
    currentSettings.dotfilesPoolEnabled ?? false
  );
  const [smartcardAuthMode, setSmartcardAuthMode] = useState<SmartcardAuthMode>(
    currentSettings.smartcardAuthMode ?? 'always-prompt'
  );
  const [smartcardUnlockAtStartup, setSmartcardUnlockAtStartup] = useState<boolean>(
    currentSettings.smartcardUnlockAtStartup ?? false
  );
  const [smartcardLibPath, setSmartcardLibPath] = useState<string>(currentSettings.smartcardLibPath ?? '');
  const [fileManagerGitIntegration, setFileManagerGitIntegration] = useState<boolean>(
    currentSettings.fileManagerGitIntegration ?? true
  );
  const [localTerminalAgentMode, setLocalTerminalAgentMode] = useState<'auto' | 'system' | 'app-managed' | 'disabled'>(
    currentSettings.localTerminalAgentMode ?? 'auto'
  );
  const [poolManagerOpen, setPoolManagerOpen] = useState(false);

  const [shortcuts, setShortcuts] = useState<Record<string, string>>(() => ({
    ...DEFAULT_SHORTCUTS,
    ...(currentSettings.shortcuts ?? {}),
  }));
  const [recordingAction, setRecordingAction] = useState<string | null>(null);
  const [shortcutSearch, setShortcutSearch] = useState('');

  const [smartcardLibs, setSmartcardLibs] = useState<DetectedSmartcardLib[]>([]);
  const [detectingSmartcard, setDetectingSmartcard] = useState(false);

  const [x11ServerMode, setX11ServerMode] = useState<'auto' | 'manual' | 'always'>(
    currentSettings.x11ServerMode ?? 'auto'
  );
  const [x11ServerPath, setX11ServerPath] = useState<string>(
    currentSettings.x11ServerPath ?? ''
  );
  const [x11ServerArgs, setX11ServerArgs] = useState<string>(
    currentSettings.x11ServerArgs ?? ''
  );
  const [x11Status, setX11Status] = useState<XServerStatus | null>(null);
  const [x11Operating, setX11Operating] = useState<boolean>(false);
  const [platform, setPlatform] = useState<string>('');

  const [enableOpenShift, setEnableOpenShift] = useState<boolean>(
    currentSettings.enableOpenShift ?? false
  );
  const [k8sDebugImages, setK8sDebugImages] = useState<K8sDebugImage[]>(
    currentSettings.k8sDebugImages ?? [...DEFAULT_K8S_DEBUG_IMAGES]
  );
  const [showAddDebugImage, setShowAddDebugImage] = useState(false);
  const [newImageName, setNewImageName] = useState('');
  const [newImageRef, setNewImageRef] = useState('');
  const [newImageCmd, setNewImageCmd] = useState('');
  const [newImageDesc, setNewImageDesc] = useState('');

  const isLinux = (x11Status?.platform || platform) === 'linux';

  // null while unknown (still loading) - only "false" should ever trigger the warning card.
  const [credentialEncryptionAvailable, setCredentialEncryptionAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (open) {
      setActiveCategory('general');
      setTheme(currentSettings.theme);
      setFontSize(currentSettings.terminalFontSize);
      setFontFamily(currentSettings.terminalFontFamily);
      setCursorStyle(currentSettings.terminalCursorStyle ?? 'block');
      setScrollback(currentSettings.terminalScrollback ?? 5000);
      setCopyOnSelect(currentSettings.copyOnSelect ?? false);
      setClipboardScope(currentSettings.clipboardHistoryScope ?? 'global');
      setClipboardClearOnExit(currentSettings.clipboardHistoryClearOnExit ?? false);
      setPerfEnabled(currentSettings.perfMetricsEnabled ?? false);
      setPerfLayout(currentSettings.perfMetricsLayout ?? 'text');
      setPerfItems(currentSettings.perfMetricsItems ?? DEFAULT_PERF_ITEMS);
      setPerfIntervalSec(currentSettings.perfMetricsIntervalSec ?? 5);
      setSessionExitAction(currentSettings.sessionExitAction ?? 'reconnect');
      setConfirmBeforeQuit(currentSettings.confirmBeforeQuit ?? false);
      setAutoCheckUpdates(currentSettings.autoCheckUpdates ?? true);
      setDefaultNewTab(currentSettings.defaultNewTabType);
      setDefaultConflictPolicy(currentSettings.defaultConflictPolicy ?? 'ask');
      setShowHiddenFiles(currentSettings.showHiddenFiles ?? false);
      setVerifyTransferIntegrity(currentSettings.verifyTransferIntegrity ?? true);
      setShareFoldersAcrossTypes(currentSettings.shareFoldersAcrossTypes ?? false);
      setConfirmBeforeDelete(currentSettings.confirmBeforeDelete ?? true);
      setDotfilesPoolEnabled(currentSettings.dotfilesPoolEnabled ?? false);
      setSmartcardAuthMode(currentSettings.smartcardAuthMode ?? 'always-prompt');
      setSmartcardUnlockAtStartup(currentSettings.smartcardUnlockAtStartup ?? false);
      setSmartcardLibPath(currentSettings.smartcardLibPath ?? '');
      setFileManagerGitIntegration(currentSettings.fileManagerGitIntegration ?? true);
      setLocalTerminalAgentMode(currentSettings.localTerminalAgentMode ?? 'auto');
      setX11ServerMode(currentSettings.x11ServerMode ?? 'auto');
      setX11ServerPath(currentSettings.x11ServerPath ?? '');
      setX11ServerArgs(currentSettings.x11ServerArgs ?? '');
      setShortcuts({
        ...DEFAULT_SHORTCUTS,
        ...(currentSettings.shortcuts ?? {}),
      });
      setRecordingAction(null);
      setShortcutSearch('');
      setEnableOpenShift(currentSettings.enableOpenShift ?? false);
      setK8sDebugImages(currentSettings.k8sDebugImages ?? [...DEFAULT_K8S_DEBUG_IMAGES]);
      setShowAddDebugImage(false);

      // Auto detect smartcards for security tab
      setDetectingSmartcard(true);
      void window.multissh
        ?.smartcardDetect?.()
        ?.then((libs) => {
          if (libs) setSmartcardLibs(libs.filter((l) => l.exists));
        })
        ?.finally(() => setDetectingSmartcard(false));

      void window.multissh
        ?.x11GetStatus?.(currentSettings.x11ServerPath)
        ?.then((status) => {
          if (status) setX11Status(status);
        });

      setCredentialEncryptionAvailable(null);
      void window.multissh
        ?.getSecurityStatus?.()
        ?.then((status) => {
          if (status) setCredentialEncryptionAvailable(status.credentialEncryptionAvailable);
        })
        ?.catch(() => {
          // Unknown is safer than falsely claiming "Active" - leave it null.
        });

      void window.multissh
        ?.getPlatform?.()
        ?.then((p) => {
          if (p) setPlatform(p);
        });
    }
  }, [open, currentSettings]);

  // Design audit Phase 1: every other modal in the app dismisses on Escape
  // and backdrop click via this shared hook; SettingsModal had never been
  // wired up to it, so Escape silently did nothing here.
  const handleBackdropClick = useModalDismiss(onClose, open);

  // Design audit Phase 2: several categories (Terminal, Security &
  // Smartcard, ...) have more content than fits in the modal's max-h.
  // The custom 6px scrollbar (index.css) is too subtle to register as
  // "there's more below", so content used to just look cut off mid-
  // sentence. Track scroll position and fade a gradient in/out at the
  // bottom edge whenever there's unscrolled content beneath it.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const updateScrollShadow = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    setHasMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  }, []);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    updateScrollShadow();
  }, [activeCategory, updateScrollShadow]);

  if (!open) return null;

  const refreshX11Status = async (customPath?: string) => {
    try {
      const status = await window.multissh?.x11GetStatus?.(customPath !== undefined ? customPath : x11ServerPath);
      if (status) setX11Status(status);
    } catch {
      // ignore
    }
  };

  const handleStartX11 = async () => {
    setX11Operating(true);
    try {
      await window.multissh?.x11StartServer?.({
        customPath: x11ServerPath || undefined,
        customArgs: x11ServerArgs || undefined,
      });
      await refreshX11Status();
    } finally {
      setX11Operating(false);
    }
  };

  const handleStopX11 = async () => {
    setX11Operating(true);
    try {
      await window.multissh?.x11StopServer?.();
      await refreshX11Status();
    } finally {
      setX11Operating(false);
    }
  };

  const handleBrowseX11Path = async () => {
    try {
      const file = await window.multissh?.dialogOpenFile?.({
        title: 'Select X Server Executable (vcxsrv.exe, xming.exe)',
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      });
      if (file) {
        setX11ServerPath(file);
        void refreshX11Status(file);
      }
    } catch {
      // ignore
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      theme,
      terminalFontSize: fontSize,
      terminalFontFamily: fontFamily,
      terminalCursorStyle: cursorStyle,
      terminalScrollback: scrollback,
      copyOnSelect,
      clipboardHistoryScope: clipboardScope,
      clipboardHistoryClearOnExit: clipboardClearOnExit,
      perfMetricsEnabled: perfEnabled,
      perfMetricsLayout: perfLayout,
      perfMetricsItems: perfItems,
      perfMetricsIntervalSec: perfIntervalSec,
      sessionExitAction,
      confirmBeforeQuit,
      autoCheckUpdates,
      defaultNewTabType: defaultNewTab,
      defaultConflictPolicy,
      showHiddenFiles,
      verifyTransferIntegrity,
      shareFoldersAcrossTypes,
      confirmBeforeDelete,
      dotfilesPoolEnabled,
      smartcardAuthMode,
      smartcardUnlockAtStartup,
      smartcardLibPath: smartcardLibPath || undefined,
      fileManagerGitIntegration,
      localTerminalAgentMode,
      x11ServerMode,
      x11ServerPath,
      x11ServerArgs,
      shortcuts,
      enableOpenShift,
      k8sDebugImages,
    });
    onClose();
  };

  const handleResetShortcuts = () => {
    setShortcuts({ ...DEFAULT_SHORTCUTS });
  };

  const handleKeyDownRecord = (e: React.KeyboardEvent, actionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecordingAction(null);
      return;
    }
    // Shares its combo-building logic with the runtime shortcut matcher in App.tsx: a shortcut
    // recorded here for a given physical key must resolve to the exact same string that pressing
    // that key produces at runtime, or the saved binding silently never fires.
    const combo = comboFromKeyboardEvent(e);
    if (combo === null) return;
    setShortcuts((prev) => ({ ...prev, [actionId]: combo }));
    setRecordingAction(null);
  };

  // Grouped under short section headers (UX review #9) so a 7-item sidebar
  // scans faster than one flat list.
  const categoryGroups: {
    group: string;
    items: { id: SettingsCategory; label: string; icon: React.ComponentType<{ className?: string }> }[];
  }[] = [
    {
      group: 'Appearance',
      items: [
        { id: 'general', label: 'General', icon: Sliders },
        { id: 'terminal', label: 'Terminal', icon: Terminal },
        { id: 'performance', label: 'Performance', icon: Activity },
      ],
    },
    {
      group: 'Connectivity & Storage',
      items: [
        { id: 'files', label: 'Files & Storage', icon: FolderTree },
        { id: 'sync', label: 'Synchronization', icon: RefreshCw },
        { id: 'kubernetes', label: 'Kubernetes & Debug', icon: Boxes },
      ],
    },
    {
      group: 'Developer & Security',
      items: [
        { id: 'git', label: 'Git & GitHub', icon: GitBranch },
        { id: 'security', label: 'Security & Smartcard', icon: Shield },
        { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
      ],
    },
  ];

  const filteredShortcuts = SHORTCUT_DEFINITIONS.filter(
    (s) =>
      !shortcutSearch ||
      s.name.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
      s.category.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
      s.defaultKeys.toLowerCase().includes(shortcutSearch.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 animate-in fade-in duration-150"
      onClick={handleBackdropClick}
    >
      {/* Fixed height (capped at 680px / 85vh): sizing to content made the dialog
          change height and jump on screen every time a different category was
          selected. Sparse categories now leave some empty space instead. */}
      <div role="dialog" aria-modal="true" aria-label="Settings" className="flex h-[85vh] max-h-[680px] min-h-[420px] w-full max-w-3xl flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-divider bg-app-surface px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <Settings className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">Settings</h2>
            </div>
          </div>
          <button aria-label="Close" title="Close"
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body with Sidebar & Content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <aside className="w-52 shrink-0 overflow-y-auto border-r border-divider bg-app-surface p-2.5 flex flex-col gap-3">
            {categoryGroups.map(({ group, items }) => (
              <div key={group} className="flex flex-col gap-1">
                <div className="px-3 pt-1 text-2xs font-semibold uppercase tracking-wide text-txt-muted">
                  {group}
                </div>
                {items.map((cat) => {
                  const Icon = cat.icon;
                  const isActive = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                        isActive
                          ? 'bg-sky-500/15 text-sky-400 font-semibold'
                          : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isActive ? 'text-sky-400' : 'text-txt-muted'}`} />
                      <span>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

          {/* Form Content Area */}
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col min-w-0 bg-app-card">
            <div className="relative flex-1 min-h-0">
            <div
              ref={contentRef}
              onScroll={updateScrollShadow}
              className="h-full overflow-y-auto p-5 pb-8 text-xs text-txt-secondary space-y-5"
            >
              {/* Category: General & Appearance */}
              {activeCategory === 'general' && (
                <div className="space-y-4">
                  {/* Theme */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">Color Theme</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setTheme('dark')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                          theme === 'dark'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <Moon className="h-4 w-4 text-sky-400" />
                        Dark
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('light')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                          theme === 'light'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <Sun className="h-4 w-4 text-amber-400" />
                        Light
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('breeze')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                          theme === 'breeze'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <Sliders className="h-4 w-4 text-cyan-400" />
                        Breeze
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('system')}
                        className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors ${
                          theme === 'system'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <Monitor className="h-4 w-4 text-sky-400" />
                        System
                      </button>
                    </div>
                  </div>

                  {/* Default New Tab Type */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">Default Tab Type</label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <label
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-medium cursor-pointer transition-colors ${
                          defaultNewTab === 'terminal'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <input
                          type="radio"
                          name="defaultTab"
                          checked={defaultNewTab === 'terminal'}
                          onChange={() => setDefaultNewTab('terminal')}
                          className="hidden"
                        />
                        <Terminal className="h-4 w-4 text-sky-400" />
                        <span>Terminal</span>
                      </label>

                      <label
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs font-medium cursor-pointer transition-colors ${
                          defaultNewTab === 'filemanager'
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <input
                          type="radio"
                          name="defaultTab"
                          checked={defaultNewTab === 'filemanager'}
                          onChange={() => setDefaultNewTab('filemanager')}
                          className="hidden"
                        />
                        <FolderTree className="h-4 w-4 text-amber-400" />
                        <span>File Manager</span>
                      </label>
                    </div>
                  </div>

                  {/* App Behavior */}
                  <div className="space-y-2 pt-2 border-t border-divider">
                    <label className="text-xs font-medium text-txt-primary">App Behavior</label>
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmBeforeQuit}
                        onChange={(e) => setConfirmBeforeQuit(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Confirm before quitting the app</span>
                    </label>
                    <p className="text-xs text-txt-muted pl-6">
                      Ask for confirmation when closing the window or quitting, so active SSH
                      sessions and tunnels aren't closed by accident.
                    </p>
                    <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                      <input
                        type="checkbox"
                        checked={autoCheckUpdates && updateState?.unsupportedReason !== 'disabled'}
                        disabled={updateState?.unsupportedReason === 'disabled'}
                        onChange={(e) => setAutoCheckUpdates(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Check for updates automatically</span>
                    </label>
                    <div className="flex items-center gap-2 pl-6 text-xs text-txt-muted">
                      <span data-testid="update-status">
                        Version {updateState?.currentVersion ?? '…'}
                        {updateState?.status === 'checking' && ' · checking…'}
                        {updateState?.status === 'up-to-date' && ' · up to date'}
                        {updateState?.status === 'error' && ` · ${updateState.error ?? 'update check failed'}`}
                        {updateState?.status === 'available' && ` · ${updateState.version ?? ''} available`}
                        {updateState?.status === 'downloading' &&
                          ` · downloading ${updateState.version ?? ''} (${updateState.progress ?? 0}%)`}
                        {updateState?.status === 'ready' &&
                          ` · ${updateState.version ?? ''} downloaded, restart to install`}
                        {updateState?.status === 'unsupported' &&
                          (updateState.unsupportedReason === 'windows-unsigned'
                            ? ' · download new versions manually (Windows builds are not code-signed yet)'
                            : updateState.unsupportedReason === 'disabled'
                              ? ' · updates are disabled by the administrator'
                              : ' · updates are disabled in development')}
                      </span>
                      {updateState?.status === 'unsupported' && updateState.unsupportedReason === 'windows-unsigned' && (
                        <button
                          type="button"
                          onClick={() =>
                            void window.multissh?.openExternal('https://github.com/alun-hub/sshs3/releases/latest')
                          }
                          className="rounded border border-border-subtle px-2 py-0.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-50"
                        >
                          Open releases
                        </button>
                      )}
                      {updateState?.status === 'available' && (
                        <button type="button" onClick={() => void window.multissh?.downloadUpdate()} className="rounded border border-border-subtle px-2 py-0.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-50">
                          Download
                        </button>
                      )}
                      {updateState?.status === 'ready' && (
                        <button type="button" onClick={() => void window.multissh?.installUpdate()} className="rounded border border-border-subtle px-2 py-0.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-50">
                          Restart and install
                        </button>
                      )}
                      {updateState &&
                        updateState.status !== 'unsupported' &&
                        updateState.status !== 'available' &&
                        updateState.status !== 'ready' && (
                          <button
                            type="button"
                            disabled={updateState.status === 'checking' || updateState.status === 'downloading'}
                            onClick={() => void window.multissh?.checkForUpdates()}
                            className="rounded border border-border-subtle px-2 py-0.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-50"
                          >
                            Check now
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              )}

              {/* Category: Terminal */}
              {activeCategory === 'terminal' && (
                <div className="space-y-4">
                  {/* Font Size */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-txt-primary">Terminal Font Size</label>
                      <span className="font-mono text-sky-400 font-semibold">{fontSize} px</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={8}
                        max={32}
                        step={1}
                        value={fontSize}
                        onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                        className="flex-1 accent-sky-500 cursor-pointer"
                      />
                      <input
                        type="number"
                        min={8}
                        max={32}
                        value={fontSize}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!Number.isNaN(val) && val >= 8 && val <= 32) {
                            setFontSize(val);
                          }
                        }}
                        className="w-16 rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-center font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  {/* Font Family */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">Terminal Font Family</label>
                    <select
                      value={FONT_PRESETS.some((f) => f.value === fontFamily) ? fontFamily : 'custom'}
                      onChange={(e) => {
                        if (e.target.value !== 'custom') {
                          setFontFamily(e.target.value);
                        }
                      }}
                      className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                    >
                      {FONT_PRESETS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                      <option value="custom">Custom...</option>
                    </select>
                    <input
                      aria-label="Custom font family"
                      type="text"
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      placeholder="Enter custom font family..."
                      className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                    />
                  </div>

                  {/* Terminal Live Preview */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-txt-muted uppercase tracking-wider">
                      Terminal Live Preview
                    </label>
                    <div
                      className={`rounded-lg border p-3 font-mono transition-colors shadow-inner ${
                        theme === 'breeze'
                          ? 'border-border-subtle bg-[#232627] text-[#fcfcfc]'
                          : theme === 'light'
                            ? 'border-border-subtle bg-white text-slate-900'
                            : 'border-border-subtle bg-black/40 text-slate-100'
                      }`}
                      style={{
                        fontFamily: fontFamily || 'monospace',
                        fontSize: `${fontSize}px`,
                        lineHeight: '1.45',
                      }}
                    >
                      <div className={theme === 'breeze' ? 'text-[#11d116]' : 'text-emerald-400'}>$ uname -srm</div>
                      <div>Linux 6.1.0-custom x86_64</div>
                      <div className={theme === 'breeze' ? 'text-[#3daee9]' : 'text-sky-400'}>sshs3 session active. Ready.</div>
                    </div>
                  </div>

                  {/* Cursor Style & Scrollback */}
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-divider">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-txt-primary">Cursor Style</label>
                      <select
                        value={cursorStyle}
                        onChange={(e) => setCursorStyle(e.target.value as any)}
                        className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                      >
                        <option value="block">Block</option>
                        <option value="underline">Underline</option>
                        <option value="bar">Vertical Bar</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-txt-primary">Scrollback Buffer (lines)</label>
                      <input
                        type="number"
                        min={500}
                        max={50000}
                        step={500}
                        value={scrollback}
                        onChange={(e) => setScrollback(Number(e.target.value) || 5000)}
                        className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>

                  {/* Copy on select */}
                  <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={copyOnSelect}
                      onChange={(e) => setCopyOnSelect(e.target.checked)}
                      className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-xs text-txt-primary">Copy text automatically on selection</span>
                  </label>
                  <p className="text-xs text-txt-muted -mt-1 pl-6">
                    Selections are kept in an encrypted history. Shift+Insert and middle-click paste the latest one;
                    right-click opens the full history.
                  </p>

                  <div className="space-y-1.5 pl-6">
                    <label className="text-xs font-medium text-txt-primary" htmlFor="clipboard-history-scope">
                      Clipboard history scope
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        id="clipboard-history-scope"
                        value={clipboardScope}
                        onChange={(e) => setClipboardScope(e.target.value === 'host' ? 'host' : 'global')}
                        className="rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                      >
                        <option value="global">Global (shared by all hosts and terminals)</option>
                        <option value="host">Per host (follows the connection)</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => void window.multissh.clipboardHistoryClear()}
                        className="rounded-lg border border-border-subtle px-3 py-2 text-xs text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary cursor-pointer"
                      >
                        Clear history
                      </button>
                    </div>
                    <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={clipboardClearOnExit}
                        onChange={(e) => setClipboardClearOnExit(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Empty clipboard history on exit</span>
                    </label>
                  </div>

                  {/* Session Exit Action */}
                  <div className="space-y-2 pt-2 border-t border-divider">
                    <div>
                      <label className="text-xs font-medium text-txt-primary">On Logout / Session End</label>
                      <p className="text-xs text-txt-muted">Choose what happens when an SSH session or local terminal ends.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <label
                        className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                          sessionExitAction === 'reconnect'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <input
                            type="radio"
                            name="sessionExitAction"
                            checked={sessionExitAction === 'reconnect'}
                            onChange={() => setSessionExitAction('reconnect')}
                            className="hidden"
                          />
                          <RotateCcw className="h-3.5 w-3.5 text-sky-400" />
                          <span>Reconnect (Default)</span>
                        </div>
                        <span className="text-xs text-txt-muted leading-tight">
                          Shows quick buttons to reconnect directly or close the tab.
                        </span>
                      </label>

                      <label
                        className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                          sessionExitAction === 'close'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <input
                            type="radio"
                            name="sessionExitAction"
                            checked={sessionExitAction === 'close'}
                            onChange={() => setSessionExitAction('close')}
                            className="hidden"
                          />
                          <X className="h-3.5 w-3.5 text-amber-400" />
                          <span>Close Tab Immediately</span>
                        </div>
                        <span className="text-xs text-txt-muted leading-tight">
                          Closes the tab automatically on a clean logout (code 0).
                        </span>
                      </label>

                      <label
                        className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                          sessionExitAction === 'keep'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <input
                            type="radio"
                            name="sessionExitAction"
                            checked={sessionExitAction === 'keep'}
                            onChange={() => setSessionExitAction('keep')}
                            className="hidden"
                          />
                          <Terminal className="h-3.5 w-3.5 text-txt-muted" />
                          <span>Keep Open</span>
                        </div>
                        <span className="text-xs text-txt-muted leading-tight">
                          Leave the terminal open with no quick buttons (classic mode).
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* SSH CLI & Agent Integration */}
                  <div className="space-y-3 pt-3 border-t border-divider">
                    <div>
                      <label className="text-xs font-medium text-txt-primary">Local Terminal SSH Agent</label>
                      <p className="text-xs text-txt-muted">
                        Configure how the <code>SSH_AUTH_SOCK</code> environment variable is set in local shell terminals.
                      </p>
                    </div>
                    <select
                      value={localTerminalAgentMode}
                      onChange={(e) =>
                        setLocalTerminalAgentMode(
                          e.target.value as 'auto' | 'system' | 'app-managed' | 'disabled'
                        )
                      }
                      className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                    >
                      <option value="auto">Auto (Smartcard / app-managed agent if active, else inherit system/login shell)</option>
                      <option value="system">System Only (Inherit system or login shell SSH_AUTH_SOCK)</option>
                      <option value="app-managed">App Managed (Use sshs3-managed agent or active smartcard)</option>
                      <option value="disabled">Disabled (Do not set SSH_AUTH_SOCK)</option>
                    </select>
                  </div>

                  {/* Local X11 Server (Windows GUI Forwarding) */}
                  <div className="space-y-3 pt-3 border-t border-divider">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-sky-400" />
                        <label className="text-xs font-semibold text-txt-primary">
                          Local X11 Server (GUI Forwarding)
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        {x11Status?.running ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Running ({x11Status.display})
                            {x11Status.managedByApp && x11Status.pid ? ` [PID ${x11Status.pid}]` : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium bg-slate-500/10 text-txt-muted border border-slate-500/20">
                            Stopped
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void refreshX11Status()}
                          className="p-1 text-txt-muted hover:text-txt-primary hover:bg-app-surface-hover rounded transition-colors"
                          title="Refresh X server status"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-txt-muted">
                      {isLinux
                        ? 'Allows remote Linux GUI applications (like xclock, gedit, Firefox, or IDEs) to display seamlessly on your local desktop when X11 forwarding is enabled.'
                        : 'Allows Linux GUI applications (like xclock, gedit, Firefox, or IDEs) to display seamlessly on Windows when X11 forwarding is enabled.'}
                    </p>

                    {/* Linux Detection Notice */}
                    {isLinux && (
                      <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 font-medium text-sky-300">
                            <CheckCircle2 className="h-4 w-4 text-sky-400 shrink-0" />
                            <span>Linux system detected — Native display support active</span>
                          </div>
                          <span className="text-2xs uppercase font-semibold tracking-wider text-sky-400 bg-sky-500/20 px-2 py-0.5 rounded border border-sky-500/30">
                            Native Display
                          </span>
                        </div>
                        <p className="text-xs text-txt-secondary leading-relaxed">
                          Your system uses native X11 / Wayland display forwarding ({x11Status?.display || ':0'}). External X servers (such as VcXsrv or Xming) and their launch settings are only required on Windows — no background daemon or extra configuration is needed on Linux.
                        </p>
                        <div className="pt-1 border-t border-sky-500/20 text-xs">
                          {x11Status?.running ? (
                            <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Local X11 display is active and ready for SSH forwarding. No extra settings needed.
                            </span>
                          ) : (
                            <span className="text-amber-400 font-medium flex items-center gap-1.5">
                              ⚠ No local display server found listening on {x11Status?.display || ':0'}. Ensure your X11 or Xwayland session is running.
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {isLinux ? (
                      <details className="group rounded-lg border border-border-subtle bg-app-surface/50 p-2.5 text-xs">
                        <summary className="cursor-pointer text-txt-muted hover:text-txt-primary select-none flex items-center justify-between">
                          <span className="font-medium text-txt-secondary">
                            Windows X Server Settings (Optional / Only used on Windows)
                          </span>
                          <span className="text-2xs text-txt-muted group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div className="mt-3 space-y-3 pt-2 border-t border-divider">
                          <p className="text-xs text-txt-muted">
                            These settings configure VcXsrv when sshs3 runs on Windows. They are saved in your settings profile if you sync across multiple operating systems.
                          </p>

                          {/* Server Mode */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <label
                              className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                                x11ServerMode === 'auto'
                                  ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                                  : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                              }`}
                            >
                              <div className="flex items-center gap-2 font-medium">
                                <input
                                  type="radio"
                                  name="x11ServerMode"
                                  checked={x11ServerMode === 'auto'}
                                  onChange={() => setX11ServerMode('auto')}
                                  className="hidden"
                                />
                                <span>Auto-start (Default)</span>
                              </div>
                              <span className="text-xs text-txt-muted leading-tight">
                                Starts VcXsrv on demand when an X11 session opens.
                              </span>
                            </label>

                            <label
                              className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                                x11ServerMode === 'always'
                                  ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                                  : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                              }`}
                            >
                              <div className="flex items-center gap-2 font-medium">
                                <input
                                  type="radio"
                                  name="x11ServerMode"
                                  checked={x11ServerMode === 'always'}
                                  onChange={() => setX11ServerMode('always')}
                                  className="hidden"
                                />
                                <span>Always Running</span>
                              </div>
                              <span className="text-xs text-txt-muted leading-tight">
                                Launches in background when sshs3 starts up.
                              </span>
                            </label>

                            <label
                              className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                                x11ServerMode === 'manual'
                                  ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                                  : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                              }`}
                            >
                              <div className="flex items-center gap-2 font-medium">
                                <input
                                  type="radio"
                                  name="x11ServerMode"
                                  checked={x11ServerMode === 'manual'}
                                  onChange={() => setX11ServerMode('manual')}
                                  className="hidden"
                                />
                                <span>Manual / External</span>
                              </div>
                              <span className="text-xs text-txt-muted leading-tight">
                                Manage server manually or use WSLg / external X server.
                              </span>
                            </label>
                          </div>

                          {/* Path & Controls */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-txt-primary">X Server Binary Path</label>
                            <div className="flex items-center gap-2">
                              <input
                                aria-label="X server binary path"
                                type="text"
                                value={x11ServerPath}
                                onChange={(e) => {
                                  setX11ServerPath(e.target.value);
                                  void refreshX11Status(e.target.value);
                                }}
                                placeholder="Not needed on Linux (e.g. C:\Program Files\VcXsrv\vcxsrv.exe on Windows)"
                                className="flex-1 rounded-lg border border-border-subtle bg-app-input px-3 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                              />
                              <button
                                type="button"
                                onClick={() => void handleBrowseX11Path()}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-subtle bg-app-surface text-xs text-txt-primary hover:bg-app-surface-hover"
                                title="Browse executable..."
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                <span>Browse</span>
                              </button>
                            </div>
                          </div>

                          {/* Custom Arguments */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-txt-primary">Server Arguments</label>
                            <input
                              aria-label="X server arguments"
                              type="text"
                              value={x11ServerArgs}
                              onChange={(e) => setX11ServerArgs(e.target.value)}
                              placeholder=":0 -multiwindow -clipboard -wgl -ac"
                              className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                            />
                          </div>
                        </div>
                      </details>
                    ) : (
                      <>
                        {/* Server Mode */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label
                            className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                              x11ServerMode === 'auto'
                                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                                : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                            }`}
                          >
                            <div className="flex items-center gap-2 font-medium">
                              <input
                                type="radio"
                                name="x11ServerMode"
                                checked={x11ServerMode === 'auto'}
                                onChange={() => setX11ServerMode('auto')}
                                className="hidden"
                              />
                              <span>Auto-start (Default)</span>
                            </div>
                            <span className="text-xs text-txt-muted leading-tight">
                              Starts VcXsrv on demand when an X11 session opens.
                            </span>
                          </label>

                          <label
                            className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                              x11ServerMode === 'always'
                                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                                : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                            }`}
                          >
                            <div className="flex items-center gap-2 font-medium">
                              <input
                                type="radio"
                                name="x11ServerMode"
                                checked={x11ServerMode === 'always'}
                                onChange={() => setX11ServerMode('always')}
                                className="hidden"
                              />
                              <span>Always Running</span>
                            </div>
                            <span className="text-xs text-txt-muted leading-tight">
                              Launches in background when sshs3 starts up.
                            </span>
                          </label>

                          <label
                            className={`flex flex-col gap-1 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                              x11ServerMode === 'manual'
                                ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                                : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                            }`}
                          >
                            <div className="flex items-center gap-2 font-medium">
                              <input
                                type="radio"
                                name="x11ServerMode"
                                checked={x11ServerMode === 'manual'}
                                onChange={() => setX11ServerMode('manual')}
                                className="hidden"
                              />
                              <span>Manual / External</span>
                            </div>
                            <span className="text-xs text-txt-muted leading-tight">
                              Manage server manually or use WSLg / external X server.
                            </span>
                          </label>
                        </div>

                        {/* Path & Controls */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-txt-primary">X Server Binary Path</label>
                            {x11Status?.available && !x11ServerPath && (
                              <span className="text-2xs text-emerald-400">
                                Auto-detected: {x11Status.executablePath}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={x11ServerPath}
                              onChange={(e) => {
                                setX11ServerPath(e.target.value);
                                void refreshX11Status(e.target.value);
                              }}
                              placeholder={x11Status?.executablePath || 'Auto-detect (e.g. C:\\Program Files\\VcXsrv\\vcxsrv.exe)'}
                              className="flex-1 rounded-lg border border-border-subtle bg-app-input px-3 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                            />
                            <button
                              type="button"
                              onClick={() => void handleBrowseX11Path()}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-subtle bg-app-surface text-xs text-txt-primary hover:bg-app-surface-hover"
                              title="Browse executable..."
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                              <span>Browse</span>
                            </button>
                          </div>
                        </div>

                        {/* Custom Arguments */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-txt-primary">Server Arguments</label>
                          <input
                            aria-label="X server arguments"
                            type="text"
                            value={x11ServerArgs}
                            onChange={(e) => setX11ServerArgs(e.target.value)}
                            placeholder=":0 -multiwindow -clipboard -wgl -ac"
                            className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                          />
                        </div>

                        {/* Manual start/stop actions */}
                        <div className="flex items-center gap-2 pt-1">
                          {x11Status?.running ? (
                            <button
                              type="button"
                              disabled={x11Operating || !x11Status.managedByApp}
                              onClick={() => void handleStopX11()}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-50 transition-colors"
                              title={x11Status.managedByApp ? 'Stop server' : 'External server cannot be stopped from here'}
                            >
                              <Square className="h-3 w-3" />
                              <span>Stop Server</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={x11Operating || (!x11Status?.available && !x11ServerPath)}
                              onClick={() => void handleStartX11()}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                            >
                              <Play className="h-3 w-3" />
                              <span>Start Server Now</span>
                            </button>
                          )}
                          {!x11Status?.running && !x11Status?.available && !x11ServerPath && (
                            <span className="text-xs text-amber-400">
                              VcXsrv not detected. Please install VcXsrv or specify path above.
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Performance */}
              {activeCategory === 'performance' && (
                <div className="space-y-4" data-testid="perf-settings">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={perfEnabled}
                      onChange={(e) => setPerfEnabled(e.target.checked)}
                      data-testid="perf-enabled"
                      className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-xs text-txt-primary">Show performance bar above terminals</span>
                  </label>
                  <p className="text-xs text-txt-muted">
                    SSH: read from /proc on Linux hosts over the open connection. Local shell: this computer.
                    Kubernetes: pod metrics from metrics-server (updated about every 15-60 s). Hover the bar for every
                    value, click it for up to 15 minutes of history.
                  </p>
                  {perfEnabled && (
                    <div className="space-y-4 pl-6">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-txt-primary" htmlFor="perf-layout">
                            Layout
                          </label>
                          <select
                            id="perf-layout"
                            value={perfLayout}
                            onChange={(e) => setPerfLayout(e.target.value as PerfLayout)}
                            className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                          >
                            <option value="text">Compact text</option>
                            <option value="bars">Bars</option>
                            <option value="sparklines">Sparklines</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-txt-primary" htmlFor="perf-interval">
                            Update interval
                          </label>
                          <select
                            id="perf-interval"
                            value={perfIntervalSec}
                            onChange={(e) => setPerfIntervalSec(Number(e.target.value))}
                            className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500"
                          >
                            {PERF_INTERVALS_SEC.map((sec) => (
                              <option key={sec} value={sec}>
                                {sec} s{sec < PERF_K8S_MIN_INTERVAL_SEC ? ' (Kubernetes: 10 s)' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-txt-primary">Servers and local shell</span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
                          {PERF_METRIC_IDS.filter((id) => metricApplies('ssh', id)).map((id) => (
                            <label key={id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={perfItems.includes(id)}
                                onChange={(e) =>
                                  setPerfItems((prev) =>
                                    e.target.checked
                                      ? PERF_METRIC_IDS.filter((m) => m === id || prev.includes(m))
                                      : prev.filter((m) => m !== id)
                                  )
                                }
                                data-testid={`perf-item-${id}`}
                                className="h-3.5 w-3.5 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                              />
                              <span className="text-xs text-txt-primary">{PERF_METRIC_LABELS[id]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-txt-primary">Kubernetes pods</span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1.5">
                          {PERF_METRIC_IDS.filter((id) => metricApplies('k8s', id)).map((id) => (
                            <label key={id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={perfItems.includes(id)}
                                onChange={(e) =>
                                  setPerfItems((prev) =>
                                    e.target.checked
                                      ? PERF_METRIC_IDS.filter((m) => m === id || prev.includes(m))
                                      : prev.filter((m) => m !== id)
                                  )
                                }
                                data-testid={`perf-k8s-item-${id}`}
                                className="h-3.5 w-3.5 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                              />
                              <span className="text-xs text-txt-primary">{PERF_METRIC_LABELS[id]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Category: Files & Storage */}
              {activeCategory === 'files' && (
                <div className="space-y-4">
                  {/* Default Conflict Policy */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-txt-primary">
                      Default Conflict Resolution for File Transfers
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'ask', label: 'Ask each time (Dialog)', desc: 'Show a prompt when files collide' },
                        { id: 'overwrite', label: 'Overwrite', desc: 'Replace destination file' },
                        { id: 'rename', label: 'Rename automatically', desc: 'Appends (1), (2), etc.' },
                        { id: 'skip', label: 'Skip existing files', desc: 'Ignore files that already exist' },
                      ].map((opt) => (
                        <label
                          key={opt.id}
                          className={`flex flex-col gap-0.5 rounded-lg border p-3 cursor-pointer transition-colors ${
                            defaultConflictPolicy === opt.id
                              ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                              : 'border-border-subtle bg-app-surface hover:bg-app-surface-hover text-txt-secondary'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="conflictPolicy"
                              checked={defaultConflictPolicy === opt.id}
                              onChange={() => setDefaultConflictPolicy(opt.id as any)}
                              className="hidden"
                            />
                            <span className="font-semibold text-xs text-txt-primary">{opt.label}</span>
                          </div>
                          <span className="text-xs text-txt-muted">{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-divider">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showHiddenFiles}
                        onChange={(e) => setShowHiddenFiles(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Show hidden files and dotfiles (.git, .env, etc.)</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmBeforeDelete}
                        onChange={(e) => setConfirmBeforeDelete(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Confirm before deleting files and folders</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={verifyTransferIntegrity}
                        onChange={(e) => setVerifyTransferIntegrity(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">Verify file integrity and size after transfer</span>
                    </label>
                  </div>

                  {/* Folder organization */}
                  <div className="space-y-2 pt-2 border-t border-divider">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shareFoldersAcrossTypes}
                        onChange={(e) => setShareFoldersAcrossTypes(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">
                        Share folders between SSH/SFTP and S3 in Connection Manager
                      </span>
                    </label>
                    <p className="pl-6 text-xs text-txt-muted leading-relaxed">
                      Off by default: each tab in Connection Manager only shows folders that
                      actually contain a profile of that type, so an "S3" folder doesn't sit
                      empty under SSH/SFTP. Turn this on to use one shared folder tree across
                      both connection types instead.
                    </p>
                  </div>

                  {/* Dotfiles Pool (opt-in) */}
                  <div className="space-y-2 pt-2 border-t border-divider">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dotfilesPoolEnabled}
                        onChange={(e) => setDotfilesPoolEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs text-txt-primary">
                        Enable dotfiles pool sync (off by default)
                      </span>
                    </label>
                    <p className="pl-6 text-xs text-txt-muted leading-relaxed">
                      Keeps chosen dotfiles (.bashrc, .vimrc, etc.) present on servers you connect to. Disabled
                      here, nothing runs. Even when enabled, a host only syncs after you explicitly assign it a
                      pool and a sync policy in its connection profile.
                    </p>
                    {dotfilesPoolEnabled && (
                      <button
                        type="button"
                        onClick={() => setPoolManagerOpen(true)}
                        className="ml-6 flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1.5 text-xs text-sky-400 hover:bg-app-surface-hover transition-colors"
                      >
                        <FileCode className="h-3.5 w-3.5" />
                        Manage Dotfile Pools
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Security & Smartcard */}
              {activeCategory === 'security' && (
                <div className="space-y-4">
                  {/* OS SafeStorage */}
                  {credentialEncryptionAvailable === false ? (
                    <div className="rounded-lg border border-amber-500/30 bg-app-surface p-3.5 space-y-2">
                      <div className="flex items-center gap-2 text-amber-400">
                        <ShieldAlert className="h-4 w-4" />
                        <span className="font-semibold text-xs">Credentials are stored in plaintext</span>
                      </div>
                      <p className="text-xs text-txt-muted leading-relaxed">
                        No OS keyring (Secret Service / KWallet / gnome-keyring, etc.) was found, so sshs3 cannot
                        encrypt saved SSH and S3 credentials at rest. Any password, passphrase, or proxy password you
                        save is written to disk unencrypted. Install and unlock a keyring service to enable
                        encryption, or avoid saving credentials.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border-subtle bg-app-surface p-3.5 space-y-2">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Lock className="h-4 w-4" />
                        <span className="font-semibold text-xs">
                          {credentialEncryptionAvailable === null
                            ? 'Checking OS keychain encryption…'
                            : 'OS Keychain Encryption Active'}
                        </span>
                      </div>
                      <p className="text-xs text-txt-muted leading-relaxed">
                        All stored passwords, SSH passphrases, and S3 credentials are encrypted via Electron safeStorage
                        (libsecret on Linux, DPAPI on Windows, Keychain on macOS) before persisting to disk.
                      </p>
                    </div>
                  )}

                  {/* Smartcard PIN caching */}
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs font-medium text-txt-primary">
                        {IS_WINDOWS ? 'Smartcard PIN Caching' : 'Smartcard & Security Key PIN Caching'}
                      </label>
                      <p className="text-xs text-txt-muted">
                        {IS_WINDOWS
                          ? 'Applies to every Smartcard (PKCS#11) profile. FIDO2 security keys are not cached on Windows — they use a key file and ask for PIN and touch on every connection. Cached and per-terminal modes need the Windows OpenSSH Authentication Agent service to be running.'
                          : 'Applies to every Smartcard (PKCS#11) and FIDO2 resident key profile.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <label
                        className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                          smartcardAuthMode === 'always-prompt'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <input
                            type="radio"
                            name="smartcardAuthMode"
                            checked={smartcardAuthMode === 'always-prompt'}
                            onChange={() => setSmartcardAuthMode('always-prompt')}
                            className="hidden"
                          />
                          <Lock className="h-3.5 w-3.5 text-emerald-400" />
                          <span>Always Prompt (Default)</span>
                        </div>
                        <span className="text-xs text-txt-muted leading-tight">
                          No caching. Every connection that needs the {IS_WINDOWS ? 'card' : 'card or security key'} (terminal, dotfiles sync) prompts for its
                          own PIN. Use this if your organization requires re-authentication on every login.
                        </span>
                      </label>

                      <label
                        className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                          smartcardAuthMode === 'agent-per-session'
                            ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <input
                            type="radio"
                            name="smartcardAuthMode"
                            checked={smartcardAuthMode === 'agent-per-session'}
                            onChange={() => setSmartcardAuthMode('agent-per-session')}
                            className="hidden"
                          />
                          <Shield className="h-3.5 w-3.5 text-sky-400" />
                          <span>Once Per Terminal Connection</span>
                        </div>
                        <span className="text-xs text-txt-muted leading-tight">
                          {IS_WINDOWS
                            ? 'Enter the PIN once; the card is loaded into the Windows ssh-agent service for that terminal tab and its dotfiles sync. It is removed again as soon as that terminal disconnects — logging back in (even in the same app run) asks for the PIN again.'
                            : 'Enter the PIN once into a private, app-managed ssh-agent shared by that terminal tab and its dotfiles sync. Discarded as soon as that terminal disconnects — logging back in (even in the same app run) asks for the PIN again.'}
                        </span>
                      </label>

                      <label
                        className={`flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                          smartcardAuthMode === 'agent-global'
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                            : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <input
                            type="radio"
                            name="smartcardAuthMode"
                            checked={smartcardAuthMode === 'agent-global'}
                            onChange={() => setSmartcardAuthMode('agent-global')}
                            className="hidden"
                          />
                          <Globe className="h-3.5 w-3.5 text-amber-400" />
                          <span>Global (App Lifetime)</span>
                        </div>
                        <span className="text-xs text-txt-muted leading-tight">
                          Enter the PIN once per {IS_WINDOWS ? 'card' : 'card or key'}, shared by every terminal and profile using it, for as long as
                          the app runs. Most convenient, least strict — anything in the app can use the {IS_WINDOWS ? 'card' : 'card/key'} until
                          you quit or lock it manually below.{IS_WINDOWS ? ' On Windows the card is held by the shared ssh-agent service, so other programs using that agent can use it too.' : ''}
                        </span>
                      </label>
                    </div>

                    {smartcardAuthMode === 'agent-global' && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-2.5">
                        <p className="text-xs text-amber-300/90 leading-tight">
                          {IS_WINDOWS ? 'Cached smartcards stay' : 'Cached smartcard and security key agents stay'} unlocked until the app quits. Use the lock icon in the top bar
                          to lock them on demand without quitting.
                        </p>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-txt-primary border-t border-amber-500/20 pt-2.5">
                          <input
                            type="checkbox"
                            checked={smartcardUnlockAtStartup}
                            onChange={(e) => setSmartcardUnlockAtStartup(e.target.checked)}
                            className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
                          />
                          <span>Unlock smartcard at app startup</span>
                        </label>
                        <p className="text-xs text-txt-muted leading-tight pl-6">
                          Prompts for the PIN as soon as the app opens instead of waiting for the first connection
                          that needs it, so it's already unlocked once you get to a terminal. Uses the driver chosen
                          below; with Auto-detect it only takes effect when exactly one PKCS#11 library is detected
                          (or p11-kit is present).
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Smartcard & PKCS#11 Detection */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-txt-primary">
                        Detected PKCS#11 Hardware Token Libraries
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setDetectingSmartcard(true);
                          void window.multissh
                            ?.smartcardDetect?.()
                            ?.then((libs) => {
                              if (libs) setSmartcardLibs(libs.filter((l) => l.exists));
                            })
                            ?.finally(() => setDetectingSmartcard(false));
                        }}
                        className="text-xs text-sky-400 hover:underline"
                      >
                        Rescan
                      </button>
                    </div>

                    {detectingSmartcard ? (
                      <div className="py-4 text-center text-xs text-txt-muted">Scanning for PKCS#11 modules...</div>
                    ) : smartcardLibs.length === 0 ? (
                      <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-4 text-center text-xs text-txt-muted">
                        No hardware token modules automatically detected on system paths. You can still manually specify
                        a PKCS#11 library path in your SSH profiles.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-txt-muted">
                          Pick the driver used for the startup unlock and for linking Remote Profile Sync to your
                          card. Profiles keep their own driver setting.
                        </p>
                        <WindowsAgentPathNotice libPath={smartcardLibPath} />
                        {[{ path: '', name: 'Auto-detect', hint: 'Use p11-kit if present, otherwise the only detected module' }, ...smartcardLibs].map(
                          (lib) => {
                            const selected = smartcardLibPath === lib.path;
                            const isAuto = lib.path === '';
                            return (
                              <label
                                key={lib.path || 'auto'}
                                className={`flex cursor-pointer items-center justify-between rounded-lg border p-2.5 text-xs transition-colors ${
                                  selected
                                    ? 'border-sky-500 bg-sky-500/15'
                                    : 'border-border-subtle bg-app-surface hover:bg-app-surface-hover'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="smartcardLibPath"
                                  checked={selected}
                                  onChange={() => setSmartcardLibPath(lib.path)}
                                  className="hidden"
                                />
                                <div className="min-w-0 pr-2">
                                  <div className="flex items-center gap-1.5 font-medium text-txt-primary">
                                    <CheckCircle2
                                      className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-sky-400' : 'text-emerald-400'}`}
                                    />
                                    <span>{isAuto || !IS_WINDOWS ? lib.name : pkcs11LibDisplayName(lib.path)}</span>
                                  </div>
                                  <div
                                    className="truncate font-mono text-2xs text-txt-muted"
                                    title={isAuto ? undefined : lib.path}
                                  >
                                    {isAuto ? (lib as { hint?: string }).hint : lib.path}
                                  </div>
                                </div>
                                <span
                                  className={`rounded px-2 py-0.5 text-2xs font-medium shrink-0 ${
                                    selected ? 'bg-sky-500/20 text-sky-300' : 'bg-sky-500/10 text-sky-400'
                                  }`}
                                >
                                  {selected ? 'Default' : isAuto ? 'Automatic' : 'Available'}
                                </span>
                              </label>
                            );
                          }
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Category: Synchronization */}
              {activeCategory === 'sync' && <SyncSettingsPanel />}

              {/* Category: Git & GitHub */}
              {activeCategory === 'git' && (
                <GitSettingsPanel
                  fileManagerGitIntegration={fileManagerGitIntegration}
                  onChangeFileManagerGitIntegration={setFileManagerGitIntegration}
                />
              )}

              {/* Category: Keyboard Shortcuts */}
              {activeCategory === 'shortcuts' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-txt-muted" />
                      <input
                        aria-label="Search keyboard shortcuts"
                        type="text"
                        placeholder="Search keyboard shortcuts..."
                        value={shortcutSearch}
                        onChange={(e) => setShortcutSearch(e.target.value)}
                        className="w-full rounded-lg border border-border-subtle bg-app-surface py-1.5 pl-8 pr-3 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleResetShortcuts}
                      className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary shrink-0 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Defaults</span>
                    </button>
                  </div>

                  <div className="space-y-1">
                    {filteredShortcuts.map((def) => {
                      const currentKey = shortcuts[def.id] || def.defaultKeys;
                      const isRecording = recordingAction === def.id;

                      return (
                        <div
                          key={def.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs"
                        >
                          <div className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate font-medium text-txt-primary">{def.name}</span>
                            <span className="shrink-0 text-2xs text-txt-muted">{def.category}</span>
                          </div>

                          <div>
                            {isRecording ? (
                              <button
                                type="button"
                                onKeyDown={(e) => handleKeyDownRecord(e, def.id)}
                                autoFocus
                                className="rounded-md border border-sky-500 bg-sky-950 px-2.5 py-0.5 font-mono text-xs text-sky-300 outline-none animate-pulse"
                              >
                                Press keys (Esc to cancel)...
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setRecordingAction(def.id)}
                                className="rounded-md border border-border-subtle bg-app-input px-2.5 py-0.5 font-mono text-xs text-txt-primary hover:border-sky-500 hover:text-sky-400 transition-colors"
                              >
                                {currentKey}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Category: Kubernetes & Debug */}
              {activeCategory === 'kubernetes' && (
                <div className="space-y-6">
                  {/* OpenShift Support Toggle */}
                  <div className="rounded-xl border border-border-subtle bg-app-surface p-4 space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableOpenShift}
                        onChange={(e) => setEnableOpenShift(e.target.checked)}
                        className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
                      />
                      <span className="text-xs font-semibold text-txt-primary">
                        Enable OpenShift Support
                      </span>
                    </label>
                    <p className="pl-6 text-xs text-txt-muted leading-relaxed">
                      Enables OpenShift-specific capabilities, such as the OpenShift Login dialog (token-based <code>oc login</code>) in the Kubernetes connection tree and the local <code>oc</code> CLI shim in terminal sessions.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-semibold text-txt-primary">Kubernetes & OpenShift Debug Images</h3>
                        <p className="text-xs text-txt-muted mt-0.5">
                          Pre-configured container images used when attaching an ephemeral debug container (<code>kubectl debug</code>) into a running pod.
                        </p>
                      </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setK8sDebugImages([...DEFAULT_K8S_DEBUG_IMAGES])}
                        className="flex items-center gap-1 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1 text-xs text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-txt-muted" />
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAddDebugImage((prev) => !prev)}
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 transition-colors shadow-sm"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Image
                      </button>
                    </div>
                  </div>

                  {/* Add New Image Form Card */}
                  {showAddDebugImage && (
                    <div className="rounded-xl border border-sky-500/30 bg-app-surface p-4 space-y-3">
                      <div className="font-semibold text-xs text-txt-primary">Add Custom Debug Image</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-txt-secondary">Display Name *</label>
                          <input
                            aria-label="Display name"
                            type="text"
                            value={newImageName}
                            onChange={(e) => setNewImageName(e.target.value)}
                            placeholder="e.g. Alpine Linux"
                            className="w-full rounded-lg border border-border-subtle bg-app-card px-2.5 py-1.5 text-xs text-txt-primary focus:border-sky-500 focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-txt-secondary">Image Reference *</label>
                          <input
                            aria-label="Image reference"
                            type="text"
                            value={newImageRef}
                            onChange={(e) => setNewImageRef(e.target.value)}
                            placeholder="e.g. alpine:latest"
                            className="w-full rounded-lg border border-border-subtle bg-app-card px-2.5 py-1.5 font-mono text-xs text-txt-primary focus:border-sky-500 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1 sm:col-span-1">
                          <label className="text-xs font-medium text-txt-secondary">Default Shell / Command</label>
                          <input
                            aria-label="Default shell / command"
                            type="text"
                            value={newImageCmd}
                            onChange={(e) => setNewImageCmd(e.target.value)}
                            placeholder="e.g. sh or bash"
                            className="w-full rounded-lg border border-border-subtle bg-app-card px-2.5 py-1.5 font-mono text-xs text-txt-primary focus:border-sky-500 focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-xs font-medium text-txt-secondary">Description</label>
                          <input
                            aria-label="Description"
                            type="text"
                            value={newImageDesc}
                            onChange={(e) => setNewImageDesc(e.target.value)}
                            placeholder="e.g. Lightweight shell with apk package manager"
                            className="w-full rounded-lg border border-border-subtle bg-app-card px-2.5 py-1.5 text-xs text-txt-primary focus:border-sky-500 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddDebugImage(false);
                            setNewImageName('');
                            setNewImageRef('');
                            setNewImageCmd('');
                            setNewImageDesc('');
                          }}
                          className="rounded-lg border border-border-subtle px-3 py-1 text-xs text-txt-secondary hover:bg-app-surface-hover transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!newImageName.trim() || !newImageRef.trim()) return;
                            const newEntry: K8sDebugImage = {
                              id: `custom-${Date.now()}`,
                              name: newImageName.trim(),
                              image: newImageRef.trim(),
                              defaultCommand: newImageCmd.trim() || 'sh',
                              description: newImageDesc.trim() || undefined,
                            };
                            setK8sDebugImages((prev) => [...prev, newEntry]);
                            setShowAddDebugImage(false);
                            setNewImageName('');
                            setNewImageRef('');
                            setNewImageCmd('');
                            setNewImageDesc('');
                          }}
                          disabled={!newImageName.trim() || !newImageRef.trim()}
                          className="rounded-lg bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors shadow-sm"
                        >
                          Save Image
                        </button>
                      </div>
                    </div>
                  )}

                  {/* List of Configured Debug Images */}
                  <div className="space-y-2.5">
                    {k8sDebugImages.map((img) => (
                      <div
                        key={img.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-border-subtle bg-app-surface p-3 transition-colors hover:border-sky-500/30"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-txt-primary text-xs">{img.name}</span>
                            {img.defaultCommand && (
                              <span className="rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.2 font-mono text-2xs text-sky-400">
                                {img.defaultCommand}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-txt-secondary break-all">
                            {img.image}
                          </div>
                          {img.description && (
                            <p className="text-xs text-txt-muted">{img.description}</p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (k8sDebugImages.length <= 1) return;
                            setK8sDebugImages((prev) => prev.filter((item) => item.id !== img.id));
                          }}
                          disabled={k8sDebugImages.length <= 1}
                          title={k8sDebugImages.length <= 1 ? 'At least one debug image is required' : 'Delete debug image'}
                          className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-red-400 transition-colors disabled:opacity-30 disabled:hover:text-txt-muted"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            </div>
            {hasMoreBelow && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-app-card to-transparent"
              />
            )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-divider bg-app-surface px-5 py-3">
              {activeCategory === 'sync' ? (
                <>
                  <p className="mr-auto text-xs text-txt-muted">
                    Synchronization changes save immediately — nothing to save here.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
                  >
                    Close
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-border-subtle px-3.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
                  >
                    Save Settings
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>

      <DotfilePoolManagerModal open={poolManagerOpen} onClose={() => setPoolManagerOpen(false)} />
    </div>
  );
};

export default SettingsModal;
