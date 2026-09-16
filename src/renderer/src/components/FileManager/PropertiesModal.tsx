import React, { useEffect, useState } from 'react';
import { Info, Loader2, X } from 'lucide-react';
import type { FileEntry } from '@shared/types/storage';
import { formatBytes } from '../../lib/format';
import type { SourceType } from './types';

interface PropertiesModalProps {
  open: boolean;
  providerId: string;
  sourceType: SourceType;
  entries: FileEntry[];
  onClose: () => void;
  onSaved?: () => void;
}

interface Row {
  label: string;
  value: string;
}

export const PropertiesModal: React.FC<PropertiesModalProps> = ({
  open,
  providerId,
  sourceType,
  entries,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<FileEntry | null>(null);
  const [contentType, setContentType] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setError(null);
    if (entries.length === 1) {
      setLoading(true);
      window.multissh
        .storageStat(providerId, entries[0].path)
        .then((entry) => {
          setDetail(entry);
          setContentType(entry.mimeType ?? '');
        })
        .catch((err) => setError(err instanceof Error ? err.message : 'Kunde inte hämta filinformation'))
        .finally(() => setLoading(false));
    }
  }, [open, providerId, entries]);

  if (!open) return null;

  const single = entries.length === 1 ? (detail ?? entries[0]) : null;
  const totalSize = entries.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.size), 0);
  const fileCount = entries.filter((e) => !e.isDirectory).length;
  const dirCount = entries.filter((e) => e.isDirectory).length;
  const canEditContentType = sourceType === 's3' && single !== null && !single.isDirectory;

  const rows: Row[] = single
    ? [
        { label: 'Namn', value: single.name },
        { label: 'Sökväg', value: single.path },
        { label: 'Typ', value: single.isDirectory ? 'Mapp' : 'Fil' },
        { label: 'Storlek', value: single.isDirectory ? '-' : `${formatBytes(single.size)} (${single.size} bytes)` },
        { label: 'Rättigheter', value: single.permissions ?? '-' },
        { label: 'Senast ändrad', value: single.mtime ?? '-' },
      ]
    : [
        { label: 'Antal objekt', value: `${entries.length} (${fileCount} filer, ${dirCount} mappar)` },
        { label: 'Total storlek', value: `${formatBytes(totalSize)} (${totalSize} bytes)` },
      ];

  const handleSaveContentType = async () => {
    if (!single) return;
    setSaving(true);
    setError(null);
    try {
      await window.multissh.storageSetMetadata(providerId, single.path, { contentType: contentType.trim() });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte uppdatera metadata');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Egenskaper</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 text-xs text-slate-300">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Läser in...
            </div>
          )}
          {error && (
            <div className="mb-3 rounded border border-red-800/80 bg-red-950/60 p-2 text-red-300">{error}</div>
          )}
          {!loading && (
            <dl className="divide-y divide-slate-800/60 rounded border border-slate-800 bg-slate-950">
              {rows.map((row) => (
                <div key={row.label} className="flex items-start gap-3 px-3 py-2">
                  <dt className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">{row.label}</dt>
                  <dd className="min-w-0 flex-1 break-all font-mono text-xs text-slate-200">{row.value}</dd>
                </div>
              ))}
              {canEditContentType && (
                <div className="flex items-center gap-3 px-3 py-2">
                  <dt className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">Content-Type</dt>
                  <dd className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={contentType}
                      onChange={(e) => setContentType(e.target.value)}
                      placeholder="application/octet-stream"
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
                    />
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-800/50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            Stäng
          </button>
          {canEditContentType && (
            <button
              type="button"
              onClick={() => void handleSaveContentType()}
              disabled={saving || contentType.trim() === (single?.mimeType ?? '')}
              className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Spara
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PropertiesModal;
