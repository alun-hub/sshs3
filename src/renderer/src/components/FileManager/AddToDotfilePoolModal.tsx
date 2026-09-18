import React, { useEffect, useState } from 'react';
import { Check, FileCode, Loader2, Plus, X } from 'lucide-react';
import type { DotfilePool } from '@shared/types/dotfiles';
import type { FileEntry } from '@shared/types/storage';

interface AddToDotfilePoolModalProps {
  open: boolean;
  onClose: () => void;
  sourceProviderId: string;
  entry: FileEntry | null;
  onSuccess?: (message: string) => void;
}

export const AddToDotfilePoolModal: React.FC<AddToDotfilePoolModalProps> = ({
  open,
  onClose,
  sourceProviderId,
  entry,
  onSuccess,
}) => {
  const [pools, setPools] = useState<DotfilePool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [isCreatingNewPool, setIsCreatingNewPool] = useState(false);
  const [newPoolName, setNewPoolName] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !entry) return;

    setError(null);
    setIsCreatingNewPool(false);
    setNewPoolName('');

    const defaultRemote = entry.name.startsWith('.') ? `~/${entry.name}` : `~/.${entry.name}`;
    setRemotePath(defaultRemote);

    setLoading(true);
    window.multissh
      .dotfilePoolsGet()
      .then((loaded) => {
        setPools(loaded);
        if (loaded.length > 0) {
          setSelectedPoolId(loaded[0].id);
        } else {
          setIsCreatingNewPool(true);
          setNewPoolName('Linux Standard Dotfiles');
        }
      })
      .catch((err) => {
        setError(String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, entry]);

  if (!open || !entry) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remotePath.trim()) return;

    setSaving(true);
    setError(null);
    try {
      let poolId = selectedPoolId;
      if (isCreatingNewPool) {
        if (!newPoolName.trim()) {
          setError('Enter a name for the new pool');
          setSaving(false);
          return;
        }
        const newPool: DotfilePool = {
          id: crypto.randomUUID(),
          name: newPoolName.trim(),
          files: [],
        };
        await window.multissh.dotfilePoolsSave(newPool);
        poolId = newPool.id;
      }

      await window.multissh.dotfilePoolAddFromStorage({
        poolId,
        providerId: sourceProviderId,
        filePath: entry.path,
        targetRemotePath: remotePath.trim(),
      });

      const poolName =
        isCreatingNewPool
          ? newPoolName.trim()
          : pools.find((p) => p.id === poolId)?.name || 'the pool';
      onSuccess?.(`Saved ${entry.name} as a master file in "${poolName}"`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        <div className="flex h-12 items-center justify-between border-b border-border-subtle bg-app-surface px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">Add to Dotfiles Pool</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-txt-secondary">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-400 text-xs">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <span className="text-xs font-medium text-txt-primary">Source File</span>
            <div className="rounded-lg border border-border-subtle bg-app-input px-3 py-2 font-mono text-txt-primary truncate">
              {entry.path}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-medium text-txt-primary">Target Path on Server (remotePath)</span>
            <input
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              placeholder="e.g. ~/.bashrc"
              className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 font-mono text-txt-primary outline-none focus:border-sky-500"
            />
            <p className="text-[11px] text-txt-muted">
              The path the file is automatically written to when the pool syncs to a connected server.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-txt-primary">Select Pool</span>
              {pools.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsCreatingNewPool(!isCreatingNewPool)}
                  className="text-xs text-sky-400 hover:underline flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />
                  {isCreatingNewPool ? 'Select Existing Pool' : 'Create New Pool'}
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-4 text-txt-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : isCreatingNewPool ? (
              <input
                value={newPoolName}
                onChange={(e) => setNewPoolName(e.target.value)}
                placeholder="New pool name, e.g. Personal dotfiles"
                className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-txt-primary outline-none focus:border-sky-500"
              />
            ) : (
              <select
                value={selectedPoolId}
                onChange={(e) => setSelectedPoolId(e.target.value)}
                className="w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-txt-primary outline-none focus:border-sky-500"
              >
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.files.length} files)
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || (!isCreatingNewPool && !selectedPoolId)}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 shadow-sm transition-colors"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save as Master File
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddToDotfilePoolModal;
