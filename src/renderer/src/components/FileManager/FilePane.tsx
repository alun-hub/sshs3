import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Clipboard,
  Cloud,
  FileJson,
  FolderOpen,
  FolderPlus,
  HardDrive,
  History,
  Info,
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
import { joinPath, parentPath } from '../../lib/format';
import { FileList } from './FileList';
import { Breadcrumbs } from './Breadcrumbs';
import { buildDragPayload, useDragDrop } from './DragDropLayer';
import { ChmodModal } from './ChmodModal';
import { PropertiesModal } from './PropertiesModal';
import { TagsModal } from './TagsModal';
import { BucketPolicyModal } from './BucketPolicyModal';
import { VersionsModal } from './VersionsModal';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import type { PaneSide, PaneSource, SourceType } from './types';

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
  const [filterText, setFilterText] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const { activeDrag, beginDrag, endDrag, readDropPayload, readOsFilePaths } = useDragDrop();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.multissh.storageList(source.providerId, currentPath);
      setEntries(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte läsa katalogen');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [source.providerId, currentPath]);

  useEffect(() => {
    setSelectedPaths(new Set());
    setFilterText('');
    void load();
  }, [load, refreshToken, currentPath]);

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) {
        onPathChange(entry.path);
      }
    },
    [onPathChange]
  );

  const handleNewFolder = useCallback(async () => {
    const name = window.prompt('Namn på ny mapp:');
    if (!name) return;
    try {
      await window.multissh.storageCreateFolder(source.providerId, joinPath(currentPath, name));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte skapa mappen');
    }
  }, [source.providerId, currentPath, load]);

  const handleDelete = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    if (!window.confirm(`Ta bort ${selectedPaths.size} objekt?`)) return;
    const targets = entries.filter((e) => selectedPaths.has(e.path));
    try {
      for (const target of targets) {
        await window.multissh.storageDelete(source.providerId, target.path, target.isDirectory);
      }
      setSelectedPaths(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ta bort objekt');
    }
  }, [selectedPaths, entries, source.providerId, load]);

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
        setError(err instanceof Error ? err.message : 'Kunde inte byta namn');
      }
    },
    [source.providerId, load]
  );

  const isDropTarget = useCallback(
    (entry: FileEntry) => entry.isDirectory,
    []
  );

  const handleEntryDrop = useCallback(
    async (entry: FileEntry, e: React.DragEvent) => {
      setDragOverPath(null);
      const osPaths = readOsFilePaths(e.dataTransfer);
      if (osPaths.length > 0) {
        onTransferRequested({ sourceProviderId: 'local', sourcePaths: osPaths, targetPath: entry.path });
        return;
      }
      const payload = readDropPayload(e.dataTransfer);
      if (payload && !payload.entries.some((it) => it.path === entry.path)) {
        onTransferRequested({
          sourceProviderId: payload.providerId,
          sourcePaths: payload.entries.map((it) => it.path),
          targetPath: entry.path,
        });
      }
      endDrag();
    },
    [readOsFilePaths, readDropPayload, onTransferRequested, endDrag]
  );

  const handlePaneDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverPath(null);
      const osPaths = readOsFilePaths(e.dataTransfer);
      if (osPaths.length > 0) {
        onTransferRequested({ sourceProviderId: 'local', sourcePaths: osPaths, targetPath: currentPath });
        return;
      }
      const payload = readDropPayload(e.dataTransfer);
      const isSameFolder = payload && payload.providerId === source.providerId && payload.basePath === currentPath;
      if (payload && !isSameFolder) {
        onTransferRequested({
          sourceProviderId: payload.providerId,
          sourcePaths: payload.entries.map((it) => it.path),
          targetPath: currentPath,
        });
      }
      endDrag();
    },
    [readOsFilePaths, readDropPayload, onTransferRequested, currentPath, source.providerId, endDrag]
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

  const contextMenuItems: ContextMenuItem[] =
    contextMenu === null
      ? []
      : selectedEntries.length > 0
        ? [
            ...(selectedEntries.length === 1 && selectedEntries[0].isDirectory
              ? [{ key: 'open', label: 'Öppna', icon: FolderOpen, onSelect: () => handleOpen(selectedEntries[0]) }]
              : []),
            {
              key: 'rename',
              label: 'Byt namn',
              icon: Pencil,
              disabled: selectedEntries.length !== 1,
              onSelect: handleRenameStart,
            },
            {
              key: 'chmod',
              label: 'Ändra rättigheter...',
              icon: Shield,
              disabled: !supportsChmod,
              onSelect: () => setChmodOpen(true),
            },
            {
              key: 'copy-path',
              label: 'Kopiera sökväg',
              icon: Clipboard,
              disabled: selectedEntries.length !== 1,
              onSelect: () => void navigator.clipboard.writeText(selectedEntries[0].path),
            },
            ...(source.sourceType === 's3'
              ? [
                  {
                    key: 'copy-s3-uri',
                    label: 'Kopiera S3-URI',
                    icon: Clipboard,
                    disabled: selectedEntries.length !== 1,
                    onSelect: () => void navigator.clipboard.writeText(`s3:/${selectedEntries[0].path}`),
                  },
                  {
                    key: 'tags',
                    label: 'Taggar...',
                    icon: Tag,
                    disabled: !(isBucketEntry || isS3ObjectEntry),
                    separatorBefore: true,
                    onSelect: () => setTagsOpen(true),
                  },
                  {
                    key: 'bucket-policy',
                    label: 'Bucket-policy & CORS...',
                    icon: FileJson,
                    disabled: !isBucketEntry,
                    onSelect: () => setBucketPolicyOpen(true),
                  },
                  {
                    key: 'versioning',
                    label: isBucketEntry ? 'Versionshantering...' : 'Objektversioner...',
                    icon: History,
                    disabled: !(isBucketEntry || isS3ObjectEntry),
                    onSelect: () => setVersionsOpen(true),
                  },
                ]
              : []),
            {
              key: 'properties',
              label: 'Egenskaper',
              icon: Info,
              separatorBefore: source.sourceType !== 's3',
              onSelect: () => setPropertiesOpen(true),
            },
            {
              key: 'delete',
              label: 'Ta bort',
              icon: Trash2,
              danger: true,
              separatorBefore: true,
              onSelect: () => void handleDelete(),
            },
          ]
        : [
            { key: 'newfolder', label: 'Ny mapp', icon: FolderPlus, onSelect: () => void handleNewFolder() },
            { key: 'refresh', label: 'Uppdatera', icon: RefreshCw, onSelect: () => void load() },
          ];

  const SourceIcon = SOURCE_ICONS[source.sourceType];
  const isReceivingForeignDrag = activeDrag !== null && activeDrag.fromPane !== side;

  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col border border-slate-700 bg-slate-900"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={handlePaneDrop}
    >
      <div className="flex items-center gap-1 border-b border-slate-700 bg-slate-800 px-2 py-1.5">
        <div className="flex shrink-0 items-center gap-1 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-xs">
          {(['local', 'sftp', 's3'] as SourceType[]).map((type) => {
            const Icon = SOURCE_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                title={type.toUpperCase()}
                onClick={() => onSourceTypeRequest(type)}
                className={
                  'rounded p-1 ' +
                  (source.sourceType === type ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-slate-100')
                }
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
        <span className="flex shrink-0 items-center gap-1 truncate text-xs text-slate-400">
          <SourceIcon className="h-3 w-3" />
          {source.label}
        </span>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-700 px-2 py-1.5">
        <button
          type="button"
          title="Upp en nivå"
          onClick={() => onPathChange(parentPath(currentPath))}
          className="rounded p-1 text-slate-300 hover:bg-slate-700"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <Breadcrumbs currentPath={currentPath} onNavigate={onPathChange} />
        <button type="button" title="Uppdatera" onClick={() => void load()} className="rounded p-1 text-slate-300 hover:bg-slate-700">
          <RefreshCw className="h-4 w-4" />
        </button>
        <button type="button" title="Ny mapp" onClick={() => void handleNewFolder()} className="rounded p-1 text-slate-300 hover:bg-slate-700">
          <FolderPlus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Byt namn"
          disabled={selectedPaths.size !== 1}
          onClick={handleRenameStart}
          className="rounded p-1 text-slate-300 hover:bg-slate-700 disabled:opacity-30"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Ta bort"
          disabled={selectedPaths.size === 0}
          onClick={() => void handleDelete()}
          className="rounded p-1 text-red-400 hover:bg-slate-700 disabled:opacity-30"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Ändra rättigheter (chmod)"
          disabled={selectedPaths.size === 0 || source.sourceType === 's3'}
          onClick={() => setChmodOpen(true)}
          className="rounded p-1 text-slate-300 hover:bg-slate-700 disabled:opacity-30"
        >
          <Shield className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Sök / Filtrera filer (Ctrl+F)"
          onClick={() => {
            setShowFilter((prev) => {
              const next = !prev;
              if (next) setTimeout(() => filterInputRef.current?.focus(), 50);
              return next;
            });
          }}
          className={
            'rounded p-1 ' +
            (showFilter || filterText ? 'bg-sky-600/30 text-sky-300' : 'text-slate-300 hover:bg-slate-700')
          }
        >
          <Search className="h-4 w-4" />
        </button>
        {source.sourceType === 'sftp' && onOpenTerminal && (
          <button
            type="button"
            title="Öppna terminal här"
            onClick={() => onOpenTerminal(currentPath)}
            className="rounded p-1 text-slate-300 hover:bg-slate-700"
          >
            <Terminal className="h-4 w-4" />
          </button>
        )}
      </div>

      {showFilter && (
        <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800/80 px-2.5 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input
            ref={filterInputRef}
            type="text"
            placeholder="Filtrera filer i aktuell mapp... (Esc för att stänga)"
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
            className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none"
          />
          {filterText && (
            <button
              type="button"
              title="Rensa filter"
              onClick={() => setFilterText('')}
              className="rounded p-0.5 text-slate-400 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-1.5 border-b border-red-900 bg-red-950/50 px-2 py-1 text-xs text-red-300">
          <div className="flex min-w-0 items-center gap-1.5 truncate">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          {source.sourceType !== 'local' && (
            <button
              type="button"
              onClick={() => onSourceTypeRequest('local')}
              className="ml-2 shrink-0 rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
            >
              Växla till lokal disk
            </button>
          )}
        </div>
      )}

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
          dragOverPath={dragOverPath}
          renamingPath={renamingPath}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={() => setRenamingPath(null)}
          onEntryContextMenu={(_entry, e) => setContextMenu({ x: e.clientX, y: e.clientY })}
          onPaneContextMenu={(e) => setContextMenu({ x: e.clientX, y: e.clientY })}
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
    </div>
  );
};

export default FilePane;
