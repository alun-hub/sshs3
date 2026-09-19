import React, { useState, useEffect, useRef } from 'react';
import { KeyRound } from 'lucide-react';

export interface AskpassPromptItem {
  id: string;
  prompt: string;
  sessionId?: string;
}

export const SmartcardPinModal: React.FC = () => {
  const [prompts, setPrompts] = useState<AskpassPromptItem[]>([]);
  const [pin, setPin] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const currentPrompt = prompts[0] || null;

  useEffect(() => {
    if (!window.multissh?.onAskpassPrompt) return;

    const unsubscribe = window.multissh.onAskpassPrompt((event) => {
      setPrompts((prev) => [...prev, event]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (currentPrompt) {
      setPin('');
      // Autofocus input
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [currentPrompt]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentPrompt) return;

    const submittedPin = pin;
    const promptId = currentPrompt.id;

    // Pop the handled prompt
    setPrompts((prev) => prev.slice(1));
    setPin('');

    if (window.multissh?.submitAskpassPin) {
      try {
        await window.multissh.submitAskpassPin(promptId, submittedPin);
      } catch (err) {
        console.error('Failed to submit askpass PIN:', err);
      }
    }
  };

  const handleCancel = async () => {
    if (!currentPrompt) return;

    const promptId = currentPrompt.id;

    // Pop the handled prompt
    setPrompts((prev) => prev.slice(1));
    setPin('');

    if (window.multissh?.submitAskpassPin) {
      try {
        await window.multissh.submitAskpassPin(promptId, '');
      } catch (err) {
        console.error('Failed to cancel askpass PIN:', err);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!currentPrompt) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smartcard-modal-title"
      data-testid="smartcard-pin-modal"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm animate-in fade-in duration-150 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-app-card p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 id="smartcard-modal-title" className="text-base font-semibold text-txt-primary">
              Security Authentication
            </h2>
            <p className="text-xs text-txt-muted">Smartcard / SSH PIN Prompt</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-txt-primary break-words">
            {currentPrompt.prompt}
          </p>

          <form onSubmit={handleSubmit} className="mt-4">
            <div className="relative">
              <input
                ref={inputRef}
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN / password..."
                data-testid="smartcard-pin-input"
                autoComplete="off"
                className="w-full rounded-lg border border-border-subtle bg-app-input px-3.5 py-2 text-sm text-txt-primary placeholder-txt-muted focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleCancel}
                data-testid="smartcard-pin-cancel"
                className="rounded-lg border border-border-subtle px-4 py-2 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="smartcard-pin-submit"
                className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SmartcardPinModal;
