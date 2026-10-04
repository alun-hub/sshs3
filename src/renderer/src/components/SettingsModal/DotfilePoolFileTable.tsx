import React, { useState } from 'react';
import { AlertTriangle, Eye, EyeOff, FileCode, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import type { DotfilePoolFile } from '@shared/types/dotfiles';
import { formatBytes } from '../../lib/format';
import { looksLikeCredentialFile } from '../../lib/dotfileCredentials';

export type DotfileSourceStatus = 'up-to-date' | 'changed' | 'missing' | 'none';

interface DotfilePoolFileTableProps {
  files: DotfilePoolFile[];
  statuses: Record<string, DotfileSourceStatus>;
  onUpdate: (fileId: string, patch: Partial<DotfilePoolFile>) => void;
  onRemove: (fileId: string) => void;
  onRefresh: (fileId: string) => void;
}

function splitRemotePath(remotePath: string): { dir: string; name: string } {
  const idx = remotePath.lastIndexOf('/');
  if (idx < 0) return { dir: '~', name: remotePath };
  const dir = remotePath.slice(0, idx);
  return { dir: dir === '' ? '/' : dir, name: remotePath.slice(idx + 1) };
}

const STATUS_BADGE: Record<DotfileSourceStatus, { label: string; className: string; title: string } | null> = {
  'up-to-date': {
    label: 'Up to date',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    title: 'The stored copy matches the local source file',
  },
  changed: {
    label: 'Source changed',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    title: 'The local source file differs from the stored copy. Use Refresh to update it.',
  },
  missing: {
    label: 'Source missing',
    className: 'border-red-500/30 bg-red-500/10 text-red-300',
    title: 'The local source file no longer exists or can no longer be read',
  },
  none: null,
};

export const DotfilePoolFileTable: React.FC<DotfilePoolFileTableProps> = ({
  files,
  statuses,
  onUpdate,
  onRemove,
  onRefresh,
}) => {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);

  const groups = new Map<string, DotfilePoolFile[]>();
  for (const file of files) {
    const { dir } = splitRemotePath(file.remotePath);
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }
  const sortedDirs = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-3">
      {sortedDirs.map((dir) => (
        <div key={dir} className="rounded-lg border border-border-subtle bg-app-surface overflow-hidden">
          <div className="border-b border-divider bg-app-surface-subtle px-3 py-1.5 font-mono text-xs text-txt-secondary">
            {dir}
          </div>
          <ul className="divide-y divide-divider">
            {groups
              .get(dir)!
              .sort((a, b) => splitRemotePath(a.remotePath).name.localeCompare(splitRemotePath(b.remotePath).name))
              .map((file) => {
                const { name } = splitRemotePath(file.remotePath);
                const status = statuses[file.id] ?? 'none';
                const badge = STATUS_BADGE[status];
                const previewing = previewId === file.id;
                return (
                  <li key={file.id} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      {editingPathId === file.id ? (
                        <input
                          aria-label="Remote path"
                          autoFocus
                          value={file.remotePath}
                          onChange={(e) => onUpdate(file.id, { remotePath: e.target.value })}
                          onBlur={() => setEditingPathId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') setEditingPathId(null);
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-app-input px-2 py-1 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                        />
                      ) : (
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-xs text-txt-primary"
                          title={file.remotePath}
                        >
                          {name || file.remotePath}
                        </span>
                      )}
                      {looksLikeCredentialFile(file.remotePath) && (
                        <span
                          title="This looks like a credentials file. Pooled files are stored unencrypted on this device."
                          className="inline-flex"
                        >
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                        </span>
                      )}
                      {badge && (
                        <span
                          title={badge.title}
                          className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      )}
                      <span className="w-14 shrink-0 text-right text-xs text-txt-muted">
                        {formatBytes(new TextEncoder().encode(file.content).length)}
                      </span>
                      <input
                        aria-label="File mode"
                        value={file.mode ?? ''}
                        onChange={(e) => onUpdate(file.id, { mode: e.target.value })}
                        placeholder="mode"
                        title="File permissions (octal, e.g. 644 or 600)"
                        className="w-14 shrink-0 rounded-lg border border-border-subtle bg-app-input px-1.5 py-1 text-center font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                      />
                      <div className="flex shrink-0 items-center">
                        {status === 'changed' && (
                          <button
                            type="button"
                            aria-label="Refresh from source"
                            title="Re-read the local source file"
                            onClick={() => onRefresh(file.id)}
                            className="rounded-lg p-1.5 text-amber-300 hover:bg-app-surface-hover transition-colors"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={previewing ? 'Hide preview' : 'Preview content'}
                          title={previewing ? 'Hide preview' : 'Preview content (read-only)'}
                          onClick={() => setPreviewId(previewing ? null : file.id)}
                          className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                        >
                          {previewing ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          aria-label="Edit remote path"
                          title="Change where this file is written on the server"
                          onClick={() => setEditingPathId(file.id)}
                          className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove from pool"
                          title="Remove from the pool"
                          onClick={() => onRemove(file.id)}
                          className="rounded-lg p-1.5 text-red-400 hover:bg-app-surface-hover transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {previewing && (
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border-subtle bg-app-input px-2.5 py-2 font-mono text-xs leading-relaxed text-txt-secondary whitespace-pre-wrap break-all">
                        {file.content || '(empty file)'}
                      </pre>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default DotfilePoolFileTable;
