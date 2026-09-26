import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';

interface PresencePromptItem {
  id: string;
  sessionId?: string;
  message: string;
}

/**
 * Non-blocking banner shown while a smartcard/FIDO2 operation is waiting for
 * a physical touch on the key. Unlike SmartcardPinModal this never expects a
 * reply — OpenSSH isn't asking us for input here, it's just stuck until the
 * user touches the device — so the banner is purely informational and never
 * captures focus or blocks interaction with the rest of the app.
 */
export const TouchPresenceBanner: React.FC = () => {
  const [prompts, setPrompts] = useState<PresencePromptItem[]>([]);

  useEffect(() => {
    if (!window.multissh?.onPresencePrompt || !window.multissh?.onPresenceClear) return;

    const unsubscribePrompt = window.multissh.onPresencePrompt((event) => {
      setPrompts((prev) => (prev.some((p) => p.id === event.id) ? prev : [...prev, event]));
      setTimeout(() => {
        setPrompts((prev) => prev.filter((p) => p.id !== event.id));
      }, 4000);
    });
    const unsubscribeClear = window.multissh.onPresenceClear(({ id, sessionId }) => {
      setPrompts((prev) =>
        prev.filter((p) => {
          if (id && p.id === id) return false;
          if (sessionId && p.sessionId === sessionId) return false;
          return true;
        })
      );
    });

    return () => {
      unsubscribePrompt();
      unsubscribeClear();
    };
  }, []);

  if (prompts.length === 0) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="touch-presence-banner"
      className="fixed bottom-6 left-1/2 z-[110] flex -translate-x-1/2 flex-col gap-2"
    >
      {prompts.map((prompt) => (
        <div
          key={prompt.id}
          className="flex items-center gap-3 rounded-xl border border-sky-500/60 bg-app-card px-5 py-3 shadow-2xl ring-4 ring-sky-500/20 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <KeyRound className="h-6 w-6 shrink-0 animate-pulse text-sky-400" />
          <p className="text-base font-medium text-txt-primary">{prompt.message}</p>
        </div>
      ))}
    </div>
  );
};

export default TouchPresenceBanner;
