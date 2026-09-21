import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Clipboard,
  Cloud,
  Download,
  ExternalLink,
  FileCode,
  FileJson,
  FileText,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  Info,
  Link2,
  Pencil,
  RefreshCw,
  Search,
  Server,
  Shield,
  Tag,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';
import type { TransferConflictResolution } from '@shared/types/ipc';
import { joinPath, parentPath } from '../../lib/format';
import { FileList } from './FileList';
import { Breadcrumbs } from './Breadcrumbs';
import { useDragDrop } from './DragDropContext';
import { ChmodModal } from './ChmodModal';
import { PropertiesModal } from './PropertiesModal';
import { TagsModal } from './TagsModal';
import { BucketPolicyModal } from './BucketPolicyModal';
import { VersionsModal } from './VersionsModal';
import { PresignedUrlModal } from './PresignedUrlModal';
import { NewFolderModal } from './NewFolderModal';
import { AddToDotfilePoolModal } from './AddToDotfilePoolModal';
import { FileEditorModal } from './FileEditorModal';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { buildDragPayload, type PaneSide, type PaneSource, type SourceType } from './types';

interface FilePaneProps {
  side: PaneSide;
  source: PaneSource;
  currentPath: string;
  onPathChange: (path: string) => void;
  onSourceTypeRequest: (type: SourceType) => void;
  onTransferRequested: (params: { sourceProviderId: string; sourcePaths: string[]; targetPath: string }) => void;
  onOpenTerminal?: (path: string) => void;
  refreshToken: number;
}

const SOURCE_ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  local: HardDrive,
  sftp: Server,
  s3: Cloud,
};

export const FilePane: React.FC<FilePaneProps> = ({
  side,
  source,
  currentPath,
  onPathChange,
  onSourceTypeRequest,
  onTransferRequested,
  onOpenTerminal,
  refreshToken,
}) => {
  const [entries, setEntries] = useState<FileEntry[]>([]);
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
  const [editorEntry, setEditorEntry] = useState<FileEntry | null>(null);
  const [editorTailMode, setEditorTailMode] = useState(false);
  const [dotfilesFeedback, setDotfilesFeedback] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const { activeDrag, beginDrag, endDrag, readDropPayload, readOsFilePaths } = useDragDrop();

  const load = useCallback(
    async (force?: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.multissh.storageList(source.providerId, currentPath, force);
        setEntries(result);
      } catch (err) {
        if (source.sourceType === 'local') {
          const home = await window.multissh.getHomeDir?.();
          if (home && currentPath !== home) {
            onPathChange(home);
            return;
          }
        }
        let msg = err instanceof Error ? err.message : 'Could not read the folder contents';
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
        setLoading(false);
      }
    },
    [source.providerId, source.sourceType, currentPath, onPathChange]
  );

  useEffect(() => {
    setSelectedPaths(new Set());
    setFilterText('');
    void load(true);
  }, [load, refreshToken, currentPath]);

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
        setError(err instanceof Error ? err.message : 'Failed to open external editor');
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
    if (!window.confirm(`Delete ${selectedPaths.size} item(s)?`)) return;
    const targets = entries.filter((e) => selectedPaths.has(e.path));
    setLoading(true);
    setError(null);
    try {
      for (const target of targets) {
        await window.multissh.storageDelete(source.providerId, target.path, target.isDirectory);
      }
      setSelectedPaths(new Set());
      await load(true);
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Failed to delete item(s)';
      msg = msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedPaths, entries, source.providerId, load]);

  const handleDownloadTo = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    const targetFolder = await window.multissh.dialogOpenFolder({ title: 'Download to...' });
    if (!targetFolder) return;
    const targets = entries.filter((e) => selectedPaths.has(e.path));
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
      setError(err instanceof Error ? err.message : 'Failed to start download');
    }
  }, [selectedPaths, entries, source.providerId]);

  const handleRenameStart = useCallback(() => {
    if (selectedPaths.size !== 1) return;
    setRenamingPath([...selectedPaths][0]);
  }, [selectedPaths]);

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
        setError(err instanceof Error ? err.message : 'Failed to rename');
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

  const supportsChmod = source.sourceType !== 's3';
  const selectedEntries = entries.filter((e) => selectedPaths.has(e.path));

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
              ? [{ key: 'open', label: 'Open', icon: FolderOpen, onSelect: () => handleOpen(selectedEntries[0]) }]
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
              key: 'copy-path',
              label: 'Copy Path',
              icon: Clipboard,
              disabled: selectedEntries.length !== 1,
              onSelect: () => void navigator.clipboard.writeText(selectedEntries[0].path),
            },
            {
              key: 'copy-filename',
              label: 'Copy Filename',
              icon: Clipboard,
              disabled: selectedEntries.length !== 1,
              onSelect: () => void navigator.clipboard.writeText(selectedEntries[0].name),
            },
            {
              key: 'copy-location',
              label: 'Copy File Location',
              icon: Clipboard,
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
            { key: 'refresh', label: 'Refresh', icon: RefreshCw, onSelect: () => void load(true) },
          ];

  const SourceIcon = SOURCE_ICONS[source.sourceType];
  const isReceivingForeignDrag = activeDrag !== null && activeDrag.fromPane !== side;

  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col rounded-xl border border-border-subtle bg-app-card overflow-hidden shadow-sm"
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
      <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-2.5 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border-subtle bg-app-card p-0.5 text-xs">
            {(['local', 'sftp', 's3'] as SourceType[]).map((type) => {
              const Icon = SOURCE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  title={type.toUpperCase()}
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
      </div>

      {/* Pane Action Toolbar */}
      <div className="flex items-center gap-1 border-b border-border-subtle bg-app-surface-subtle px-2 py-1">
        <button
          type="button"
          title="Up one level"
          onClick={() => onPathChange(parentPath(currentPath))}
          className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <Breadcrumbs currentPath={currentPath} onNavigate={onPathChange} />
        <button
          type="button"
          title="Refresh"
          onClick={() => void load(true)}
          className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="New Folder"
          onClick={() => void handleNewFolder()}
          className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="View / Edit File"
          disabled={selectedPaths.size !== 1 || Boolean(selectedEntries[0]?.isDirectory)}
          onClick={() => selectedEntries[0] && setEditorEntry(selectedEntries[0])}
          className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
        >
          <FileText className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Rename"
          disabled={selectedPaths.size !== 1}
          onClick={handleRenameStart}
          className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Delete"
          disabled={selectedPaths.size === 0}
          onClick={() => void handleDelete()}
          className="rounded-lg p-1 text-red-400 hover:bg-app-surface-hover disabled:opacity-30 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Change Permissions (chmod)"
          disabled={selectedPaths.size === 0 || source.sourceType === 's3'}
          onClick={() => setChmodOpen(true)}
          className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
        >
          <Shield className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Search / Filter files (Ctrl+F)"
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
        {source.sourceType === 'sftp' && onOpenTerminal && (
          <button
            type="button"
            title="Open Terminal Here"
            onClick={() => onOpenTerminal(currentPath)}
            className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <Terminal className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filter Bar */}
      {showFilter && (
        <div className="flex items-center gap-2 border-b border-border-subtle bg-app-surface px-2.5 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-txt-muted" />
          <input
            ref={filterInputRef}
            type="text"
            placeholder="Filter files in current folder... (Esc to close)"
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
          {filterText && (
            <button
              type="button"
              title="Clear filter"
              onClick={() => setFilterText('')}
              className="rounded p-0.5 text-txt-muted hover:text-txt-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
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
              className="ml-2 shrink-0 rounded-md bg-app-surface px-2 py-0.5 text-[11px] font-medium text-txt-primary hover:bg-app-surface-hover"
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
          entries={entries}
          loading={loading}
          selectedPaths={selectedPaths}
          onSelectionChange={setSelectedPaths}
          onOpen={handleOpen}
          filterText={filterText}
          onDraggableStart={(entry, e) => {
            const items = selectedPaths.has(entry.path)
              ? entries.filter((it) => selectedPaths.has(it.path))
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
