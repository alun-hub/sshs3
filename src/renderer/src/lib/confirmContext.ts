import { createContext, useCallback, useContext } from 'react';
import type React from 'react';
import type { ConfirmOptions } from '../components/ConfirmDialog';

/** Set by `ConfirmProvider`; null outside it. */
export const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * In-app replacement for window.alert(): shows the message in the app's own dialog with a single OK button.
 * Outside a ConfirmProvider (isolated component tests) it falls back to the native alert.
 */
export function useNotice(): (message: React.ReactNode, title?: string) => Promise<void> {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    async (message, title) => {
      if (!ctx) {
        window.alert(typeof message === 'string' ? message : '');
        return;
      }
      await ctx({ title, message, notice: true, danger: false, confirmLabel: 'OK' });
    },
    [ctx]
  );
}
