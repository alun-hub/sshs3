import React, { useEffect, useState } from 'react';
import { FileCode, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import type { DotfilePool, DotfilePoolFile } from '@shared/types/dotfiles';

interface DotfilePoolManagerModalProps {
  open: boolean;
  onClose: () => void;
}

function emptyPool(): DotfilePool {
  return { id: crypto.randomUUID(), name: '', files: [] };
}

function emptyFile(): DotfilePoolFile {
  return { id: crypto.randomUUID(), remotePath: '', content: '', mode: '' };
}

export const DotfilePoolManagerModal: React.FC<DotfilePoolManagerModalProps> = ({ open, onClose }) => {
  const [pools, setPools] = useState<DotfilePool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DotfilePool | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const loaded = await window.multissh.dotfilePoolsGet();
      setPools(loaded);
      return loaded;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSelectedId(null);
      setDraft(null);
      void load();
    }
  }, [open]);

  if (!open) return null;

  const selectPool = (pool: DotfilePool) => {
    setSelectedId(pool.id);
    setDraft(JSON.parse(JSON.stringify(pool)));
  };

  const startNewPool = () => {
    const pool = emptyPool();
    setSelectedId(pool.id);
    setDraft(pool);
  };

  const updateDraft = <K extends keyof DotfilePool>(key: K, value: DotfilePool[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateFile = (fileId: string, patch: Partial<DotfilePoolFile>) => {
    setDraft((prev) =>
      prev
        ? { ...prev, files: prev.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)) }
        : prev
    );
  };

  const addFile = () => {
    setDraft((prev) => (prev ? { ...prev, files: [...prev.files, emptyFile()] } : prev));
  };

  const removeFile = (fileId: string) => {
    setDraft((prev) => (prev ? { ...prev, files: prev.files.filter((f) => f.id !== fileId) } : prev));
  };

  const handleSave = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    try {
      await window.multissh.dotfilePoolsSave(draft);
      const updated = await load();
      const saved = updated.find((p) => p.id === draft.id);
      if (saved) selectPool(saved);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await window.multissh.dotfilePoolsDelete(id);
    setSelectedId(null);
    setDraft(null);
    void load();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="flex h-[560px] w-full max-w-3xl flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-app-surface px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <FileCode className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-semibold text-txt-primary">Dotfile Pools</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <aside className="w-52 shrink-0 border-r border-border-subtle bg-app-surface p-2.5 flex flex-col gap-1 overflow-y-auto">
            <button
              type="button"
              onClick={startNewPool}
              className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1.5 text-xs font-medium text-sky-400 hover:bg-app-surface-hover transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Pool
            </button>
            {loading ? (
              <div className="flex items-center justify-center py-4 text-txt-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : pools.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-txt-muted">No pools yet.</p>
            ) : (
              pools.map((pool) => (
                <button
                  key={pool.id}
                  type="button"
                  onClick={() => selectPool(pool)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                    selectedId === pool.id
                      ? 'bg-sky-500/15 text-sky-400 font-semibold'
                      : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                  }`}
                >
                  <span className="truncate">{pool.name || '(unnamed)'}</span>
                  <span className="ml-2 shrink-0 rounded bg-app-surface px-1.5 py-0.5 text-[10px] text-txt-muted font-mono">
                    {pool.files.length}
                  </span>
                </button>
              ))
            )}
          </aside>

          <div className="flex flex-1 flex-col min-w-0 bg-app-card">
            {!draft ? (
              <div className="flex flex-1 items-center justify-center text-xs text-txt-muted">
                Select a pool or create a new one.
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-txt-secondary">
                  <label className="flex flex-col gap-1">
                    Pool Name
                    <input
                      value={draft.name}
                      onChange={(e) => updateDraft('name', e.target.value)}
                      placeholder="e.g. Standard Linux dotfiles"
                      className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500"
                    />
                  </label>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-txt-primary">Files</span>
                      <button
                        type="button"
                        onClick={addFile}
                        className="flex items-center gap-1 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1 text-xs text-sky-400 hover:bg-app-surface-hover transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        Add File
                      </button>
                    </div>

                    {draft.files.length === 0 && (
                      <p className="py-2 text-center text-txt-muted">No files in this pool yet.</p>
                    )}

                    {draft.files.map((file) => (
                      <div
                        key={file.id}
                        className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-app-surface p-3"
                      >
                        <div className="grid grid-cols-[1fr_80px_auto] gap-2">
                          <input
                            value={file.remotePath}
                            onChange={(e) => updateFile(file.id, { remotePath: e.target.value })}
                            placeholder="~/.bashrc"
                            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                          />
                          <input
                            value={file.mode ?? ''}
                            onChange={(e) => updateFile(file.id, { mode: e.target.value })}
                            placeholder="mode"
                            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono text-center"
                          />
                          <button
                            type="button"
                            onClick={() => removeFile(file.id)}
                            className="rounded-lg p-1.5 text-red-400 hover:bg-app-surface-hover transition-colors"
                            title="Remove file"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <textarea
                          value={file.content}
                          onChange={(e) => updateFile(file.id, { content: e.target.value })}
                          rows={5}
                          placeholder="File contents..."
                          className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border-subtle bg-app-surface px-5 py-3">
                  <button
                    type="button"
                    onClick={() => void handleDelete(draft.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-app-surface-hover transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Pool
                  </button>
                  <button
                    type="button"
                    disabled={!draft.name.trim() || saving}
                    onClick={() => void handleSave()}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 shadow-sm transition-colors"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save Pool
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DotfilePoolManagerModal;
