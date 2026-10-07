import type { LogLevel } from '@shared/types/log';
import React, { useState, useEffect, useRef } from 'react';
import { useUpdateState } from '../../lib/useUpdateState';
import { DEFAULT_PERF_ITEMS, type PerfLayout, type PerfMetricId } from '@shared/types/perf';
import { SHORTCUT_DEFINITIONS, DEFAULT_SHORTCUTS, type AppSettings, type AppTheme, type SessionExitAction, type SmartcardAuthMode } from '@shared/types/settings';
import { DEFAULT_K8S_DEBUG_IMAGES, type K8sDebugImage } from '@shared/types/kubernetes';
import type { DetectedSmartcardLib, XServerStatus } from '@shared/types/ssh';
import { comboFromKeyboardEvent } from '../../lib/shortcuts';
import { type SettingsCategory, normalizeAgentMode } from './settingsConstants';

interface UseSettingsFormArgs {
  open: boolean;
  currentSettings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

/** All editable settings as draft state, the data they load on open, and the handlers the panels share. */
export function useSettingsForm({ open, currentSettings, onSave, onClose }: UseSettingsFormArgs) {
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
  const [logLevel, setLogLevel] = useState<LogLevel>(currentSettings.logLevel ?? 'info');
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
  const [autoSyncLocalSshConfig, setAutoSyncLocalSshConfig] = useState<boolean>(
    currentSettings.autoSyncLocalSshConfig ?? true
  );
  const [localTerminalAgentMode, setLocalTerminalAgentMode] = useState<'auto' | 'system' | 'app-managed' | 'disabled'>(
    normalizeAgentMode(currentSettings.localTerminalAgentMode)
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

  // Re-seed the draft only when the dialog opens. An external settings change while it is open
  // (e.g. the font-size shortcuts) must not throw away what the user has edited.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (justOpened) {
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
      setLogLevel(currentSettings.logLevel ?? 'info');
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
      setLocalTerminalAgentMode(normalizeAgentMode(currentSettings.localTerminalAgentMode));
      setAutoSyncLocalSshConfig(currentSettings.autoSyncLocalSshConfig ?? true);
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
      logLevel,
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
      autoSyncLocalSshConfig,
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

  const filteredShortcuts = SHORTCUT_DEFINITIONS.filter(
    (s) =>
      !shortcutSearch ||
      s.name.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
      s.category.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
      s.defaultKeys.toLowerCase().includes(shortcutSearch.toLowerCase())
  );

  return {
    activeCategory,
    setActiveCategory,
    theme,
    setTheme,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    cursorStyle,
    setCursorStyle,
    scrollback,
    setScrollback,
    copyOnSelect,
    setCopyOnSelect,
    clipboardScope,
    setClipboardScope,
    clipboardClearOnExit,
    setClipboardClearOnExit,
    perfEnabled,
    setPerfEnabled,
    perfLayout,
    setPerfLayout,
    perfItems,
    setPerfItems,
    perfIntervalSec,
    setPerfIntervalSec,
    sessionExitAction,
    setSessionExitAction,
    autoCheckUpdates,
    setAutoCheckUpdates,
    confirmBeforeQuit,
    setConfirmBeforeQuit,
    logLevel,
    setLogLevel,
    defaultNewTab,
    setDefaultNewTab,
    defaultConflictPolicy,
    setDefaultConflictPolicy,
    showHiddenFiles,
    setShowHiddenFiles,
    verifyTransferIntegrity,
    setVerifyTransferIntegrity,
    shareFoldersAcrossTypes,
    setShareFoldersAcrossTypes,
    confirmBeforeDelete,
    setConfirmBeforeDelete,
    dotfilesPoolEnabled,
    setDotfilesPoolEnabled,
    smartcardAuthMode,
    setSmartcardAuthMode,
    smartcardUnlockAtStartup,
    setSmartcardUnlockAtStartup,
    smartcardLibPath,
    setSmartcardLibPath,
    fileManagerGitIntegration,
    setFileManagerGitIntegration,
    autoSyncLocalSshConfig,
    setAutoSyncLocalSshConfig,
    localTerminalAgentMode,
    setLocalTerminalAgentMode,
    poolManagerOpen,
    setPoolManagerOpen,
    shortcuts,
    setShortcuts,
    recordingAction,
    setRecordingAction,
    shortcutSearch,
    setShortcutSearch,
    smartcardLibs,
    setSmartcardLibs,
    detectingSmartcard,
    setDetectingSmartcard,
    x11ServerMode,
    setX11ServerMode,
    x11ServerPath,
    setX11ServerPath,
    x11ServerArgs,
    setX11ServerArgs,
    x11Status,
    setX11Status,
    x11Operating,
    setX11Operating,
    platform,
    setPlatform,
    enableOpenShift,
    setEnableOpenShift,
    k8sDebugImages,
    setK8sDebugImages,
    showAddDebugImage,
    setShowAddDebugImage,
    newImageName,
    setNewImageName,
    newImageRef,
    setNewImageRef,
    newImageCmd,
    setNewImageCmd,
    newImageDesc,
    setNewImageDesc,
    credentialEncryptionAvailable,
    setCredentialEncryptionAvailable,
    updateState,
    isLinux,
    refreshX11Status,
    handleStartX11,
    handleStopX11,
    handleBrowseX11Path,
    handleSubmit,
    handleResetShortcuts,
    handleKeyDownRecord,
    filteredShortcuts,
  };
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;
