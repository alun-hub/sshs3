import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
} from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';
import type { TransferConflictResolution } from '@shared/types/ipc';
import type { GitRepoStatus } from '@shared/types/git';
import { joinPath, parentPath, describeIpcError } from '../../lib/format';
import { FileList } from './FileList';
import { useDragDrop } from './DragDropContext';
import { useConfirm } from '../ConfirmDialog';
import type { DirectorySyncModalSource } from './DirectorySyncModal';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { buildContextMenuItems } from './filePaneContextMenu';
import { FilePaneModals } from './FilePaneModals';
import { GitStatusMenu } from './GitStatusMenu';
import { FilePaneToolbar } from './FilePaneToolbar';
import { FilePaneFilterBar } from './FilePaneFilterBar';
import { useNavHistory } from '../../lib/useNavHistory';
import { SOURCE_ICONS } from './filePaneHelpers';
import { recursiveFilterFiles, RECURSIVE_MAX_RESULTS } from '../../lib/recursiveFilter';
import { buildDragPayload, type PaneSide, type PaneSource, type SourceType } from './types';
import { comboFromKeyboardEvent } from '../../lib/shortcuts';
import { DEFAULT_SHORTCUTS } from '@shared/types/settings';

interface FilePaneProps {
  side: PaneSide;
  source: PaneSource;
  currentPath: string;
  isActive?: boolean;
  onFocus?: () => void;
  onPathChange: (path: string) => void;
  onSourceTypeRequest: (type: SourceType) => void;
  onTransferRequested: (params: { sourceProviderId: string; sourcePaths: string[]; targetPath: string }) => void;
  onOpenTerminal?: (path: string) => void;
  refreshToken: number;
  /** The sibling pane's current connection + path, offered as a one-click target in "Sync to...". */
  otherPane?: DirectorySyncModalSource;
  /** Current keyboard shortcut bindings, used to open Search in Files while this pane has focus. */
  shortcuts?: Record<string, string>;
  /** Settings > Files & Storage > "Show hidden files and dotfiles". Off by default — entries whose name starts with "." are filtered out of the list (but still counted/selectable if already selected). */
  showHiddenFiles?: boolean;
  /** Settings > Git & GitHub > "SFTP & File Manager Git Integration". On by default. */
  gitIntegrationEnabled?: boolean;
}

export const FilePane: React.FC<FilePaneProps> = ({
  side,
  source,
  currentPath,
  isActive = false,
  onFocus,
  onPathChange,
  onSourceTypeRequest,
  onTransferRequested,
  onOpenTerminal,
  refreshToken,
  otherPane,
  shortcuts,
  showHiddenFiles = false,
  gitIntegrationEnabled = true,
}) => {
  const onPathChangeRef = useRef(onPathChange);
  onPathChangeRef.current = onPathChange;
  const lastPasteTimeRef = useRef(0);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  // UX audit finding #1: Settings > Files & Storage > "Show hidden files and
  // dotfiles" existed and persisted, but nothing ever read it back — the
  // list always showed dotfiles regardless of the toggle. Filtering only the
  // list view (not the `entries` state itself) keeps drag/select/refresh
  // logic working against the full listing.
  const [recursiveFilter, setRecursiveFilter] = useState(false);
  const [recursiveEntries, setRecursiveEntries] = useState<FileEntry[]>([]);
  const [recursiveScanning, setRecursiveScanning] = useState(false);
  const [recursiveNote, setRecursiveNote] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const recursiveActive = recursiveFilter && filterText.trim().length > 0;
  // While a recursive filter is active the list shows the walk's hits (names are
  // relative paths, `path` is the real full path) instead of the current folder.
  const activeEntries = recursiveActive ? recursiveEntries : entries;
  const visibleEntries = useMemo(
    () =>
      showHiddenFiles || recursiveActive ? activeEntries : activeEntries.filter((e) => !e.name.startsWith('.')),
    [activeEntries, showHiddenFiles, recursiveActive]
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [chmodOpen, setChmodOpen] = useState(false);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [bucketPolicyOpen, setBucketPolicyOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [presignedOpen, setPresignedOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [addToDotfilesOpen, setAddToDotfilesOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [editorEntry, setEditorEntry] = useState<FileEntry | null>(null);
  const [editorTailMode, setEditorTailMode] = useState(false);
  const [dotfilesFeedback, setDotfilesFeedback] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitRepoStatus | null>(null);
  const [gitCloneOpen, setGitCloneOpen] = useState(false);
  const [gitCloneTargetDir, setGitCloneTargetDir] = useState<string | null>(null);
  const [gitPulling, setGitPulling] = useState(false);

  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const {
    activeDrag,
    beginDrag,
    endDrag,
    readDropPayload,
    readOsFilePaths,
    clipboard,
    copyFiles,
    cutFiles,
    clearClipboard,
  } = useDragDrop();
  const confirm = useConfirm();
  const latestRequestRef = useRef<string>('');

  const { canGoBack, canGoForward, handleGoBack, handleGoForward } = useNavHistory(
    currentPath,
    source.providerId,
    onPathChange
  );

  const handleGoHome = useCallback(async () => {
    try {
      if (source.sourceType === 'sftp') {
        let home: string | undefined;
        try {
          home = await window.multissh.storageGetHomeDir(source.providerId);
        } catch {
          // ignore
        }
        if (!home || home === '/') {
          home = '/home/user';
        }
        onPathChange(home);
      } else if (source.sourceType === 'local') {
        const home = await window.multissh.getHomeDir?.();
        if (home) {
          onPathChange(home);
        }
      }
    } catch (err) {
      console.warn('Could not navigate to home directory:', err);
      if (source.sourceType === 'sftp') {
        onPathChange('/home/user');
      }
    }
  }, [onPathChange, source.providerId, source.sourceType]);

  // Clipboard operations
  const handleCopy = useCallback(() => {
    if (selectedPaths.size === 0) return;
    copyFiles(side, source.providerId, Array.from(selectedPaths));
  }, [selectedPaths, copyFiles, side, source.providerId]);

  const handleCut = useCallback(() => {
    if (selectedPaths.size === 0) return;
    cutFiles(side, source.providerId, Array.from(selectedPaths));
  }, [selectedPaths, cutFiles, side, source.providerId]);

  const handlePaste = useCallback(() => {
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 200) return;
    lastPasteTimeRef.current = now;
    if (!clipboard || clipboard.sourcePaths.length === 0) return;
    onTransferRequested({
      sourceProviderId: clipboard.providerId,
      sourcePaths: clipboard.sourcePaths,
      targetPath: currentPath,
    });
    if (clipboard.mode === 'cut') {
      clearClipboard();
    }
  }, [clipboard, onTransferRequested, currentPath, clearClipboard]);

  const load = useCallback(
    async (force?: boolean) => {
      const requestKey = `${source.providerId}::${currentPath}`;
      latestRequestRef.current = requestKey;
      setLoading(true);
      setError(null);
      try {
        const result = await window.multissh.storageList(source.providerId, currentPath, force);
        // A newer pane connection/navigation may have started while this request was
        // in flight (e.g. switching profiles before a slow SFTP host responds) — discard
        // a stale response instead of clobbering the pane with the wrong host's content.
        if (latestRequestRef.current !== requestKey) return;
        setEntries(result);

        if (gitIntegrationEnabled && (source.sourceType === 'local' || source.sourceType === 'sftp')) {
          window.multissh
            .gitGetStatus(currentPath, source.providerId)
            .then((status) => {
              if (latestRequestRef.current === requestKey) {
                setGitStatus(status);
              }
            })
            .catch(() => {
              if (latestRequestRef.current === requestKey) {
                setGitStatus(null);
              }
            });
        } else {
          setGitStatus(null);
        }
      } catch (err) {
        if (latestRequestRef.current !== requestKey) return;
        if (source.sourceType === 'local') {
          const home = await window.multissh.getHomeDir?.();
          if (home && currentPath !== home) {
            onPathChangeRef.current?.(home);
            return;
          }
        } else if (source.sourceType === 'sftp') {
          try {
            const home = await window.multissh.storageGetHomeDir(source.providerId);
            if (home && currentPath !== home) {
              onPathChangeRef.current?.(home);
              return;
            }
          } catch {
            // ignore fallback error and report main error below
          }
        }
        let msg = describeIpcError(err, 'Could not read the folder contents');
        msg = msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '');
        if (msg.includes('All configured authentication methods failed') || msg.toLowerCase().includes('authentication failed')) {
          msg = 'Authentication failed: The password or key was rejected by the server.';
        } else if (msg.includes('getConnection')) {
          const clean = msg.replace(/^getConnection:?\s*/i, '').trim();
          msg = `Could not connect to SFTP: ${clean || 'Connection failed'}`;
        }
        setError(msg);
        setEntries([]);
      } finally {
        if (latestRequestRef.current === requestKey) setLoading(false);
      }
    },
    [source.providerId, source.sourceType, currentPath, gitIntegrationEnabled]
  );

  const handleGitPull = useCallback(async () => {
    setGitPulling(true);
    try {
      const res = await window.multissh.gitPull(currentPath, source.providerId);
      if (!res.success) {
        setError(res.error || 'Git pull failed');
      } else {
        void load(true);
      }
    } catch (err) {
      setError(describeIpcError(err, 'Git pull failed'));
    } finally {
      setGitPulling(false);
    }
  }, [currentPath, source.providerId, load]);

  useEffect(() => {
    if (!gitIntegrationEnabled) {
      setGitStatus(null);
    }
  }, [gitIntegrationEnabled]);

  useEffect(() => {
    setSelectedPaths(new Set());
    void load(true);
  }, [load, refreshToken, currentPath]);

  // Only navigation resets the filter; a refresh (e.g. after a finished transfer) keeps it.
  useEffect(() => {
    setFilterText('');
  }, [source.providerId, currentPath]);

  useEffect(() => {
    setRecursiveEntries([]);
    setRecursiveNote(null);
    if (!recursiveActive) {
      setRecursiveScanning(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setRecursiveScanning(true);
      recursiveFilterFiles({
        providerId: source.providerId,
        rootPath: currentPath,
        query: filterText,
        showHidden: showHiddenFiles,
        signal: controller.signal,
        list: (providerId, path) => window.multissh.storageList(providerId, path),
        onResults: setRecursiveEntries,
      })
        .then((summary) => {
          if (controller.signal.aborted) return;
          const notes: string[] = [];
          if (summary.truncated) notes.push(`limit reached (${RECURSIVE_MAX_RESULTS} hits / folder cap) — narrow the filter`);
          if (summary.skippedDirs > 0) notes.push(`${summary.skippedDirs} folder(s) unreadable`);
          setRecursiveNote(notes.length > 0 ? notes.join(' · ') : null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setRecursiveScanning(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [recursiveActive, filterText, source.providerId, currentPath, showHiddenFiles, refreshToken]);

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        onPathChange(entry.path);
      } else {
        setEditorEntry(entry);
      }
    },
    [onPathChange]
  );

  const handleOpenExternal = useCallback(
    async (entry: FileEntry) => {
      try {
        await window.multissh.fileOpenExternal(source.providerId, entry.path);
      } catch (err) {
        setError(describeIpcError(err, 'Failed to open external editor'));
      }
    },
    [source.providerId]
  );

  const handleNewFolder = useCallback(() => {
    setNewFolderOpen(true);
  }, []);

  const handleCreateFolderCommit = useCallback(
    async (name: string) => {
      await window.multissh.storageCreateFolder(source.providerId, joinPath(currentPath, name));
      await load(true);
    },
    [source.providerId, currentPath, load]
  );

  const handleDelete = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    const targets = activeEntries.filter((e) => selectedPaths.has(e.path));
    const message =
      targets.length === 1 ? (
        <>
          Delete <strong className="text-txt-primary">{targets[0].name}</strong>
          {targets[0].isDirectory ? ' and everything inside it' : ''}?
        </>
      ) : (
        <>
          Delete <strong className="text-txt-primary">{targets.length} items</strong>? This includes:
          <ul className="mt-1.5 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-txt-muted">
            {targets.slice(0, 8).map((t) => (
              <li key={t.path} className="truncate">
                {t.name}
              </li>
            ))}
          </ul>
          {targets.length > 8 && <span className="text-txt-muted">…and {targets.length - 8} more.</span>}
        </>
      );
    if (!(await confirm({ title: 'Delete items', message, confirmLabel: 'Delete' }))) return;
    setLoading(true);
    setError(null);
    try {
      for (const target of targets) {
        await window.multissh.storageDelete(source.providerId, target.path, target.isDirectory);
      }
      setSelectedPaths(new Set());
      await load(true);
    } catch (err) {
      let msg = describeIpcError(err, 'Failed to delete item(s)');
      msg = msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedPaths, activeEntries, source.providerId, load, confirm]);

  const handleDownloadTo = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    const targetFolder = await window.multissh.dialogOpenFolder({ title: 'Download to...' });
    if (!targetFolder) return;
    const targets = activeEntries.filter((e) => selectedPaths.has(e.path));
    try {
      let batchPolicy: TransferConflictResolution | undefined;
      for (const target of targets) {
        const result = await window.multissh.transferAdd({
          sourceProviderId: source.providerId,
          sourcePath: target.path,
          targetProviderId: 'local',
          targetPath: targetFolder,
          conflictPolicy: batchPolicy,
        });
        if (result.appliedToAll && result.resolvedPolicy) {
          batchPolicy = result.resolvedPolicy;
        }
      }
    } catch (err) {
      setError(describeIpcError(err, 'Failed to start download'));
    }
  }, [selectedPaths, activeEntries, source.providerId]);

  const handleRenameStart = useCallback(() => {
    // Recursive hits carry a relative path as name, which rename would mistake for a new path.
    if (selectedPaths.size !== 1 || recursiveActive) return;
    setRenamingPath([...selectedPaths][0]);
  }, [selectedPaths, recursiveActive]);

  const handleRenameCommit = useCallback(
    async (entry: FileEntry, newName: string) => {
      setRenamingPath(null);
      const trimmed = newName.trim();
      if (!trimmed || trimmed === entry.name) return;
      // Rename replaces an existing destination on every provider, so refuse instead of silently overwriting it.
      if (entries.some((e) => e.path !== entry.path && parentPath(e.path) === parentPath(entry.path) && e.name === trimmed)) {
        setError(`"${trimmed}" already exists in this folder`);
        return;
      }
      const targetPath = joinPath(parentPath(entry.path), trimmed);
      try {
        await window.multissh.storageRename(source.providerId, entry.path, targetPath);
        await load();
      } catch (err) {
        setError(describeIpcError(err, 'Failed to rename'));
      }
    },
    [source.providerId, load, entries]
  );

  const isDropTarget = useCallback(
    (entry: FileEntry) => entry.isDirectory,
    []
  );

  const handleEntryDrop = useCallback(
    (targetEntry: FileEntry, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);
      const osPaths = readOsFilePaths(e.dataTransfer);
      if (osPaths.length > 0) {
        onTransferRequested({
          sourceProviderId: 'local',
          sourcePaths: osPaths,
          targetPath: targetEntry.path,
        });
        endDrag();
        return;
      }
      const payload = readDropPayload(e.dataTransfer);
      if (!payload) return;
      if (payload.entries.some((i) => i.path === targetEntry.path)) {
        endDrag();
        return;
      }
      onTransferRequested({
        sourceProviderId: payload.providerId,
        sourcePaths: payload.entries.map((i) => i.path),
        targetPath: targetEntry.path,
      });
      endDrag();
    },
    [readOsFilePaths, readDropPayload, onTransferRequested, endDrag]
  );

  const handlePaneDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const osPaths = readOsFilePaths(e.dataTransfer);
      if (osPaths.length > 0) {
        onTransferRequested({
          sourceProviderId: 'local',
          sourcePaths: osPaths,
          targetPath: currentPath,
        });
        endDrag();
        return;
      }
      const payload = readDropPayload(e.dataTransfer);
      if (!payload) return;
      if (payload.fromPane === side && payload.providerId === source.providerId) {
        endDrag();
        return;
      }
      onTransferRequested({
        sourceProviderId: payload.providerId,
        sourcePaths: payload.entries.map((i) => i.path),
        targetPath: currentPath,
      });
      endDrag();
    },
    [readOsFilePaths, readDropPayload, onTransferRequested, currentPath, source.providerId, side, endDrag]
  );

  const handleBreadcrumbDrop = useCallback(
    (targetPath: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);
      const osPaths = readOsFilePaths(e.dataTransfer);
      if (osPaths.length > 0) {
        onTransferRequested({
          sourceProviderId: 'local',
          sourcePaths: osPaths,
          targetPath,
        });
        endDrag();
        return;
      }
      const payload = readDropPayload(e.dataTransfer);
      if (!payload) return;
      if (payload.entries.some((i) => i.path === targetPath)) {
        endDrag();
        return;
      }
      if (payload.fromPane === side && payload.providerId === source.providerId && targetPath === currentPath) {
        endDrag();
        return;
      }
      onTransferRequested({
        sourceProviderId: payload.providerId,
        sourcePaths: payload.entries.map((i) => i.path),
        targetPath,
      });
      endDrag();
    },
    [readOsFilePaths, readDropPayload, onTransferRequested, endDrag, side, source.providerId, currentPath]
  );

  const supportsChmod = source.sourceType !== 's3';
  const selectedEntries = activeEntries.filter((e) => selectedPaths.has(e.path));

  const isAtBucketRoot = source.sourceType === 's3' && (currentPath === '' || currentPath === '/');
  const isBucketEntry =
    isAtBucketRoot && selectedEntries.length === 1 && selectedEntries[0].isDirectory;
  const isS3ObjectEntry =
    source.sourceType === 's3' &&
    !isAtBucketRoot &&
    selectedEntries.length === 1 &&
    !selectedEntries[0].isDirectory;
  const selectedAreAllFiles = selectedEntries.length > 0 && selectedEntries.every((e) => !e.isDirectory);

  const contextMenuItems: ContextMenuItem[] = buildContextMenuItems({
    contextMenuOpen: contextMenu !== null,
    selectedEntries,
    sourceType: source.sourceType,
    currentPath,
    clipboard,
    gitIntegrationEnabled,
    gitStatus,
    supportsChmod,
    isBucketEntry,
    isS3ObjectEntry,
    selectedAreAllFiles,
    handleOpen,
    handleOpenExternal,
    handleCut,
    handleCopy,
    handlePaste,
    handleRenameStart,
    handleDownloadTo,
    handleGitPull,
    handleDelete,
    handleNewFolder,
    load,
    setSyncModalOpen,
    setEditorTailMode,
    setEditorEntry,
    setChmodOpen,
    setAddToDotfilesOpen,
    setTagsOpen,
    setBucketPolicyOpen,
    setVersionsOpen,
    setPresignedOpen,
    setGitCloneTargetDir,
    setGitCloneOpen,
    setPropertiesOpen,
    setSearchOpen,
  });

  const SourceIcon = SOURCE_ICONS[source.sourceType];
  const isReceivingForeignDrag = activeDrag !== null && activeDrag.fromPane !== side;

  const handlePaneKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const isInput =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);

    if (e.key === 'F5') {
      e.preventDefault();
      void load(true);
      return;
    }

    if (isInput) return;

    if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault();
      onPathChange(parentPath(currentPath));
      return;
    }

    if (e.key === 'ArrowLeft' && e.altKey) {
      e.preventDefault();
      handleGoBack();
      return;
    }

    if (e.key === 'ArrowRight' && e.altKey) {
      e.preventDefault();
      handleGoForward();
      return;
    }

    if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCopy();
      return;
    }

    if (e.key === 'x' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCut();
      return;
    }

    if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handlePaste();
      return;
    }

    const combo = comboFromKeyboardEvent(e);
    if (combo === null) return;
    const binding = (shortcuts || DEFAULT_SHORTCUTS)['searchInFiles'];
    if (binding && combo.toLowerCase() === binding.toLowerCase()) {
      e.preventDefault();
      setSearchOpen(true);
    }
  };

  return (
    <div
      data-testid={`file-pane-${side}`}
      className={`flex h-full min-w-0 flex-1 flex-col rounded-xl border transition-all duration-150 bg-app-card overflow-hidden ${
        isActive
          ? 'border-sky-500/50 shadow-md ring-1 ring-inset ring-sky-500/20'
          : 'border-border-subtle shadow-sm'
      }`}
      onClickCapture={onFocus}
      onFocusCapture={onFocus}
      onKeyDown={handlePaneKeyDown}
      onMouseUp={(e) => {
        if (e.button === 3) {
          e.preventDefault();
          handleGoBack();
        } else if (e.button === 4) {
          e.preventDefault();
          handleGoForward();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handlePaneDrop(e);
      }}
    >
      {/* Pane Top Bar with Source Switcher */}
      <div className="flex items-center justify-between border-b border-divider bg-app-surface px-2.5 py-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border-subtle bg-app-card p-0.5 text-xs">
            {(['local', 'sftp', 's3', 'k8s'] as SourceType[]).map((type) => {
              const Icon = SOURCE_ICONS[type];
              const titleMap: Record<SourceType, string> = {
                local: 'Local Disk',
                sftp: 'SFTP',
                s3: 'S3 Object Storage',
                k8s: 'Kubernetes Pods',
              };
              return (
                <button
                  key={type}
                  type="button"
                  title={titleMap[type]}
                  onClick={() => onSourceTypeRequest(type)}
                  className={
                    'rounded-md p-1 transition-colors ' +
                    (source.sourceType === type
                      ? 'bg-sky-600 text-white font-medium shadow-sm'
                      : 'text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary')
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 truncate text-xs font-medium text-txt-primary">
            <SourceIcon className="h-3.5 w-3.5 text-sky-400" />
            {source.label}
          </span>
        </div>
        {isActive && (
          <span className="rounded-full bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-2xs font-semibold text-sky-400 select-none">
            Active
          </span>
        )}
      </div>

      {/* Pane Action Toolbar */}
      <FilePaneToolbar
        sourceType={source.sourceType}
        currentPath={currentPath}
        selectedCount={selectedPaths.size}
        firstSelected={selectedEntries[0]}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        showFilter={showFilter}
        setShowFilter={setShowFilter}
        filterText={filterText}
        filterInputRef={filterInputRef}
        handleGoBack={handleGoBack}
        handleGoForward={handleGoForward}
        handleGoHome={handleGoHome}
        onPathChange={onPathChange}
        handleBreadcrumbDrop={handleBreadcrumbDrop}
        load={load}
        handleNewFolder={handleNewFolder}
        handleRenameStart={handleRenameStart}
        handleDelete={handleDelete}
        setEditorEntry={setEditorEntry}
        setChmodOpen={setChmodOpen}
        setSearchOpen={setSearchOpen}
        onOpenTerminal={onOpenTerminal}
      >
        <GitStatusMenu
          enabled={gitIntegrationEnabled}
          gitStatus={gitStatus}
          gitPulling={gitPulling}
          sourceType={source.sourceType}
          currentPath={currentPath}
          onPull={handleGitPull}
          onCloneHere={(dir) => {
            setGitCloneTargetDir(dir);
            setGitCloneOpen(true);
          }}
        />
      </FilePaneToolbar>

      {/* Filter Bar */}
      {showFilter && (
        <FilePaneFilterBar
          filterText={filterText}
          setFilterText={setFilterText}
          filterInputRef={filterInputRef}
          recursiveFilter={recursiveFilter}
          setRecursiveFilter={setRecursiveFilter}
          recursiveScanning={recursiveScanning}
          closeFilter={() => setShowFilter(false)}
        />
      )}

      {showFilter && recursiveActive && recursiveNote && (
        <div className="border-b border-amber-900/60 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-300">{recursiveNote}</div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-1.5 border-b border-red-900/60 bg-red-950/40 px-2.5 py-1 text-xs text-red-300">
          <div className="flex min-w-0 items-center gap-1.5 truncate">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          {source.sourceType !== 'local' && (
            <button
              type="button"
              onClick={() => onSourceTypeRequest('local')}
              className="ml-2 shrink-0 rounded-md bg-app-surface px-2 py-0.5 text-xs font-medium text-txt-primary hover:bg-app-surface-hover"
            >
              Switch to local disk
            </button>
          )}
        </div>
      )}

      {/* File List Content */}
      <div
        className={
          'min-h-0 flex-1 ' + (isReceivingForeignDrag ? 'ring-2 ring-inset ring-sky-500/60' : '')
        }
      >
        <FileList
          entries={visibleEntries}
          loading={loading}
          selectedPaths={selectedPaths}
          onSelectionChange={setSelectedPaths}
          onOpen={handleOpen}
          filterText={filterText}
          onDraggableStart={(entry, e) => {
            const items = selectedPaths.has(entry.path)
              ? activeEntries.filter((it) => selectedPaths.has(it.path))
              : [entry];
            beginDrag(buildDragPayload(side, source.providerId, currentPath, items), e.dataTransfer);
          }}
          onDraggableEnd={endDrag}
          isDropTarget={isDropTarget}
          onEntryDrop={handleEntryDrop}
          onEntryDragOver={(entry) => setDragOverPath(entry.path)}
          onEntryDragLeave={() => setDragOverPath(null)}
          onPaneDrop={handlePaneDrop}
          dragOverPath={dragOverPath}
          renamingPath={renamingPath}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={() => setRenamingPath(null)}
          onEntryContextMenu={(_entry, e) => setContextMenu({ x: e.clientX, y: e.clientY })}
          onPaneContextMenu={(e) => setContextMenu({ x: e.clientX, y: e.clientY })}
          onRenameStart={handleRenameStart}
          onRefresh={() => void load(true)}
          onNavigateParent={() => onPathChange(parentPath(currentPath))}
          onNavigateBack={handleGoBack}
          onNavigateForward={handleGoForward}
          onCopySelected={handleCopy}
          onCutSelected={handleCut}
          onPaste={handlePaste}
          cutPaths={
            clipboard?.mode === 'cut' && clipboard.providerId === source.providerId
              ? new Set(clipboard.sourcePaths)
              : undefined
          }
          onDeleteSelected={() => void handleDelete()}
        />
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      <FilePaneModals
        source={source}
        currentPath={currentPath}
        selectedEntries={selectedEntries}
        isBucketEntry={isBucketEntry}
        isS3ObjectEntry={isS3ObjectEntry}
        selectedAreAllFiles={selectedAreAllFiles}
        otherPane={otherPane}
        chmodOpen={chmodOpen}
        setChmodOpen={setChmodOpen}
        propertiesOpen={propertiesOpen}
        setPropertiesOpen={setPropertiesOpen}
        tagsOpen={tagsOpen}
        setTagsOpen={setTagsOpen}
        bucketPolicyOpen={bucketPolicyOpen}
        setBucketPolicyOpen={setBucketPolicyOpen}
        versionsOpen={versionsOpen}
        setVersionsOpen={setVersionsOpen}
        presignedOpen={presignedOpen}
        setPresignedOpen={setPresignedOpen}
        editorEntry={editorEntry}
        editorTailMode={editorTailMode}
        // Tail mode is a one-shot choice from the context menu; every other way of opening the editor must start in normal mode.
        onCloseEditor={() => {
          setEditorEntry(null);
          setEditorTailMode(false);
        }}
        newFolderOpen={newFolderOpen}
        setNewFolderOpen={setNewFolderOpen}
        handleCreateFolderCommit={handleCreateFolderCommit}
        addToDotfilesOpen={addToDotfilesOpen}
        setAddToDotfilesOpen={setAddToDotfilesOpen}
        setDotfilesFeedback={setDotfilesFeedback}
        syncModalOpen={syncModalOpen}
        setSyncModalOpen={setSyncModalOpen}
        searchOpen={searchOpen}
        setSearchOpen={setSearchOpen}
        gitCloneOpen={gitCloneOpen}
        setGitCloneOpen={setGitCloneOpen}
        gitCloneTargetDir={gitCloneTargetDir}
        setGitCloneTargetDir={setGitCloneTargetDir}
        load={load}
        onPathChange={onPathChange}
      />

      {dotfilesFeedback && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white shadow-lg flex items-center gap-1.5 animate-in fade-in">
          <span>✓</span>
          <span>{dotfilesFeedback}</span>
        </div>
      )}
    </div>
  );
};

export default FilePane;
