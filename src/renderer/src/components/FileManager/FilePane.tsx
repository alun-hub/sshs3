import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Boxes,
  ChevronDown,
  Clipboard,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileJson,
  FileSearch,
  Loader2,
  FileText,
  FolderOpen,
  FolderPlus,
  FolderSync,
  HardDrive,
  History,
  Home,
  Info,
  Link2,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Server,
  Shield,
  Tag,
  Terminal,
  Trash2,
  X,
  GitBranch,
} from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';
import type { TransferConflictResolution } from '@shared/types/ipc';
import type { GitRepoStatus } from '@shared/types/git';
import { joinPath, parentPath, describeIpcError } from '../../lib/format';
import { FileList } from './FileList';
import { Breadcrumbs } from './Breadcrumbs';
import { useDragDrop } from './DragDropContext';
import { useConfirm } from '../ConfirmDialog';
import { ChmodModal } from './ChmodModal';
import { PropertiesModal } from './PropertiesModal';
import { TagsModal } from './TagsModal';
import { BucketPolicyModal } from './BucketPolicyModal';
import { VersionsModal } from './VersionsModal';
import { PresignedUrlModal } from './PresignedUrlModal';
import { NewFolderModal } from './NewFolderModal';
import { AddToDotfilePoolModal } from './AddToDotfilePoolModal';
import { FileEditorModal } from './FileEditorModal';
import { DirectorySyncModal, type DirectorySyncModalSource } from './DirectorySyncModal';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { SearchModal } from './SearchModal';
import { GitCloneModal } from './GitCloneModal';
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

function toWebRepoUrl(gitUrl: string): string | undefined {
  const trimmed = gitUrl.trim();
  const scpMatch = /^git@([^:]+):([^/]+)\/(.+?)(\.git)?$/.exec(trimmed);
  if (scpMatch) {
    const [, host, owner, repo] = scpMatch;
    return `https://${host}/${owner}/${repo}`;
  }
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed.replace(/\.git$/, '');
  }
  return undefined;
}

const SOURCE_ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  local: HardDrive,
  sftp: Server,
  s3: Cloud,
  k8s: Boxes,
};

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
  const [gitMenuOpen, setGitMenuOpen] = useState(false);
  const gitMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!gitMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (gitMenuRef.current && !gitMenuRef.current.contains(e.target as Node)) {
        setGitMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [gitMenuOpen]);
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

  // Navigation history
  const [navHistory, setNavHistory] = useState<{ paths: string[]; index: number }>({
    paths: [currentPath],
    index: 0,
  });
  const isNavigatingHistoryRef = useRef(false);

  useEffect(() => {
    if (isNavigatingHistoryRef.current) {
      isNavigatingHistoryRef.current = false;
      return;
    }
    setNavHistory((prev) => {
      if (prev.paths[prev.index] === currentPath) return prev;
      const nextPaths = prev.paths.slice(0, prev.index + 1);
      nextPaths.push(currentPath);
      return {
        paths: nextPaths,
        index: nextPaths.length - 1,
      };
    });
  }, [currentPath]);

  const prevProviderRef = useRef(source.providerId);
  useEffect(() => {
    if (prevProviderRef.current !== source.providerId) {
      prevProviderRef.current = source.providerId;
      setNavHistory({ paths: [currentPath], index: 0 });
    }
  }, [source.providerId, currentPath]);

  const canGoBack = navHistory.index > 0;
  const canGoForward = navHistory.index < navHistory.paths.length - 1;

  const handleGoBack = useCallback(() => {
    if (navHistory.index > 0) {
      const target = navHistory.paths[navHistory.index - 1];
      isNavigatingHistoryRef.current = true;
      setNavHistory((prev) => ({ ...prev, index: prev.index - 1 }));
      onPathChange(target);
    }
  }, [navHistory, onPathChange]);

  const handleGoForward = useCallback(() => {
    if (navHistory.index < navHistory.paths.length - 1) {
      const target = navHistory.paths[navHistory.index + 1];
      isNavigatingHistoryRef.current = true;
      setNavHistory((prev) => ({ ...prev, index: prev.index + 1 }));
      onPathChange(target);
    }
  }, [navHistory, onPathChange]);

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
      const targetPath = joinPath(parentPath(entry.path), trimmed);
      try {
        await window.multissh.storageRename(source.providerId, entry.path, targetPath);
        await load();
      } catch (err) {
        setError(describeIpcError(err, 'Failed to rename'));
      }
    },
    [source.providerId, load]
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

  const contextMenuItems: ContextMenuItem[] =
    contextMenu === null
      ? []
      : selectedEntries.length > 0
        ? [
            ...(selectedEntries.length === 1 && selectedEntries[0].isDirectory
              ? [
                  { key: 'open', label: 'Open', icon: FolderOpen, onSelect: () => handleOpen(selectedEntries[0]) },
                  {
                    key: 'dirsync',
                    label: 'Sync to...',
                    icon: FolderSync,
                    onSelect: () => setSyncModalOpen(true),
                  },
                ]
              : []),
            ...(selectedEntries.length === 1 && !selectedEntries[0].isDirectory
              ? [
                  {
                    key: 'edit',
                    label: 'View / Edit...',
                    icon: FileText,
                    onSelect: () => {
                      setEditorTailMode(false);
                      setEditorEntry(selectedEntries[0]);
                    },
                  },
                  {
                    key: 'tail',
                    label: 'Tail -f (Stream Log)',
                    icon: Terminal,
                    onSelect: () => {
                      setEditorTailMode(true);
                      setEditorEntry(selectedEntries[0]);
                    },
                  },
                  {
                    key: 'open-external',
                    label: 'Open in External Editor',
                    icon: ExternalLink,
                    onSelect: () => void handleOpenExternal(selectedEntries[0]),
                  },
                ]
              : []),
            {
              key: 'cut',
              label: 'Cut (Ctrl+X)',
              icon: Scissors,
              disabled: selectedEntries.length === 0,
              onSelect: handleCut,
            },
            {
              key: 'copy',
              label: 'Copy (Ctrl+C)',
              icon: Copy,
              disabled: selectedEntries.length === 0,
              onSelect: handleCopy,
            },
            {
              key: 'paste',
              label: 'Paste (Ctrl+V)',
              icon: Clipboard,
              disabled: !clipboard || clipboard.sourcePaths.length === 0,
              onSelect: handlePaste,
            },
            {
              key: 'rename',
              label: 'Rename',
              icon: Pencil,
              disabled: selectedEntries.length !== 1,
              onSelect: handleRenameStart,
            },
            {
              key: 'chmod',
              label: 'Change Permissions (chmod)...',
              icon: Shield,
              disabled: !supportsChmod,
              onSelect: () => setChmodOpen(true),
            },
            {
              // Renamed from "Copy Path" (UX review #14): the old name was
              // indistinguishable from "Copy File Location" below even
              // though they copy different things (full path vs. containing
              // folder only). Distinct icons help tell the three apart too.
              key: 'copy-path',
              label: 'Copy Full Path',
              icon: Clipboard,
              disabled: selectedEntries.length !== 1,
              onSelect: () => void navigator.clipboard.writeText(selectedEntries[0].path),
            },
            {
              key: 'copy-filename',
              label: 'Copy Filename',
              icon: FileText,
              disabled: selectedEntries.length !== 1,
              onSelect: () => void navigator.clipboard.writeText(selectedEntries[0].name),
            },
            {
              key: 'copy-location',
              label: 'Copy Folder Path',
              icon: FolderOpen,
              disabled: selectedEntries.length !== 1,
              onSelect: () => void navigator.clipboard.writeText(parentPath(selectedEntries[0].path)),
            },
            ...(source.sourceType !== 'local'
              ? [
                  {
                    key: 'download-to',
                    label: 'Download to...',
                    icon: Download,
                    onSelect: () => void handleDownloadTo(),
                  },
                ]
              : []),
            ...(source.sourceType !== 's3' && selectedEntries.length === 1 && !selectedEntries[0].isDirectory
              ? [
                  {
                    key: 'add-to-dotfiles',
                    label: 'Add to Dotfiles Pool...',
                    icon: FileCode,
                    onSelect: () => setAddToDotfilesOpen(true),
                  },
                ]
              : []),
            ...(source.sourceType === 's3'
              ? [
                  {
                    key: 'copy-s3-uri',
                    label: 'Copy S3 URI',
                    icon: Clipboard,
                    disabled: selectedEntries.length !== 1,
                    onSelect: () => void navigator.clipboard.writeText(`s3:/${selectedEntries[0].path}`),
                  },
                  {
                    key: 'tags',
                    label: 'Tags...',
                    icon: Tag,
                    disabled: !(isBucketEntry || isS3ObjectEntry),
                    separatorBefore: true,
                    onSelect: () => setTagsOpen(true),
                  },
                  {
                    key: 'bucket-policy',
                    label: 'Bucket Policy & CORS...',
                    icon: FileJson,
                    disabled: !isBucketEntry,
                    onSelect: () => setBucketPolicyOpen(true),
                  },
                  {
                    key: 'versioning',
                    label: isBucketEntry ? 'Bucket Versioning...' : 'Object Versions...',
                    icon: History,
                    disabled: !(isBucketEntry || isS3ObjectEntry),
                    onSelect: () => setVersionsOpen(true),
                  },
                  {
                    key: 'presigned-url',
                    label: `Generate Web URL${selectedEntries.length > 1 ? 's' : ''}...`,
                    icon: Link2,
                    disabled: !selectedAreAllFiles,
                    onSelect: () => setPresignedOpen(true),
                  },
                ]
              : []),
            ...(gitIntegrationEnabled && source.sourceType !== 's3' && source.sourceType !== 'k8s'
              ? [
                  ...(selectedEntries.length === 1 && selectedEntries[0].isDirectory
                    ? [
                        {
                          key: 'git-clone-into',
                          label: 'Git Clone inside...',
                          icon: GitBranch,
                          separatorBefore: true,
                          onSelect: () => {
                            setGitCloneTargetDir(selectedEntries[0].path);
                            setGitCloneOpen(true);
                          },
                        },
                      ]
                    : []),
                  ...(gitStatus?.isRepo
                    ? [
                        {
                          key: 'git-pull',
                          label: 'Git Pull',
                          icon: GitBranch,
                          separatorBefore: selectedEntries.length !== 1 || !selectedEntries[0].isDirectory,
                          onSelect: () => void handleGitPull(),
                        },
                        ...(gitStatus.remoteOriginUrl
                          ? [
                              {
                                key: 'open-git-web',
                                label: 'Open in GitHub/GitLab',
                                icon: ExternalLink,
                                onSelect: () => {
                                  const url = toWebRepoUrl(gitStatus.remoteOriginUrl!);
                                  if (url) void window.multissh.openExternal(url);
                                },
                              },
                            ]
                          : []),
                      ]
                    : []),
                ]
              : []),
            {
              key: 'properties',
              label: 'Properties',
              icon: Info,
              separatorBefore: source.sourceType !== 's3',
              onSelect: () => setPropertiesOpen(true),
            },
            {
              key: 'delete',
              label: 'Delete',
              icon: Trash2,
              danger: true,
              separatorBefore: true,
              onSelect: () => void handleDelete(),
            },
          ]
        : [
            { key: 'newfolder', label: 'New Folder', icon: FolderPlus, onSelect: () => void handleNewFolder() },
            {
              key: 'paste',
              label: 'Paste (Ctrl+V)',
              icon: Clipboard,
              disabled: !clipboard || clipboard.sourcePaths.length === 0,
              onSelect: handlePaste,
            },
            { key: 'refresh', label: 'Refresh', icon: RefreshCw, onSelect: () => void load(true) },
            {
              key: 'search-in-files',
              label: 'Search in Files...',
              icon: Search,
              onSelect: () => setSearchOpen(true),
            },
            ...(gitIntegrationEnabled && source.sourceType !== 's3' && source.sourceType !== 'k8s'
              ? [
                  {
                    key: 'git-clone',
                    label: 'Git Clone to here...',
                    icon: GitBranch,
                    separatorBefore: true,
                    onSelect: () => {
                      setGitCloneTargetDir(currentPath);
                      setGitCloneOpen(true);
                    },
                  },
                  ...(gitStatus?.isRepo
                    ? [
                        {
                          key: 'git-pull',
                          label: 'Git Pull',
                          icon: GitBranch,
                          onSelect: () => void handleGitPull(),
                        },
                        ...(gitStatus.remoteOriginUrl
                          ? [
                              {
                                key: 'open-git-web',
                                label: 'Open in GitHub/GitLab',
                                icon: ExternalLink,
                                onSelect: () => {
                                  const url = toWebRepoUrl(gitStatus.remoteOriginUrl!);
                                  if (url) void window.multissh.openExternal(url);
                                },
                              },
                            ]
                          : []),
                      ]
                    : []),
                ]
              : []),
          ];

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
      <div className="flex items-center gap-1 border-b border-divider bg-app-surface-subtle px-2 py-0.5">
        {/* Navigation Group */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title="Back (Alt+Left)"
            aria-label="Back (Alt+Left)"
            disabled={!canGoBack}
            onClick={handleGoBack}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Forward (Alt+Right)"
            aria-label="Forward (Alt+Right)"
            disabled={!canGoForward}
            onClick={handleGoForward}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Up one level (Alt+Up)"
            aria-label="Up one level (Alt+Up)"
            onClick={() => onPathChange(parentPath(currentPath))}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          {source.sourceType !== 's3' && source.sourceType !== 'k8s' && (
            <button
              type="button"
              title="Home"
              aria-label="Home"
              onClick={() => void handleGoHome()}
              className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
            >
              <Home className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-border-subtle/80 shrink-0 mx-0.5" />

        <Breadcrumbs currentPath={currentPath} onNavigate={onPathChange} onDropToPath={handleBreadcrumbDrop} />

        {gitIntegrationEnabled ? (
          gitStatus?.isRepo && gitStatus.branch ? (
            <div ref={gitMenuRef} className="relative shrink-0">
              <button
                type="button"
                title={`Git: ${gitStatus.branch}${gitStatus.isClean ? ' (clean)' : ' (uncommitted changes)'}${gitStatus.ahead ? `, ahead ${gitStatus.ahead}` : ''}${gitStatus.behind ? `, behind ${gitStatus.behind}` : ''}\nClick for Git options (Pull, Web, Clone)`}
                onClick={() => setGitMenuOpen((prev) => !prev)}
                className="flex items-center gap-1 bg-app-card hover:bg-app-surface border border-border-subtle rounded-md px-1.5 py-0.5 text-2xs text-txt-secondary transition-colors cursor-pointer select-none"
              >
                {gitPulling ? (
                  <Loader2 className="h-3 w-3 animate-spin text-sky-400 shrink-0" />
                ) : (
                  <GitBranch className="h-3 w-3 text-sky-400 shrink-0" />
                )}
                <span className="font-medium text-txt-primary max-w-[100px] truncate">{gitStatus.branch}</span>
                {!gitStatus.isClean && <span className="text-amber-400 font-bold">*</span>}
                {Boolean(gitStatus.ahead) && <span className="text-emerald-400 text-2xs">↑{gitStatus.ahead}</span>}
                {Boolean(gitStatus.behind) && <span className="text-amber-400 text-2xs">↓{gitStatus.behind}</span>}
                <ChevronDown className="h-3 w-3 text-txt-muted ml-0.5" />
              </button>

              {gitMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-40 w-64 rounded-xl border border-border-subtle bg-app-card p-2.5 shadow-xl text-xs space-y-2">
                  <div className="flex items-center justify-between border-b border-divider pb-1.5">
                    <div className="flex items-center gap-1.5 font-semibold text-txt-primary truncate">
                      <GitBranch className="h-4 w-4 text-sky-400 shrink-0" />
                      <span className="truncate">{gitStatus.branch}</span>
                    </div>
                    {gitStatus.isClean ? (
                      <span className="rounded bg-emerald-500/15 text-emerald-400 text-2xs px-1.5 py-0.5 font-medium">Clean</span>
                    ) : (
                      <span className="rounded bg-amber-500/15 text-amber-400 text-2xs px-1.5 py-0.5 font-medium">Modified</span>
                    )}
                  </div>

                  <div className="text-2xs text-txt-muted space-y-0.5">
                    {!gitStatus.isClean && (
                      <div className="text-amber-300">
                        ● {gitStatus.modifiedCount ?? 0} modified, {gitStatus.untrackedCount ?? 0} untracked
                      </div>
                    )}
                    {(Boolean(gitStatus.ahead) || Boolean(gitStatus.behind)) && (
                      <div className="flex items-center gap-2">
                        {Boolean(gitStatus.ahead) && <span className="text-emerald-400">↑ {gitStatus.ahead} ahead</span>}
                        {Boolean(gitStatus.behind) && <span className="text-amber-400">↓ {gitStatus.behind} behind</span>}
                      </div>
                    )}
                    {gitStatus.remoteOriginUrl && (
                      <div className="truncate text-txt-muted font-mono text-2xs" title={gitStatus.remoteOriginUrl}>
                        {gitStatus.remoteOriginUrl}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 pt-1 border-t border-divider">
                    <button
                      type="button"
                      disabled={gitPulling}
                      onClick={() => {
                        setGitMenuOpen(false);
                        void handleGitPull();
                      }}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-txt-primary hover:bg-app-surface hover:text-sky-400 transition-colors disabled:opacity-40 text-left"
                    >
                      {gitPulling ? <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" /> : <RefreshCw className="h-3.5 w-3.5 text-sky-400" />}
                      <span>Git Pull</span>
                    </button>

                    {gitStatus.remoteOriginUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setGitMenuOpen(false);
                          const url = toWebRepoUrl(gitStatus.remoteOriginUrl!);
                          if (url) void window.multissh.openExternal(url);
                        }}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-txt-primary hover:bg-app-surface hover:text-sky-400 transition-colors text-left"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
                        <span>Open in GitHub/GitLab</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setGitMenuOpen(false);
                        setGitCloneTargetDir(currentPath);
                        setGitCloneOpen(true);
                      }}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-txt-primary hover:bg-app-surface hover:text-sky-400 transition-colors text-left"
                    >
                      <FolderPlus className="h-3.5 w-3.5 text-sky-400" />
                      <span>Clone Git repository here...</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : source.sourceType !== 's3' && source.sourceType !== 'k8s' ? (
            <button
              type="button"
              title="Git (Clone repository here...)"
              aria-label="Git (Clone repository here...)"
              onClick={() => {
                setGitCloneTargetDir(currentPath);
                setGitCloneOpen(true);
              }}
              className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-sky-400 transition-colors shrink-0"
            >
              <GitBranch className="h-4 w-4" />
            </button>
          ) : null
        ) : null}

        <div className="h-4 w-px bg-border-subtle/80 shrink-0 mx-0.5" />

        {/* File Ops Group */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => void load(true)}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="New Folder"
            aria-label="New Folder"
            onClick={() => void handleNewFolder()}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="View / Edit File"
            aria-label="View / Edit File"
            disabled={selectedPaths.size !== 1 || Boolean(selectedEntries[0]?.isDirectory)}
            onClick={() => selectedEntries[0] && setEditorEntry(selectedEntries[0])}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
          >
            <FileText className="h-4 w-4" />
          </button>
        </div>

        <div className="h-4 w-px bg-border-subtle/80 shrink-0 mx-0.5" />

        {/* Manage Group */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title="Rename"
            aria-label="Rename"
            disabled={selectedPaths.size !== 1}
            onClick={handleRenameStart}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Delete"
            aria-label="Delete"
            disabled={selectedPaths.size === 0}
            onClick={() => void handleDelete()}
            className="rounded-lg p-1 text-red-400 hover:bg-app-surface-hover disabled:opacity-30 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Change Permissions (chmod)"
            aria-label="Change Permissions (chmod)"
            disabled={selectedPaths.size === 0 || source.sourceType === 's3'}
            onClick={() => setChmodOpen(true)}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
          >
            <Shield className="h-4 w-4" />
          </button>
        </div>

        <div className="h-4 w-px bg-border-subtle/80 shrink-0 mx-0.5" />

        {/* Search & Terminal Group */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title="Search / Filter files (Ctrl+F)"
            aria-label="Search / Filter files (Ctrl+F)"
            onClick={() => {
              setShowFilter((prev) => {
                const next = !prev;
                if (next) setTimeout(() => filterInputRef.current?.focus(), 50);
                return next;
              });
            }}
            className={
              'rounded-lg p-1 transition-colors ' +
              (showFilter || filterText
                ? 'bg-sky-500/20 text-sky-400'
                : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary')
            }
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={source.sourceType === 'k8s' ? 'Search in Files not supported on Kubernetes' : 'Search in Files...'}
            aria-label={source.sourceType === 'k8s' ? 'Search in Files not supported on Kubernetes' : 'Search in Files...'}
            disabled={source.sourceType === 'k8s'}
            onClick={() => setSearchOpen(true)}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
          >
            <FileSearch className="h-4 w-4" />
          </button>
          {(source.sourceType === 'sftp' || source.sourceType === 'k8s') && onOpenTerminal && (
            <button
              type="button"
              title="Open Terminal Here"
              aria-label="Open Terminal Here"
              onClick={() => onOpenTerminal(currentPath)}
              className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
            >
              <Terminal className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      {showFilter && (
        <div className="flex items-center gap-2 border-b border-divider bg-app-surface px-2.5 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-txt-muted" />
          <input
            ref={filterInputRef}
            type="text"
            placeholder={
              recursiveFilter ? 'Search file names in this folder and subfolders... (Esc to close)' : 'Filter files in current folder... (Esc to close)'
            }
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (filterText) {
                  setFilterText('');
                } else {
                  setShowFilter(false);
                }
              }
            }}
            className="flex-1 bg-transparent text-xs text-txt-primary placeholder-txt-muted outline-none"
          />
          {recursiveScanning && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />}
          <label
            className="flex shrink-0 cursor-pointer select-none items-center gap-1 text-2xs text-txt-secondary"
            title="Also search in all subfolders"
          >
            <input
              type="checkbox"
              checked={recursiveFilter}
              onChange={(e) => setRecursiveFilter(e.target.checked)}
              className="rounded border-border-subtle text-sky-500 focus:ring-0"
            />
            Recursive
          </label>
          {filterText && (
            <button
              type="button"
              title="Clear filter"
              aria-label="Clear filter"
              onClick={() => setFilterText('')}
              className="rounded p-0.5 text-txt-muted hover:text-txt-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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

      <ChmodModal
        open={chmodOpen}
        providerId={source.providerId}
        entries={selectedEntries}
        onClose={() => setChmodOpen(false)}
        onSaved={() => void load()}
      />

      <PropertiesModal
        open={propertiesOpen}
        providerId={source.providerId}
        sourceType={source.sourceType}
        entries={selectedEntries}
        onClose={() => setPropertiesOpen(false)}
        onSaved={() => void load()}
      />

      {(isBucketEntry || isS3ObjectEntry) && selectedEntries.length === 1 && (
        <TagsModal
          open={tagsOpen}
          providerId={source.providerId}
          targetPath={selectedEntries[0].path}
          targetName={selectedEntries[0].name}
          onClose={() => setTagsOpen(false)}
        />
      )}

      {isBucketEntry && selectedEntries.length === 1 && (
        <BucketPolicyModal
          open={bucketPolicyOpen}
          providerId={source.providerId}
          bucketPath={selectedEntries[0].path}
          bucketName={selectedEntries[0].name}
          onClose={() => setBucketPolicyOpen(false)}
        />
      )}

      {(isBucketEntry || isS3ObjectEntry) && selectedEntries.length === 1 && (
        <VersionsModal
          open={versionsOpen}
          providerId={source.providerId}
          mode={isBucketEntry ? 'bucket' : 'object'}
          targetPath={selectedEntries[0].path}
          targetName={selectedEntries[0].name}
          onClose={() => setVersionsOpen(false)}
          onSaved={() => void load()}
        />
      )}

      {presignedOpen && selectedAreAllFiles && (
        <PresignedUrlModal
          open={presignedOpen}
          providerId={source.providerId}
          entries={selectedEntries.map((e) => ({ path: e.path, name: e.name }))}
          onClose={() => setPresignedOpen(false)}
        />
      )}

      <FileEditorModal
        open={editorEntry !== null}
        providerId={source.providerId}
        sourceType={source.sourceType}
        entry={editorEntry}
        isTailMode={editorTailMode}
        onClose={() => setEditorEntry(null)}
        onSaved={() => void load()}
      />

      <NewFolderModal
        open={newFolderOpen}
        currentPath={currentPath}
        sourceType={source.sourceType}
        onClose={() => setNewFolderOpen(false)}
        onCreate={handleCreateFolderCommit}
      />

      <AddToDotfilePoolModal
        open={addToDotfilesOpen}
        sourceProviderId={source.providerId}
        entry={selectedEntries[0] || null}
        onClose={() => setAddToDotfilesOpen(false)}
        onSuccess={(msg) => {
          setDotfilesFeedback(msg);
          setTimeout(() => setDotfilesFeedback(null), 4000);
        }}
      />

      <DirectorySyncModal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        initialSource={
          selectedEntries.length === 1 && selectedEntries[0].isDirectory
            ? {
                providerId: source.providerId,
                sourceType: source.sourceType,
                label: source.label,
                path: selectedEntries[0].path,
              }
            : null
        }
        otherPane={otherPane ?? null}
      />

      {source.sourceType !== 'k8s' && (
        <SearchModal
          open={searchOpen}
          providerId={source.providerId}
          sourceType={source.sourceType}
          rootPath={currentPath}
          onClose={() => setSearchOpen(false)}
          onJumpToFile={(path) => onPathChange(parentPath(path))}
        />
      )}

      {gitCloneOpen && (
        <GitCloneModal
          targetPath={gitCloneTargetDir || currentPath}
          providerId={source.providerId}
          onClose={() => {
            setGitCloneOpen(false);
            setGitCloneTargetDir(null);
          }}
          onCloned={() => void load(true)}
        />
      )}

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
