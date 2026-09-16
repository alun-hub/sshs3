import React, { useEffect, useState } from 'react';
import { Tag as TagIcon, X, Loader2, Plus, Trash2 } from 'lucide-react';
import type { S3Tag } from '@shared/types/storage';

interface TagsModalProps {
  open: boolean;
  providerId: string;
  targetPath: string;
  targetName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export const TagsModal: React.FC<TagsModalProps> = ({
  open,
  providerId,
  targetPath,
  targetName,
  onClose,
  onSaved,
}) => {
  const [tags, setTags] = useState<S3Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    window.multissh
      .storageGetTags(providerId, targetPath)
      .then(setTags)
      .catch((err) => setError(err instanceof Error ? err.message : 'Kunde inte hämta taggar'))
      .finally(() => setLoading(false));
  }, [open, providerId, targetPath]);

  if (!open) return null;

  const handleAdd = () => setTags((prev) => [...prev, { key: '', value: '' }]);
  const handleRemove = (idx: number) => setTags((prev) => prev.filter((_, i) => i !== idx));
  const handleChange = (idx: number, field: 'key' | 'value', value: string) =>
    setTags((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const cleaned = tags
        .map((t) => ({ key: t.key.trim(), value: t.value.trim() }))
        .filter((t) => t.key.length > 0);
      await window.multissh.storageSetTags(providerId, targetPath, cleaned);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte spara taggar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <TagIcon className="h-5 w-5 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Taggar</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs text-slate-300">
          <div className="rounded border border-slate-800 bg-slate-950 p-2.5">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">Mål</div>
            <div className="mt-1 font-mono text-xs text-slate-200 truncate">{targetName}</div>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Läser in...
            </div>
          )}

          {error && (
            <div className="rounded border border-red-800/80 bg-red-950/60 p-2 text-red-300">{error}</div>
          )}

          {!loading && (
            <div className="space-y-2">
              {tags.length === 0 && (
                <div className="rounded border border-dashed border-slate-700 p-3 text-center text-slate-500">
                  Inga taggar
                </div>
              )}
              {tags.map((tag, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Nyckel"
                    value={tag.key}
                    onChange={(e) => handleChange(idx, 'key', e.target.value)}
                    className="w-1/2 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="Värde"
                    value={tag.value}
                    onChange={(e) => handleChange(idx, 'value', e.target.value)}
                    className="w-1/2 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="shrink-0 rounded p-1.5 text-red-400 hover:bg-red-950/50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={handleAdd}
                className="flex items-center gap-1.5 rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                Lägg till tagg
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-800/50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Spara
          </button>
        </div>
      </div>
    </div>
  );
};

export default TagsModal;
