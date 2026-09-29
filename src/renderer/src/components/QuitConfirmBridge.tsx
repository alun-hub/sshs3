import { useEffect } from 'react';
import type { QuitConfirmPromptEvent } from '@shared/types/ipc';
import { useConfirm } from './ConfirmDialog';

/**
 * UX audit finding #2: quitting used to pop a native `dialog.showMessageBoxSync`
 * box — the one confirmation in the app that didn't look or behave like the
 * rest (no default-focused Cancel, no themed styling). The main process now
 * asks over IPC instead of showing that box itself; this component is the
 * renderer side of that request, rendering the same `ConfirmDialog` used for
 * every other confirmation (delete a profile, delete a folder, ...).
 */
export const QuitConfirmBridge: React.FC = () => {
  const confirm = useConfirm();

  useEffect(() => {
    if (!window.multissh?.onQuitConfirmPrompt) return;

    const unsubscribe = window.multissh.onQuitConfirmPrompt((event: QuitConfirmPromptEvent) => {
      void (async () => {
        const proceed =
          event.kind === 'active-transfers'
            ? await confirm({
                title: 'Transfers in progress',
                message: `There ${event.activeTransferCount === 1 ? 'is' : 'are'} ${event.activeTransferCount ?? 0} file transfer(s) in progress. If you quit now, they'll be cancelled and files may be left incomplete.`,
                confirmLabel: 'Quit Anyway',
                cancelLabel: 'Cancel',
                danger: true,
              })
            : await confirm({
                title: 'Quit sshs3?',
                message: 'Any open SSH sessions and tunnels will be closed.',
                confirmLabel: 'Quit',
                cancelLabel: 'Cancel',
                danger: false,
              });
        await window.multissh.respondQuitConfirm(event.id, proceed);
      })();
    });

    return () => {
      unsubscribe();
    };
  }, [confirm]);

  return null;
};
