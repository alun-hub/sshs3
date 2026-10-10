import React, { useState } from 'react';
import { ArrowLeft, ChevronRight, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import type { TeamFolderNode } from './teamProfileTree';
import { findFolderNode, flattenTeamFolderTree } from './teamProfileTree';

interface TeamProfileTreeProps<T> {
  roots: TeamFolderNode<T>[];
  ungrouped: T[];
  /** Breadcrumb position — segment names from the root, e.g. `['Acme Infra', 'Cluster A']`.
   * Lifted to `ConnectionManagerModal` so it survives re-renders of this component. */
  currentPath: string[];
  onNavigate: (path: string[]) => void;
  /** The connection search query (already the same trimmed string driving `filteredTeamSSH`/
   * `filteredTeamS3` in the parent) — non-empty switches this component into a flat,
   * path-labeled search-results list instead of card/breadcrumb navigation. */
  query: string;
  renderProfile: (profile: T) => React.ReactNode;
  onDropProfile: (targetPath: string | undefined, e: React.DragEvent) => void;
  onCreateFolder: (fullPath: string) => Promise<void> | void;
  onRenameFolder: (oldPath: string, newPath: string) => Promise<void> | void;
  onDeleteFolder: (path: string) => Promise<void> | void;
}

/**
 * Browses the shared, arbitrarily-deep Team Vault folder tree (see `teamProfileTree.ts`) as a
 * card grid with breadcrumb drill-down — one level visible at a time, navigated by clicking a
 * folder card or a breadcrumb segment — rather than an always-expanded indented tree. Modeled
 * visually on `feature/connection-system-model`'s `SystemCardGrid`/breadcrumb pattern (kept only
 * as a UI reference, not reused as code: that branch's `ConnectionSystem` is a separate typed
 * entity with its own id/parentSystemId, while a Team Vault folder is just a `/`-separated path
 * segment on `TeamFolderNode`).
 */
export function TeamProfileTree<T>({
  roots,
  ungrouped,
  currentPath,
  onNavigate,
  query,
  renderProfile,
  onDropProfile,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: TeamProfileTreeProps<T>): React.ReactElement {
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const commitNewFolder = () => {
    const trimmed = newFolderName.trim();
    setCreatingFolder(false);
    setNewFolderName('');
    if (!trimmed) return;
    void onCreateFolder([...currentPath, trimmed].join('/'));
  };

  const commitRename = (node: TeamFolderNode<T>) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === node.name) return;
    const parentSegments = node.path.split('/').slice(0, -1);
    void onRenameFolder(node.path, [...parentSegments, trimmed].join('/'));
  };

  const dropZoneClasses = (path: string | undefined, active: boolean) =>
    active && dragOverPath === (path ?? '')
      ? 'border-sky-400 bg-sky-500/15'
      : 'border-border-subtle bg-app-card hover:border-sky-500/40 hover:bg-app-surface-hover';

  // Search mode: ignore currentPath entirely and list every match (roots/ungrouped are already
  // query-filtered by the parent) flat, each labeled with its own folder path, so the user never
  // has to drill down to find where a remembered profile lives.
  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const results = flattenTeamFolderTree(roots, ungrouped);
    return (
      <div className="space-y-1.5">
        <p className="px-2 text-xs font-semibold text-txt-muted">Search results for &quot;{trimmedQuery}&quot;</p>
        {results.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-txt-muted">No matches</p>
        ) : (
          <div className="flex flex-col gap-2">
            {results.map(({ profile, path }, i) => (
              <div key={i} className="space-y-0.5">
                <p className="px-2 text-2xs text-txt-muted">{path ?? 'Ungrouped'}</p>
                {renderProfile(profile)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const atRoot = currentPath.length === 0;
  const currentNode = atRoot ? null : findFolderNode(roots, currentPath);
  const children = atRoot ? roots : (currentNode?.children ?? []);
  const profilesHere = atRoot ? [] : (currentNode?.profiles ?? []);

  const renderCard = (node: TeamFolderNode<T>) => {
    const isRenaming = renamingPath === node.path;
    const open = () => onNavigate([...currentPath, node.name]);
    return (
      <div
        key={node.path}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dragOverPath !== node.path) setDragOverPath(node.path);
        }}
        onDragLeave={() => {
          if (dragOverPath === node.path) setDragOverPath(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverPath(null);
          onDropProfile(node.path, e);
        }}
        className={`flex flex-col justify-between rounded-xl border p-3 transition-colors ${dropZoneClasses(node.path, true)}`}
      >
        <div className="flex items-start justify-between w-full">
          <button
            type="button"
            onClick={open}
            title={`Open ${node.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
          >
            <Folder className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Rename folder"
              onClick={() => {
                setRenamingPath(node.path);
                setRenameValue(node.name);
              }}
              className="rounded p-1 text-txt-muted hover:text-txt-primary transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Delete folder (ungroups profiles inside, including subfolders)"
              onClick={() => void onDeleteFolder(node.path)}
              className="rounded p-1 text-txt-muted hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={`Open ${node.name}`}
              onClick={open}
              className="rounded p-1 text-txt-muted hover:text-sky-400 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <button type="button" onClick={open} className="mt-2 block w-full min-w-0 text-left">
          {isRenaming ? (
            <input
              type="text"
              autoFocus
              value={renameValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(node);
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setRenamingPath(null);
                }
              }}
              className="w-full rounded border border-sky-500 bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none"
            />
          ) : (
            <div className="truncate text-xs font-semibold text-txt-primary">{node.name}</div>
          )}
          <div className="mt-1 text-2xs text-txt-muted">
            {node.profiles.length} profile{node.profiles.length === 1 ? '' : 's'}
            {node.children.length > 0 &&
              ` · ${node.children.length} subfolder${node.children.length === 1 ? '' : 's'}`}
          </div>
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {!atRoot && (
        <div className="flex flex-wrap items-center gap-1 px-2 text-xs text-txt-muted">
          <button
            type="button"
            onClick={() => onNavigate(currentPath.slice(0, -1))}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <span className="mx-1">/</span>
          <button type="button" onClick={() => onNavigate([])} className="hover:text-txt-primary transition-colors">
            All folders
          </button>
          {currentPath.map((name, i) => (
            <React.Fragment key={i}>
              <ChevronRight className="h-3 w-3" />
              <button
                type="button"
                onClick={() => onNavigate(currentPath.slice(0, i + 1))}
                onDragOver={(e) => {
                  if (i === currentPath.length - 1) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const path = currentPath.slice(0, i + 1).join('/');
                  if (dragOverPath !== path) setDragOverPath(path);
                }}
                onDrop={(e) => {
                  if (i === currentPath.length - 1) return;
                  e.preventDefault();
                  setDragOverPath(null);
                  onDropProfile(currentPath.slice(0, i + 1).join('/'), e);
                }}
                className={
                  i === currentPath.length - 1
                    ? 'font-medium text-txt-primary'
                    : `rounded px-1 transition-colors hover:text-txt-primary ${
                        dragOverPath === currentPath.slice(0, i + 1).join('/') ? 'bg-sky-500/15 text-sky-300' : ''
                      }`
                }
              >
                {name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {children.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children.map((node) => renderCard(node))}</div>
      )}

      {!atRoot && profilesHere.length > 0 && (
        <div className="flex flex-col gap-1.5 px-2">{profilesHere.map((p) => renderProfile(p))}</div>
      )}

      {creatingFolder ? (
        <div className="flex items-center gap-1.5 px-2 py-1">
          <Folder className="h-3.5 w-3.5 text-txt-muted" />
          <input
            type="text"
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNewFolder();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setCreatingFolder(false);
                setNewFolderName('');
              }
            }}
            onBlur={commitNewFolder}
            placeholder="Folder name"
            className="rounded border border-sky-500 bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setCreatingFolder(true);
            setNewFolderName('');
          }}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-txt-muted hover:text-txt-secondary transition-colors"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          {atRoot ? 'New top-level folder' : 'New subfolder'}
        </button>
      )}

      {atRoot && ungrouped.length > 0 && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragOverPath !== '') setDragOverPath('');
          }}
          onDragLeave={() => {
            if (dragOverPath === '') setDragOverPath(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverPath(null);
            onDropProfile(undefined, e);
          }}
          className={`space-y-1.5 rounded-lg border p-1 transition-colors ${
            dragOverPath === '' ? 'border-dashed border-sky-400 bg-sky-500/15' : 'border-transparent'
          }`}
        >
          <p className="px-2 text-xs font-semibold text-txt-muted">Ungrouped</p>
          <div className="flex flex-col gap-1.5 px-2">{ungrouped.map((p) => renderProfile(p))}</div>
        </div>
      )}
    </div>
  );
}
