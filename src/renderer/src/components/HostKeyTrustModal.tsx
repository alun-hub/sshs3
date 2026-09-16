import React, { useEffect, useState } from 'react';
import { ShieldAlert, ShieldQuestion } from 'lucide-react';
import type { HostKeyPromptEvent } from '@shared/types/ipc';

export const HostKeyTrustModal: React.FC = () => {
  const [prompts, setPrompts] = useState<HostKeyPromptEvent[]>([]);

  const currentPrompt = prompts[0] || null;

  useEffect(() => {
    if (!window.multissh?.onHostKeyPrompt) return;

    const unsubscribe = window.multissh.onHostKeyPrompt((event) => {
      setPrompts((prev) => [...prev, event]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const respond = async (trust: boolean) => {
    if (!currentPrompt) return;
    const promptId = currentPrompt.id;

    setPrompts((prev) => prev.slice(1));

    if (window.multissh?.respondHostKeyPrompt) {
      try {
        await window.multissh.respondHostKeyPrompt(promptId, trust);
      } catch (err) {
        console.error('Failed to respond to host key prompt:', err);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void respond(false);
    }
  };

  if (!currentPrompt) {
    return null;
  }

  const isMismatch = currentPrompt.status === 'mismatch';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hostkey-modal-title"
      data-testid="hostkey-trust-modal"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div
            className={
              'flex h-10 w-10 items-center justify-center rounded-full ' +
              (isMismatch ? 'bg-red-500/20 text-red-400' : 'bg-sky-500/20 text-sky-400')
            }
          >
            {isMismatch ? <ShieldAlert className="h-5 w-5" /> : <ShieldQuestion className="h-5 w-5" />}
          </div>
          <div>
            <h2 id="hostkey-modal-title" className="text-base font-semibold text-white">
              {isMismatch ? 'Värdnyckeln har ändrats!' : 'Okänd värd'}
            </h2>
            <p className="text-xs text-slate-400">
              {currentPrompt.host}
              {currentPrompt.port !== 22 ? `:${currentPrompt.port}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          {isMismatch ? (
            <p className="rounded border border-red-900 bg-red-950/50 px-3 py-2 text-red-300">
              VARNING: värdens SSH-nyckel skiljer sig från den som tidigare sparades för den
              här servern. Det kan betyda att servern har ombildats, men kan även vara ett
              tecken på ett man-in-the-middle-angrepp. Fortsätt bara om du är säker på att
              nyckeln verkligen har ändrats legitimt.
            </p>
          ) : (
            <p className="text-slate-300">
              Den här servern går inte att verifiera mot kända värdar. Kontrollera
              fingeravtrycket nedan mot vad servens administratör angett innan du litar på den.
            </p>
          )}

          <div className="rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200">
            <div>Nyckeltyp: {currentPrompt.keyType}</div>
            <div className="break-all">Fingeravtryck: {currentPrompt.fingerprint}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => respond(false)}
            data-testid="hostkey-trust-cancel"
            className="rounded-md border border-slate-600 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 focus:outline-none transition-colors"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => respond(true)}
            data-testid="hostkey-trust-accept"
            className={
              'rounded-md px-4 py-2 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 transition-colors ' +
              (isMismatch
                ? 'bg-red-600 hover:bg-red-500 focus:ring-red-400'
                : 'bg-sky-500 hover:bg-sky-400 focus:ring-sky-400')
            }
          >
            {isMismatch ? 'Lita på ändå' : 'Lita på värden'}
          </button>
        </div>
      </div>
    </div>
  );
};
