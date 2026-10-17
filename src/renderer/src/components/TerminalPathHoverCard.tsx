import React, { useMemo } from 'react';
import {
  File,
  FileCode,
  FileCog,
  FileImage,
  FileArchive,
  FileText,
  Folder,
  Copy,
  ExternalLink,
  Edit3,
  Eye,
  X,
} from 'lucide-react';
import { resolvePathDetails, type FileTypeCategory } from '../lib/terminalPathPreview';

export interface TerminalPathHoverCardProps {
  path: string;
  x: number;
  y: number;
  userHome?: string;
  currentCwd?: string;
  onClose: () => void;
  onCopyPath: (path: string) => void;
  onOpenPath?: (path: string) => void;
  onOpenEditor?: (path: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const CATEGORY_ICONS: Record<FileTypeCategory, React.ComponentType<{ className?: string }>> = {
  code: FileCode,
  config: FileCog,
  image: FileImage,
  archive: FileArchive,
  markdown: FileText,
  document: FileText,
  directory: Folder,
  unknown: File,
};

const CATEGORY_BADGES: Record<FileTypeCategory, string> = {
  code: 'bg-sky-950/60 text-sky-300 border-sky-800/60',
  config: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  image: 'bg-purple-950/60 text-purple-300 border-purple-800/60',
  archive: 'bg-orange-950/60 text-orange-300 border-orange-800/60',
  markdown: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60',
  document: 'bg-blue-950/60 text-blue-300 border-blue-800/60',
  directory: 'bg-yellow-950/60 text-yellow-300 border-yellow-800/60',
  unknown: 'bg-slate-900/60 text-slate-300 border-slate-700/60',
};

export const TerminalPathHoverCard: React.FC<TerminalPathHoverCardProps> = ({
  path,
  x,
  y,
  userHome,
  currentCwd,
  onClose,
  onCopyPath,
  onOpenPath,
  onOpenEditor,
  onMouseEnter,
  onMouseLeave,
}) => {
  const details = useMemo(() => resolvePathDetails(path, userHome, currentCwd), [path, userHome, currentCwd]);
  const Icon = CATEGORY_ICONS[details.category] || File;
  const badgeStyle = CATEGORY_BADGES[details.category] || CATEGORY_BADGES.unknown;

  // Collision detection: ensure the hover card stays within viewport
  const cardWidth = 320;
  const cardHeight = 130;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;

  let left = x + 12;
  if (left + cardWidth > viewportWidth - 16) {
    left = Math.max(16, x - cardWidth - 12);
  }

  let top = y + 16;
  if (top + cardHeight > viewportHeight - 16) {
    top = Math.max(16, y - cardHeight - 16);
  }

  return (
    <div
      data-testid="terminal-path-hover-card"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ left: `${left}px`, top: `${top}px` }}
      className="fixed z-50 flex flex-col w-80 rounded-xl border border-border-subtle bg-app-surface/95 p-3 shadow-2xl backdrop-blur-md animate-fade-in text-txt-primary select-none pointer-events-auto"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-divider pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-app-card border border-divider text-brand-s3">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold text-xs leading-none" title={details.basename}>
                {details.basename}
              </span>
              <span
                className={`rounded border px-1.5 py-0.2 text-[9px] font-mono leading-tight ${badgeStyle}`}
              >
                {details.label}
              </span>
            </div>
            <span
              className="truncate text-[10px] font-mono text-txt-muted mt-0.5 leading-none"
              title={details.fullPath}
            >
              {details.fullPath}
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close hover preview"
          onClick={onClose}
          className="rounded p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 pt-2 text-[11px]">
        <button
          type="button"
          onClick={() => onCopyPath(details.fullPath)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-divider bg-app-card px-2 py-1 text-txt-secondary hover:border-amber-500/40 hover:text-txt-primary hover:bg-app-surface-hover transition-colors font-medium"
        >
          <Copy className="h-3 w-3 text-txt-muted" />
          <span>Copy Path</span>
        </button>

        {onOpenEditor && !details.isDir && (
          <button
            type="button"
            onClick={() => onOpenEditor(details.fullPath)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-divider bg-app-card px-2 py-1 text-txt-secondary hover:border-sky-500/40 hover:text-sky-300 hover:bg-app-surface-hover transition-colors font-medium"
          >
            {details.category === 'image' || details.extension === 'pdf' ? (
              <Eye className="h-3 w-3 text-sky-400" />
            ) : (
              <Edit3 className="h-3 w-3 text-sky-400" />
            )}
            <span>{details.category === 'image' || details.extension === 'pdf' ? 'View' : 'Edit'}</span>
          </button>
        )}

        {onOpenPath && (
          <button
            type="button"
            onClick={() => onOpenPath(details.fullPath)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-divider bg-app-card px-2 py-1 text-txt-secondary hover:border-amber-500/40 hover:text-amber-300 hover:bg-app-surface-hover transition-colors font-medium"
          >
            <ExternalLink className="h-3 w-3 text-amber-400" />
            <span>{details.isDir ? 'Browse' : 'Reveal'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
