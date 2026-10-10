import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import type { TeamFolderNode } from './teamProfileTree';

interface TeamProfileTreeProps<T> {
  roots: TeamFolderNode<T>[];
  ungrouped: T[];
  renderProfile: (profile: T) => React.ReactNode;
  onDropProfile: (targetPath: string | undefined, e: React.DragEvent) => void;
  onCreateFolder: (fullPath: string) => Promise<void> | void;
  onRenameFolder: (oldPath: string, newPath: string) => Promise<void> | void;
  onDeleteFolder: (path: string) => Promise<void> | void;
}

/**
 * Renders the shared, arbitrarily-deep Team Vault folder tree (see `teamProfileTree.ts`) —
 * unlike personal profiles' single-level `groupProfiles`/`ProfileFolderHeader` list, a node here
 * can itself contain subfolders (e.g. one system's two clusters plus a jumpbox). Reuses
 * `ProfileFolderHeader`'s visual language (collapse chevron, inline rename, delete) per node,
 * just recursively, and the same native-HTML5-drag convention `SshProfileRows`/`S3ProfileRows`
 * already use for dropping a profile onto a folder.
 */
export function TeamProfileTree<T>({
  roots,
  ungrouped,
  renderProfile,
  onDropProfile,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: TeamProfileTreeProps<T>): React.ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');

  const toggle = (path: string) => setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }));

  const commitNewFolder = (parentPath: string | null) => {
    const trimmed = newFolderName.trim();
    setNewFolderParent(undefined);
    setNewFolderName('');
    if (!trimmed) return;
    void onCreateFolder(parentPath ? `${parentPath}/${trimmed}` : trimmed);
  };

  const commitRename = (path: string) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === path.split('/').pop()) return;
    const parentSegments = path.split('/').slice(0, -1);
    const newPath = [...parentSegments, trimmed].join('/');
    void onRenameFolder(path, newPath);
  };

  const dropZoneClasses = (path: string | undefined) =>
    dragOverPath === (path ?? '') ? 'border border-dashed border-sky-400 bg-sky-500/15' : 'hover:bg-app-surface-hover';

  const newFolderRow = (parentPath: string | null) =>
    newFolderParent === parentPath ? (
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Folder className="h-3.5 w-3.5 text-txt-muted" />
        <input
          type="text"
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitNewFolder(parentPath);
            if (e.key === 'Escape') {
              e.stopPropagation();
              setNewFolderParent(undefined);
              setNewFolderName('');
            }
          }}
          onBlur={() => commitNewFolder(parentPath)}
          placeholder="Folder name"
          className="rounded border border-sky-500 bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none"
        />
      </div>
    ) : null;

  const renderNode = (node: TeamFolderNode<T>, depth: number): React.ReactElement => {
    const isCollapsed = Boolean(collapsed[node.path]);
    return (
      <div key={node.path} className="space-y-1" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
        <div
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
          className={`flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${dropZoneClasses(node.path)}`}
        >
          <button
            type="button"
            onClick={() => toggle(node.path)}
            className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-txt-secondary"
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
            )}
            <Folder className="h-3.5 w-3.5 text-amber-400" />
            {renamingPath === node.path ? (
              <input
                type="text"
                autoFocus
                value={renameValue}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(node.path);
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setRenamingPath(null);
                  }
                }}
                className="rounded border border-sky-500 bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none"
              />
            ) : (
              <span>{node.name}</span>
            )}
            <span className="rounded-full bg-app-surface px-1.5 py-0.2 text-2xs text-txt-muted">
              {node.profiles.length}
            </span>
          </button>
          <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
            <button
              type="button"
              title="New subfolder"
              onClick={() => {
                setNewFolderParent(node.path);
                setNewFolderName('');
              }}
              className="rounded p-1 text-txt-muted hover:text-txt-primary transition-colors"
            >
              <FolderPlus className="h-3 w-3" />
            </button>
            <button
              type="button"
              title="Rename folder"
              onClick={() => {
                setRenamingPath(node.path);
                setRenameValue(node.name);
              }}
              className="rounded p-1 text-txt-muted hover:text-txt-primary transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              title="Delete folder (ungroups profiles inside, including subfolders)"
              onClick={() => void onDeleteFolder(node.path)}
              className="rounded p-1 text-txt-muted hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="flex flex-col gap-1.5 px-2">
            {node.profiles.map((p) => renderProfile(p))}
            {node.children.map((child) => renderNode(child, depth + 1))}
            {newFolderRow(node.path)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      {roots.map((node) => renderNode(node, 0))}
      {newFolderRow(null)}

      <div className="flex items-center justify-between px-2 py-1">
        <button
          type="button"
          onClick={() => {
            setNewFolderParent(null);
            setNewFolderName('');
          }}
          className="flex items-center gap-1.5 text-xs font-medium text-txt-muted hover:text-txt-secondary"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          New top-level folder
        </button>
      </div>

      {ungrouped.length > 0 && (
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
          className={`space-y-1.5 rounded-lg p-1 ${dropZoneClasses(undefined)}`}
        >
          <p className="px-2 text-xs font-semibold text-txt-muted">Ungrouped</p>
          <div className="flex flex-col gap-1.5 px-2">{ungrouped.map((p) => renderProfile(p))}</div>
        </div>
      )}
    </div>
  );
}

