import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  onPaneDrop?: (e: React.DragEvent) => void;
  dragOverPath?: string | null;
  renamingPath?: string | null;
  onRenameCommit?: (entry: FileEntry, newName: string) => void;
  onRenameCancel?: () => void;
  filterText?: string;
  onEntryContextMenu?: (entry: FileEntry, e: React.MouseEvent) => void;
  onPaneContextMenu?: (e: React.MouseEvent) => void;
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
  onPaneDrop,
  onDraggableEnd,
  dragOverPath,
  renamingPath,
  onRenameCommit,
  onRenameCancel,
  filterText,
  onEntryContextMenu,
  onPaneContextMenu,
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
      if (e.shiftKey && lastClickedIndex !== null) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        const range = new Set(selectedPaths);
        for (let i = start; i <= end; i++) {
          range.add(sorted[i].path);
        }
        onSelectionChange(range);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(selectedPaths);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        setLastClickedIndex(index);
        onSelectionChange(next);
        return;
      }
      setLastClickedIndex(index);
      onSelectionChange(new Set([entry.path]));
    },
    [lastClickedIndex, selectedPaths, sorted, onSelectionChange]
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 33,
    overscan: 10,
    observeElementRect: (instance, cb) => {
      const element = instance.scrollElement;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const height = rect.height || 600;
      const width = rect.width || 800;
      cb({ width: Math.round(width), height: Math.round(height) });
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        const h = entry?.contentRect?.height || element.getBoundingClientRect().height || 600;
        const w = entry?.contentRect?.width || element.getBoundingClientRect().width || 800;
        cb({ width: Math.round(w), height: Math.round(h) });
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
  });

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (renamingPath !== null) return;
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSelectionChange(new Set(sorted.map((item) => item.path)));
        return;
      }

      if (sorted.length === 0) return;

      const firstSelectedIndex = sorted.findIndex((item) => selectedPaths.has(item.path));
      let matchIndex = -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        matchIndex = firstSelectedIndex < sorted.length - 1 ? firstSelectedIndex + 1 : 0;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        matchIndex = firstSelectedIndex > 0 ? firstSelectedIndex - 1 : sorted.length - 1;
      } else if (e.key === 'Home') {
        e.preventDefault();
        matchIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        matchIndex = sorted.length - 1;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedPaths.size === 1) {
          const selected = sorted.find((it) => selectedPaths.has(it.path));
          if (selected) onOpen(selected);
        }
        return;
      }

      if (matchIndex === -1) return;

      const match = sorted[matchIndex];
      setLastClickedIndex(matchIndex);
      const next = new Set<string>();
      next.add(match.path);
      onSelectionChange(next);
      rowVirtualizer.scrollToIndex(matchIndex, { align: 'auto' });
    },
    [sorted, onSelectionChange, renamingPath, selectedPaths, onOpen, rowVirtualizer]
  );

  const SortHeader: React.FC<{ label: string; sortKeyName: SortKey; className?: string }> = ({
    label,
    sortKeyName,
    className,
  }) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKeyName)}
      className={classNames(
        'flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wider text-txt-muted hover:text-txt-primary transition-colors min-w-0',
        className
      )}
    >
      <span className="truncate">{label}</span>
      {sortKey === sortKeyName && <span className="text-sky-400 font-bold shrink-0">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-app-card">
      <div className="grid grid-cols-[minmax(120px,1fr)_70px_100px_135px] items-center gap-3 border-b border-border-subtle bg-app-surface px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <SortHeader label="Name" sortKeyName="name" />
          {filterText?.trim() && (
            <span className="truncate rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.2 text-[10px] font-medium text-sky-400">
              {sorted.length} of {entries.length}
            </span>
          )}
        </div>
        <SortHeader label="Size" sortKeyName="size" />
        <SortHeader label="Permissions" sortKeyName="permissions" />
        <SortHeader label="Modified" sortKeyName="mtime" />
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        className="flex-1 overflow-y-auto outline-none focus:ring-1 focus:ring-inset focus:ring-sky-500/40"
        onMouseDown={() => containerRef.current?.focus()}
        onKeyDown={handleContainerKeyDown}
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
          onEntryDragLeave?.(entries[0]);
          onPaneDrop?.(e);
        }}
        onClick={(e) => {
          if (e.currentTarget === e.target) onSelectionChange(new Set());
        }}
        onContextMenu={(e) => {
          if (e.currentTarget === e.target) {
            e.preventDefault();
            onSelectionChange(new Set());
            onPaneContextMenu?.(e);
          }
        }}
      >
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-txt-muted">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            Loading files...
          </div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="py-8 text-center text-sm text-txt-muted">
            {filterText?.trim() ? `No files match "${filterText.trim()}"` : 'Folder is empty'}
          </div>
        )}
        {!loading && sorted.length > 0 && (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = sorted[virtualRow.index];
              const index = virtualRow.index;
              const Icon = iconForEntry(entry);
              const selected = selectedPaths.has(entry.path);
              const isDropHover = dragOverPath === entry.path;
              const renaming = renamingPath === entry.path;
              return (
                <div
                  key={entry.path}
                  role="row"
                  data-entry-path={entry.path}
                  draggable
                  onDragStart={(e) => {
                    onDraggableStart?.(entry, e);
                  }}
                  onDragEnd={() => onDraggableEnd?.()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (isDropTarget?.(entry)) {
                      onEntryDragOver?.(entry, e);
                    } else if (dragOverPath) {
                      onEntryDragLeave?.(entry);
                    }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (isDropTarget?.(entry)) {
                      onEntryDragOver?.(entry, e);
                    }
                  }}
                  onDragLeave={() => onEntryDragLeave?.(entry)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isDropTarget?.(entry)) {
                      onEntryDrop?.(entry, e);
                    } else {
                      onPaneDrop?.(e);
                    }
                  }}
                  onClick={(e) => handleRowClick(entry, index, e)}
                  onDoubleClick={() => onOpen(entry)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (!selectedPaths.has(entry.path)) {
                      const next = new Set<string>();
                      next.add(entry.path);
                      setLastClickedIndex(index);
                      onSelectionChange(next);
                    }
                    onEntryContextMenu?.(entry, e);
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className={classNames(
                    'grid cursor-default grid-cols-[minmax(120px,1fr)_70px_100px_135px] items-center gap-3 border-b border-white/[0.04] dark:border-white/[0.04] border-slate-200/60 px-3 text-sm select-none transition-colors',
                    selected
                      ? 'bg-sky-500/15 text-txt-primary font-medium'
                      : 'text-txt-primary hover:bg-app-surface-hover',
                    isDropHover && 'ring-1 ring-inset ring-sky-400 bg-sky-500/20'
                  )}
                >
                  <div className="pointer-events-none flex min-w-0 items-center gap-2">
                    <Icon
                      className={classNames(
                        'h-4 w-4 shrink-0',
                        entry.isDirectory ? 'text-amber-400' : 'text-txt-muted'
                      )}
                    />
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
                        className="pointer-events-auto w-full rounded-md border border-sky-500 bg-app-input px-1.5 py-0.5 text-sm text-txt-primary outline-none"
                      />
                    ) : (
                      <span className="truncate">{entry.name}</span>
                    )}
                  </div>
                  <span className="pointer-events-none truncate text-xs text-txt-muted">{entry.isDirectory ? '' : formatBytes(entry.size)}</span>
                  <span className="pointer-events-none truncate font-mono text-xs text-txt-muted">{entry.permissions ?? '-'}</span>
                  <span className="pointer-events-none truncate text-xs text-txt-muted">{entry.mtime ?? ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileList;
