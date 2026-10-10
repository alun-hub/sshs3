import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, ChevronRight, Folder, Pencil, Trash2 } from 'lucide-react';

interface ProfileFolderHeaderProps {
  groupName: string;
  /** Display text, when it should differ from `groupName` (the identity used for
   * rename/delete) — e.g. a Team Vault tree node showing just its own segment ("Cluster A")
   * while `groupName` carries the full path ("Acme Infra/Cluster A"). Defaults to `groupName`. */
  label?: string;
  profileCount: number;
  isCollapsed: boolean;
  isDragOver: boolean;
  dragOverGroup: string | null;
  setDragOverGroup: Dispatch<SetStateAction<string | null>>;
  renamingFolder: string | null;
  setRenamingFolder: Dispatch<SetStateAction<string | null>>;
  renameFolderValue: string;
  setRenameFolderValue: Dispatch<SetStateAction<string>>;
  onToggle: () => void;
  onDrop: (e: React.DragEvent) => void;
  onCommitRename: (groupName: string) => Promise<void> | void;
  onDeleteFolder: (groupName: string) => Promise<void> | void;
}

/** A folder row in the profile list: collapse toggle, inline rename, delete, and drop target for dragged profiles. */
export const ProfileFolderHeader: React.FC<ProfileFolderHeaderProps> = ({
  groupName,
  label,
  profileCount,
  isCollapsed,
  isDragOver,
  dragOverGroup,
  setDragOverGroup,
  renamingFolder,
  setRenamingFolder,
  renameFolderValue,
  setRenameFolderValue,
  onToggle,
  onDrop,
  onCommitRename,
  onDeleteFolder,
}) => (
  <div
    onDragOver={(e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverGroup !== groupName) setDragOverGroup(groupName);
    }}
    onDragLeave={() => {
      if (dragOverGroup === groupName) setDragOverGroup(null);
    }}
    onDrop={(e) => onDrop(e)}
    className={`flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${
      isDragOver
        ? 'border border-dashed border-sky-400 bg-sky-500/15'
        : 'hover:bg-app-surface-hover'
    }`}
  >
    <button
      type="button"
      onClick={() => onToggle()}
      className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-txt-secondary"
    >
      {isCollapsed ? (
        <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
      )}
      <Folder className="h-3.5 w-3.5 text-amber-400" />
      {renamingFolder === groupName ? (
        <input
          type="text"
          autoFocus
          value={renameFolderValue}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRenameFolderValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onCommitRename(groupName);
            if (e.key === 'Escape') {
              // Stop this local Escape from also
              // bubbling up to the modal's own
              // window-level Escape-to-close handler
              // (M12) — it should only cancel the
              // rename here, not close the dialog.
              e.stopPropagation();
              setRenamingFolder(null);
            }
          }}
          className="rounded border border-sky-500 bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none"
        />
      ) : (
        <span>{label ?? groupName}</span>
      )}
      <span className="rounded-full bg-app-surface px-1.5 py-0.2 text-2xs text-txt-muted">
        {profileCount}
      </span>
    </button>

    {groupName !== 'Ungrouped' && (
      <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
        <button
          type="button"
          title="Rename folder"
          onClick={() => {
            setRenamingFolder(groupName);
            setRenameFolderValue(groupName);
          }}
          className="rounded p-1 text-txt-muted hover:text-txt-primary transition-colors"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Delete folder (ungroup profiles)"
          onClick={() => void onDeleteFolder(groupName)}
          className="rounded p-1 text-txt-muted hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    )}
  </div>
);
