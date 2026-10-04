import { useEffect, useRef } from 'react';

/**
 * Stack of currently active modals (oldest first). Escape is delivered to the topmost one only, so a
 * dialog opened from another dialog (tunnels from the connection manager, a PIN prompt over a file
 * dialog, ...) closes by itself instead of taking its parent down with it.
 */
const modalStack: symbol[] = [];

/**
 * Calls `onEscape` when Escape is pressed while this modal is the topmost active one. The listener is
 * window-wide, so it fires regardless of where focus currently is (e.g. a terminal's hidden textarea),
 * and always sees the latest `onEscape`.
 */
export function useEscapeToClose(onEscape: () => void, active: boolean): void {
  const callbackRef = useRef(onEscape);
  callbackRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const id = Symbol('modal');
    modalStack.push(id);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== id) return;
      e.preventDefault();
      callbackRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const idx = modalStack.indexOf(id);
      if (idx !== -1) modalStack.splice(idx, 1);
    };
  }, [active]);
}

/**
 * Standardizes an overlay modal's dismiss behavior: Escape (topmost modal only, see
 * `useEscapeToClose`) and a click on the backdrop itself (not bubbled up from its content) both call
 * `onClose`.
 *
 * Pass `active` as the modal's own visibility flag, optionally combined with an in-flight-save guard
 * (e.g. `open && !saving`) to suppress dismissal while a save is in progress.
 *
 * Returns a click handler to attach to the outer backdrop `<div>`'s `onClick`.
 */
export function useModalDismiss(
  onClose: () => void,
  active: boolean
): (e: React.MouseEvent<HTMLElement>) => void {
  useEscapeToClose(onClose, active);

  return (e: React.MouseEvent<HTMLElement>) => {
    if (active && e.target === e.currentTarget) {
      onClose();
    }
  };
}
