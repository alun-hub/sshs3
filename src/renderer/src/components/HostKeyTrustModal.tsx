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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm animate-in fade-in duration-150 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-app-card p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div
            className={
              'flex h-10 w-10 items-center justify-center rounded-xl ' +
              (isMismatch ? 'bg-red-500/20 text-red-400' : 'bg-sky-500/20 text-sky-400')
            }
          >
            {isMismatch ? <ShieldAlert className="h-5 w-5" /> : <ShieldQuestion className="h-5 w-5" />}
          </div>
          <div>
            <h2 id="hostkey-modal-title" className="text-base font-semibold text-txt-primary">
              {isMismatch ? 'Host Key Changed!' : 'Unknown Host'}
            </h2>
            <p className="text-xs text-txt-muted">
              {currentPrompt.host}
              {currentPrompt.port !== 22 ? `:${currentPrompt.port}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-xs text-txt-secondary">
          {isMismatch ? (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-red-300 leading-relaxed">
              WARNING: The host key for this server differs from the key stored previously. This could mean
              the server was reinstalled or reconfigured, but could also indicate a man-in-the-middle attack.
              Only continue if you are confident this change is legitimate.
            </p>
          ) : (
            <p className="text-txt-secondary leading-relaxed">
              This server could not be verified against known hosts. Verify the fingerprint below with the server
              administrator before trusting it.
            </p>
          )}

          <div className="rounded-lg border border-border-subtle bg-app-input px-3 py-2 font-mono text-xs text-txt-primary">
            <div>Key Type: {currentPrompt.keyType}</div>
            <div className="break-all mt-1">Fingerprint: {currentPrompt.fingerprint}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => respond(false)}
            data-testid="hostkey-trust-cancel"
            className="rounded-lg border border-border-subtle px-4 py-2 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => respond(true)}
            data-testid="hostkey-trust-accept"
            className={
              'rounded-lg px-4 py-2 text-xs font-medium text-white shadow-sm transition-colors ' +
              (isMismatch
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-sky-600 hover:bg-sky-500')
            }
          >
            {isMismatch ? 'Trust Anyway' : 'Trust Host'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HostKeyTrustModal;
