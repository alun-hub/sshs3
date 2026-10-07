import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, FileSearch, FileText, FolderPlus, Home, Pencil, RefreshCw, Search, Shield, Terminal, Trash2 } from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';
import { parentPath } from '../../lib/format';
import { Breadcrumbs } from './Breadcrumbs';
import { DiskSpaceMenu } from './DiskSpaceMenu';
import type { SourceType } from './types';

interface FilePaneToolbarProps {
  sourceType: SourceType;
  providerId: string;
  currentPath: string;
  selectedCount: number;
  firstSelected: FileEntry | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  showFilter: boolean;
  setShowFilter: Dispatch<SetStateAction<boolean>>;
  filterText: string;
  filterInputRef: React.RefObject<HTMLInputElement>;
  handleGoBack: () => void;
  handleGoForward: () => void;
  handleGoHome: () => Promise<void> | void;
  onPathChange: (path: string) => void;
  handleBreadcrumbDrop: (targetPath: string, e: React.DragEvent) => void;
  load: (force?: boolean) => Promise<void> | void;
  handleNewFolder: () => Promise<void> | void;
  handleRenameStart: () => void;
  handleDelete: () => Promise<void> | void;
  setEditorEntry: (entry: FileEntry | null) => void;
  setChmodOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  onOpenTerminal?: (path: string) => void;
  /** The git status entry, rendered between the breadcrumbs and the action groups. */
  children?: React.ReactNode;
}

/** Navigation buttons, breadcrumbs and the file action groups above the file list. */
export const FilePaneToolbar: React.FC<FilePaneToolbarProps> = ({
  sourceType,
  providerId,
  currentPath,
  selectedCount,
  firstSelected,
  canGoBack,
  canGoForward,
  showFilter,
  setShowFilter,
  filterText,
  filterInputRef,
  handleGoBack,
  handleGoForward,
  handleGoHome,
  onPathChange,
  handleBreadcrumbDrop,
  load,
  handleNewFolder,
  handleRenameStart,
  handleDelete,
  setEditorEntry,
  setChmodOpen,
  setSearchOpen,
  onOpenTerminal,
  children,
}) => (
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
      {sourceType !== 's3' && sourceType !== 'k8s' && (
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

    {children}

    {(sourceType === 'local' || sourceType === 'sftp') && (
      <DiskSpaceMenu
        providerId={providerId}
        canListVolumes={sourceType === 'local'}
        currentPath={currentPath}
        onNavigate={onPathChange}
      />
    )}

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
        disabled={selectedCount !== 1 || Boolean(firstSelected?.isDirectory)}
        onClick={() => firstSelected && setEditorEntry(firstSelected)}
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
        disabled={selectedCount !== 1}
        onClick={handleRenameStart}
        className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Delete"
        aria-label="Delete"
        disabled={selectedCount === 0}
        onClick={() => void handleDelete()}
        className="rounded-lg p-1 text-red-400 hover:bg-app-surface-hover disabled:opacity-30 transition-colors"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Change Permissions (chmod)"
        aria-label="Change Permissions (chmod)"
        disabled={selectedCount === 0 || sourceType === 's3'}
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
        title={sourceType === 'k8s' ? 'Search in Files not supported on Kubernetes' : 'Search in Files...'}
        aria-label={sourceType === 'k8s' ? 'Search in Files not supported on Kubernetes' : 'Search in Files...'}
        disabled={sourceType === 'k8s'}
        onClick={() => setSearchOpen(true)}
        className="rounded-lg p-1 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-30 transition-colors"
      >
        <FileSearch className="h-4 w-4" />
      </button>
      {(sourceType === 'sftp' || sourceType === 'k8s') && onOpenTerminal && (
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
);
