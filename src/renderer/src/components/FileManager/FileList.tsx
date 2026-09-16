import React, { useCallback, useMemo, useState } from 'react';
import { File, FileArchive, FileCode, FileImage, FileText, Folder, Loader2 } from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';
import { classNames, formatBytes } from '../../lib/format';

type SortKey = 'name' | 'size' | 'mtime' | 'permissions';
type SortDir = 'asc' | 'desc';

interface FileListProps {
  entries: FileEntry[];
  loading: boolean;
  selectedPaths: Set<string>;
  onSelectionChange: (paths: Set<string>) => void;
  onOpen: (entry: FileEntry) => void;
  onDraggableStart?: (entry: FileEntry, e: React.DragEvent) => void;
  onDraggableEnd?: () => void;
  isDropTarget?: (entry: FileEntry) => boolean;
  onEntryDrop?: (entry: FileEntry, e: React.DragEvent) => void;
  onEntryDragOver?: (entry: FileEntry, e: React.DragEvent) => void;
  onEntryDragLeave?: (entry: FileEntry) => void;
  dragOverPath?: string | null;
  renamingPath?: string | null;
  onRenameCommit?: (entry: FileEntry, newName: string) => void;
  onRenameCancel?: () => void;
  filterText?: string;
}

function iconForEntry(entry: FileEntry) {
  if (entry.isDirectory) return Folder;
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return FileImage;
  if (['zip', 'tar', 'gz', 'tgz', 'rar', '7z'].includes(ext)) return FileArchive;
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'go', 'rs', 'c', 'cpp', 'sh', 'yml', 'yaml'].includes(ext)) return FileCode;
  if (['txt', 'md', 'log', 'csv'].includes(ext)) return FileText;
  return File;
}

export const FileList: React.FC<FileListProps> = ({
  entries,
  loading,
  selectedPaths,
  onSelectionChange,
  onOpen,
  onDraggableStart,
  isDropTarget,
  onEntryDrop,
  onEntryDragOver,
  onEntryDragLeave,
  onDraggableEnd,
  dragOverPath,
  renamingPath,
  onRenameCommit,
  onRenameCancel,
  filterText,
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const trimmed = (filterText ?? '').trim().toLowerCase();
    if (!trimmed) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(trimmed));
  }, [entries, filterText]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const cmp =
        sortKey === 'name'
          ? a.name.localeCompare(b.name)
          : sortKey === 'size'
            ? a.size - b.size
            : sortKey === 'permissions'
              ? (a.permissions ?? '').localeCompare(b.permissions ?? '')
              : (a.mtime ?? '').localeCompare(b.mtime ?? '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey]
  );

  const handleRowClick = useCallback(
    (entry: FileEntry, index: number, e: React.MouseEvent) => {
      const next = new Set(selectedPaths);
      if (e.shiftKey && lastClickedIndex !== null) {
        const [start, end] = [lastClickedIndex, index].sort((a, b) => a - b);
        for (let i = start; i <= end; i++) {
          next.add(sorted[i].path);
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        setLastClickedIndex(index);
      } else {
        next.clear();
        next.add(entry.path);
        setLastClickedIndex(index);
      }
      onSelectionChange(next);
    },
    [selectedPaths, lastClickedIndex, sorted, onSelectionChange]
  );

  const SortHeader: React.FC<{ label: string; sortKeyName: SortKey; className?: string }> = ({
    label,
    sortKeyName,
    className,
  }) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKeyName)}
      className={classNames('flex items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-slate-400 hover:text-slate-200', className)}
    >
      {label}
      {sortKey === sortKeyName && <span>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid grid-cols-[1fr_80px_75px_130px] items-center gap-2 border-b border-slate-700 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <SortHeader label="Namn" sortKeyName="name" />
          {filterText?.trim() && (
            <span className="truncate rounded border border-sky-800/60 bg-sky-950/60 px-1.5 py-0.2 text-[10px] font-medium text-sky-400">
              {sorted.length} av {entries.length}
            </span>
          )}
        </div>
        <SortHeader label="Storlek" sortKeyName="size" />
        <SortHeader label="Rättigheter" sortKeyName="permissions" />
        <SortHeader label="Ändrad" sortKeyName="mtime" />
      </div>
      <div
        className="flex-1 overflow-y-auto"
        onClick={(e) => {
          if (e.currentTarget === e.target) onSelectionChange(new Set());
        }}
      >
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Läser in...
          </div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-500">
            {filterText?.trim() ? `Inga filer matchar "${filterText.trim()}"` : 'Mappen är tom'}
          </div>
        )}
        {!loading &&
          sorted.map((entry, index) => {
            const Icon = iconForEntry(entry);
            const selected = selectedPaths.has(entry.path);
            const isDropHover = dragOverPath === entry.path;
            const renaming = renamingPath === entry.path;
            return (
              <div
                key={entry.path}
                role="row"
                draggable
                onDragStart={(e) => onDraggableStart?.(entry, e)}
                onDragEnd={() => onDraggableEnd?.()}
                onDragOver={(e) => {
                  if (isDropTarget?.(entry)) {
                    e.preventDefault();
                    onEntryDragOver?.(entry, e);
                  }
                }}
                onDragLeave={() => onEntryDragLeave?.(entry)}
                onDrop={(e) => {
                  if (isDropTarget?.(entry)) {
                    e.preventDefault();
                    onEntryDrop?.(entry, e);
                  }
                }}
                onClick={(e) => handleRowClick(entry, index, e)}
                onDoubleClick={() => onOpen(entry)}
                className={classNames(
                  'grid cursor-default grid-cols-[1fr_80px_75px_130px] items-center gap-2 border-b border-slate-800/60 px-3 py-1 text-sm select-none',
                  selected ? 'bg-sky-900/40 text-slate-50' : 'text-slate-200 hover:bg-slate-800/60',
                  isDropHover && 'ring-1 ring-inset ring-sky-400 bg-sky-900/30'
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={classNames('h-4 w-4 shrink-0', entry.isDirectory ? 'text-sky-400' : 'text-slate-400')} />
                  {renaming ? (
                    <input
                      autoFocus
                      defaultValue={entry.name}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameCommit?.(entry, (e.target as HTMLInputElement).value);
                        if (e.key === 'Escape') onRenameCancel?.();
                      }}
                      onBlur={(e) => onRenameCommit?.(entry, e.target.value)}
                      className="w-full rounded border border-sky-500 bg-slate-900 px-1 py-0.5 text-sm text-slate-100 outline-none"
                    />
                  ) : (
                    <span className="truncate">{entry.name}</span>
                  )}
                </div>
                <span className="truncate text-xs text-slate-400">{entry.isDirectory ? '' : formatBytes(entry.size)}</span>
                <span className="truncate font-mono text-xs text-slate-400">{entry.permissions ?? '-'}</span>
                <span className="truncate text-xs text-slate-400">{entry.mtime ?? ''}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default FileList;
