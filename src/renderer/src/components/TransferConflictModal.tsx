import React, { useEffect, useState } from 'react';
import { Copy, FileWarning, SkipForward } from 'lucide-react';
import type { TransferConflictPromptEvent, TransferConflictResolution } from '@shared/types/ipc';

export const TransferConflictModal: React.FC = () => {
  const [prompts, setPrompts] = useState<TransferConflictPromptEvent[]>([]);
  const [applyToAll, setApplyToAll] = useState(false);

  const currentPrompt = prompts[0] || null;

  useEffect(() => {
    if (!window.multissh?.onTransferConflictPrompt) return;

    const unsubscribe = window.multissh.onTransferConflictPrompt((event) => {
      setPrompts((prev) => [...prev, event]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    setApplyToAll(false);
  }, [currentPrompt?.id]);

  const respond = async (resolution: TransferConflictResolution) => {
    if (!currentPrompt) return;
    const promptId = currentPrompt.id;
    const applied = applyToAll;

    setPrompts((prev) => prev.slice(1));

    if (window.multissh?.respondTransferConflict) {
      try {
        await window.multissh.respondTransferConflict(promptId, resolution, applied);
      } catch (err) {
        console.error('Failed to respond to transfer conflict prompt:', err);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void respond('skip');
    }
  };

  if (!currentPrompt) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-conflict-modal-title"
      data-testid="transfer-conflict-modal"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
            <FileWarning className="h-5 w-5" />
          </div>
          <div>
            <h2 id="transfer-conflict-modal-title" className="text-base font-semibold text-white">
              Filen finns redan
            </h2>
            <p className="break-all text-xs text-slate-400">{currentPrompt.targetPath}</p>
          </div>
        </div>

        <div className="mt-4 text-sm text-slate-300">
          <p>
            {currentPrompt.isDirectory ? 'Mappen' : 'Filen'}{' '}
            <span className="font-medium text-slate-100">{currentPrompt.fileName}</span> finns
            redan på målet. Vad vill du göra?
          </p>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
            data-testid="transfer-conflict-apply-all"
            className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
          />
          Använd för alla återstående filer i den här överföringen
        </label>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => respond('skip')}
            data-testid="transfer-conflict-skip"
            className="flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 focus:outline-none transition-colors"
          >
            <SkipForward className="h-3.5 w-3.5" />
            Hoppa över
          </button>
          <button
            type="button"
            onClick={() => respond('rename')}
            data-testid="transfer-conflict-rename"
            className="flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 focus:outline-none transition-colors"
          >
            <Copy className="h-3.5 w-3.5" />
            Byt namn
          </button>
          <button
            type="button"
            onClick={() => respond('overwrite')}
            data-testid="transfer-conflict-overwrite"
            className="rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white hover:bg-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-800 transition-colors"
          >
            Skriv över
          </button>
        </div>
      </div>
    </div>
  );
};
