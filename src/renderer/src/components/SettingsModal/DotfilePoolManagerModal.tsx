import React, { useEffect, useState } from 'react';
import {
  FileCode,
  FolderOpen,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { DotfilePool, DotfilePoolFile } from '@shared/types/dotfiles';

interface DotfilePoolManagerModalProps {
  open: boolean;
  onClose: () => void;
}

function formatTimestamp(d = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function emptyPool(): DotfilePool {
  return { id: crypto.randomUUID(), name: '', files: [], updatedAt: formatTimestamp() };
}

function emptyFile(): DotfilePoolFile {
  return {
    id: crypto.randomUUID(),
    remotePath: '',
    content: '',
    mode: '',
    updatedAt: formatTimestamp(),
  };
}

export const DotfilePoolManagerModal: React.FC<DotfilePoolManagerModalProps> = ({ open, onClose }) => {
  const [pools, setPools] = useState<DotfilePool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DotfilePool | null>(null);
  const [saving, setSaving] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

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
        ? {
            ...prev,
            files: prev.files.map((f) =>
              f.id === fileId ? { ...f, ...patch, updatedAt: formatTimestamp() } : f
            ),
          }
        : prev
    );
  };

  const addFile = () => {
    setDraft((prev) => (prev ? { ...prev, files: [...prev.files, emptyFile()] } : prev));
  };

  const removeFile = (fileId: string) => {
    setDraft((prev) => (prev ? { ...prev, files: prev.files.filter((f) => f.id !== fileId) } : prev));
  };

  const handleUploadFiles = async () => {
    if (!draft) return;
    try {
      const imported = await window.multissh.dotfilePoolSelectFiles();
      if (!imported || imported.length === 0) return;

      const newFiles: DotfilePoolFile[] = imported.map((f) => {
        const remoteName = f.name.startsWith('.') ? f.name : `.${f.name}`;
        return {
          id: crypto.randomUUID(),
          remotePath: `~/${remoteName}`,
          content: f.content,
          mode: f.mode || '644',
          masterFileName: f.name,
          masterFilePath: f.path,
          updatedAt: formatTimestamp(),
        };
      });

      setDraft((prev) => {
        if (!prev) return prev;
        // Merge without duplicating remotePath
        const existingPaths = new Set(newFiles.map((nf) => nf.remotePath));
        const filtered = prev.files.filter((ef) => !existingPaths.has(ef.remotePath));
        return {
          ...prev,
          files: [...filtered, ...newFiles],
        };
      });
    } catch (err) {
      console.error('Failed to import dotfiles:', err);
    }
  };

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!draft) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const readFilesPromises = files.map(async (file) => {
      const text = await file.text();
      const remoteName = file.name.startsWith('.') ? file.name : `.${file.name}`;
      return {
        id: crypto.randomUUID(),
        remotePath: `~/${remoteName}`,
        content: text,
        mode: '644',
        masterFileName: file.name,
        masterFilePath: (file as unknown as { path?: string }).path,
        updatedAt: formatTimestamp(),
      } as DotfilePoolFile;
    });

    const newFiles = await Promise.all(readFilesPromises);
    setDraft((prev) => {
      if (!prev) return prev;
      const existingPaths = new Set(newFiles.map((nf) => nf.remotePath));
      const filtered = prev.files.filter((ef) => !existingPaths.has(ef.remotePath));
      return {
        ...prev,
        files: [...filtered, ...newFiles],
      };
    });
  };

  const handleOpenMasterFolder = async () => {
    if (!draft) return;
    try {
      await window.multissh.dotfilePoolOpenFolder(draft.id);
    } catch (err) {
      console.error('Failed to open pool folder:', err);
    }
  };

  const handleSave = async () => {
    if (!draft || !draft.name.trim()) return;
    setSaving(true);
    try {
      const poolToSave = {
        ...draft,
        updatedAt: formatTimestamp(),
      };
      await window.multissh.dotfilePoolsSave(poolToSave);
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
      <div className="flex h-[600px] w-full max-w-3xl flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-app-surface px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-txt-primary leading-tight">Dotfile Pools &amp; Masterfiler</h2>
              <p className="text-[11px] text-txt-muted">Ladda upp och hantera masterfiler för automatisk synkning till servrar</p>
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

        <div className="flex flex-1 min-h-0">
          <aside className="w-56 shrink-0 border-r border-border-subtle bg-app-surface p-2.5 flex flex-col gap-1 overflow-y-auto">
            <button
              type="button"
              onClick={startNewPool}
              className="mb-1.5 flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1.5 text-xs font-medium text-sky-400 hover:bg-app-surface-hover transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Ny pool
            </button>
            {loading ? (
              <div className="flex items-center justify-center py-4 text-txt-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : pools.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-txt-muted">Inga pooler sparade.</p>
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
                  <span className="truncate">{pool.name || '(namnlös pool)'}</span>
                  <span className="ml-2 shrink-0 rounded bg-app-surface px-1.5 py-0.5 text-[10px] text-txt-muted font-mono">
                    {pool.files.length} {pool.files.length === 1 ? 'fil' : 'filer'}
                  </span>
                </button>
              ))
            )}
          </aside>

          <div className="flex flex-1 flex-col min-w-0 bg-app-card">
            {!draft ? (
              <div className="flex flex-1 items-center justify-center text-xs text-txt-muted">
                Välj en pool till vänster eller skapa en ny.
              </div>
            ) : (
              <>
                <div
                  className={`flex-1 overflow-y-auto p-5 space-y-4 text-xs text-txt-secondary transition-colors ${
                    isDraggingOver ? 'bg-sky-500/5 ring-2 ring-inset ring-sky-500/30' : ''
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={handleDropFiles}
                >
                  <div className="flex items-end justify-between gap-3">
                    <label className="flex-1 flex flex-col gap-1">
                      <span className="text-xs font-medium text-txt-primary">Poolnamn</span>
                      <input
                        value={draft.name}
                        onChange={(e) => updateDraft('name', e.target.value)}
                        placeholder="t.ex. Linux Standard (.bashrc, .vimrc)"
                        className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleOpenMasterFolder()}
                      className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                      title="Öppna mappen med sparade masterfiler i systemets filutforskare"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-sky-400" />
                      Öppna masterkatalog
                    </button>
                  </div>

                  {draft.masterDirectory && (
                    <div className="flex items-center gap-1.5 text-[11px] text-txt-muted bg-app-surface/60 rounded-md px-2.5 py-1 font-mono border border-border-subtle/50">
                      <span className="font-semibold text-txt-secondary">Plats på disken:</span>
                      <span className="truncate">{draft.masterDirectory}</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-txt-primary">Masterfiler</span>
                        <span className="text-[11px] text-txt-muted">({draft.files.length})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleUploadFiles()}
                          className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"
                          title="Välj och ladda upp befintliga filer från datorn som masterfiler"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Ladda upp filer
                        </button>
                        <button
                          type="button"
                          onClick={addFile}
                          className="flex items-center gap-1 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1 text-xs text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          Lägg till tom fil
                        </button>
                      </div>
                    </div>

                    {draft.files.length === 0 ? (
                      <div
                        onClick={() => void handleUploadFiles()}
                        className="cursor-pointer flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border-subtle p-8 text-center hover:border-sky-500/40 hover:bg-app-surface/50 transition-colors"
                      >
                        <Upload className="h-8 w-8 text-sky-400/60 mb-2" />
                        <p className="text-xs font-medium text-txt-primary">Ladda upp eller dra &amp; släpp dotfiles hit</p>
                        <p className="text-[11px] text-txt-muted mt-1">
                          Filerna sparas som fysiska masterfiler och synkas ut till anslutna SSH-servrar.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {draft.files.map((file) => (
                          <div
                            key={file.id}
                            className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-app-surface p-3 transition-colors hover:border-border"
                          >
                            <div className="flex items-center justify-between text-[11px] text-txt-muted mb-0.5">
                              <span className="font-medium text-sky-400 flex items-center gap-1">
                                <FileCode className="h-3 w-3" />
                                Masterfil: {file.masterFileName || file.remotePath.replace(/^~?[/\\]/, '') || 'Namnlös'}
                              </span>
                              {file.updatedAt && <span>Senast sparad: {file.updatedAt}</span>}
                            </div>
                            <div className="grid grid-cols-[1fr_80px_auto] gap-2">
                              <input
                                value={file.remotePath}
                                onChange={(e) => updateFile(file.id, { remotePath: e.target.value })}
                                placeholder="Fjärrsökväg, t.ex. ~/.bashrc"
                                className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                              />
                              <input
                                value={file.mode ?? ''}
                                onChange={(e) => updateFile(file.id, { mode: e.target.value })}
                                placeholder="Mode (644)"
                                className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono text-center"
                                title="Filrättigheter (oktalt, t.ex. 644 eller 600)"
                              />
                              <button
                                type="button"
                                onClick={() => removeFile(file.id)}
                                className="rounded-lg p-1.5 text-red-400 hover:bg-app-surface-hover transition-colors"
                                title="Ta bort masterfil från poolen"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <textarea
                              value={file.content}
                              onChange={(e) => updateFile(file.id, { content: e.target.value })}
                              rows={5}
                              placeholder="Filinnehåll / konfiguration..."
                              className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono leading-relaxed resize-y"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border-subtle bg-app-surface px-5 py-3">
                  <button
                    type="button"
                    onClick={() => void handleDelete(draft.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-app-surface-hover transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Ta bort pool
                  </button>
                  <button
                    type="button"
                    disabled={!draft.name.trim() || saving}
                    onClick={() => void handleSave()}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 shadow-sm transition-colors"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Spara masterfiler
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
