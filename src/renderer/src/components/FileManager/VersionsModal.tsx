import React, { useCallback, useEffect, useState } from 'react';
import { History, X, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { ObjectVersionEntry, S3VersioningStatus } from '@shared/types/storage';

interface VersionsModalProps {
  open: boolean;
  providerId: string;
  mode: 'bucket' | 'object';
  targetPath: string;
  targetName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export const VersionsModal: React.FC<VersionsModalProps> = ({
  open,
  providerId,
  mode,
  targetPath,
  targetName,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [status, setStatus] = useState<S3VersioningStatus>('Disabled');
  const [versions, setVersions] = useState<ObjectVersionEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'bucket') {
        const info = await window.multissh.storageGetBucketVersioning(providerId, targetPath);
        setStatus(info.status);
      } else {
        const list = await window.multissh.storageListObjectVersions(providerId, targetPath);
        setVersions(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte hämta versionsinformation');
    } finally {
      setLoading(false);
    }
  }, [mode, providerId, targetPath]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  if (!open) return null;

  const handleToggleVersioning = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.multissh.storageSetBucketVersioning(providerId, targetPath, status !== 'Enabled');
      onSaved?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ändra versionshantering');
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (versionId: string) => {
    if (!window.confirm('Återställ denna version som aktuell version av objektet?')) return;
    setBusy(true);
    setError(null);
    try {
      await window.multissh.storageRestoreObjectVersion(providerId, targetPath, versionId);
      onSaved?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte återställa versionen');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!window.confirm('Ta bort denna specifika version permanent? Detta kan inte ångras.')) return;
    setBusy(true);
    setError(null);
    try {
      await window.multissh.storageDeleteObjectVersion(providerId, targetPath, versionId);
      onSaved?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ta bort versionen');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              {mode === 'bucket' ? 'Versionshantering' : 'Objektversioner'} — {targetName}
            </h2>
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

          {!loading && mode === 'bucket' && (
            <div className="space-y-3">
              <div className="rounded border border-slate-800 bg-slate-950 p-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">Aktuell status</div>
                <div className="mt-1 text-sm font-medium text-slate-100">
                  {status === 'Enabled' ? 'Aktiverad' : status === 'Suspended' ? 'Pausad' : 'Ej aktiverad'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleToggleVersioning()}
                disabled={busy}
                className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {status === 'Enabled' ? 'Pausa versionshantering' : 'Aktivera versionshantering'}
              </button>
              <p className="text-slate-500">
                När versionshantering är aktiverad sparas alla tidigare versioner av objekt i denna bucket och kan
                återställas eller raderas individuellt via objektets kontextmeny.
              </p>
            </div>
          )}

          {!loading && mode === 'object' && (
            <div className="max-h-96 overflow-y-auto rounded border border-slate-800">
              {versions.length === 0 && (
                <div className="p-4 text-center text-slate-500">Inga versioner hittades (versionshantering är kanske inte aktiverad för bucketen)</div>
              )}
              {versions.length > 0 && (
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-slate-800/90 text-[11px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Version</th>
                      <th className="px-3 py-2 font-medium">Ändrad</th>
                      <th className="px-3 py-2 font-medium">Storlek</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium text-right">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {versions.map((v) => (
                      <tr key={v.versionId} className={v.isDeleteMarker ? 'text-slate-500' : 'text-slate-200'}>
                        <td className="max-w-[140px] truncate px-3 py-2 font-mono">{v.versionId || '(null)'}</td>
                        <td className="px-3 py-2">{v.lastModified ?? '-'}</td>
                        <td className="px-3 py-2">{v.isDeleteMarker ? '-' : `${v.size} B`}</td>
                        <td className="px-3 py-2">
                          {v.isDeleteMarker ? 'Raderingsmarkör' : v.isLatest ? 'Aktuell' : 'Tidigare'}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            {!v.isDeleteMarker && !v.isLatest && (
                              <button
                                type="button"
                                title="Återställ som aktuell version"
                                disabled={busy}
                                onClick={() => void handleRestore(v.versionId)}
                                className="rounded p-1 text-sky-400 hover:bg-sky-950/50 disabled:opacity-40"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              title="Ta bort denna version permanent"
                              disabled={busy}
                              onClick={() => void handleDeleteVersion(v.versionId)}
                              className="rounded p-1 text-red-400 hover:bg-red-950/50 disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-800/50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            Stäng
          </button>
        </div>
      </div>
    </div>
  );
};

export default VersionsModal;
