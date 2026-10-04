import { useEffect, useRef, useState } from 'react';

/**
 * Modals that are currently open, ordered by when they were opened. Escape goes to the topmost one
 * only, so a dialog launched from another dialog (tunnels from the connection manager, a PIN prompt
 * over a file dialog, ...) closes by itself instead of taking its parent down with it.
 *
 * A modal stays on the stack for as long as it is `active` (open). A temporary guard such as "a save is
 * in flight" is expressed with `enabled` instead: the modal keeps its place, and Escape is swallowed
 * rather than falling through to the modal underneath.
 */
interface StackEntry {
  id: symbol;
  seq: number;
}
const modalStack: StackEntry[] = [];
let openCounter = 0;

/**
 * Calls `onEscape` when Escape is pressed while this modal is the topmost open one and `enabled`.
 * The listener is window-wide, so it fires regardless of where focus is (e.g. a terminal's hidden
 * textarea), and always sees the latest `onEscape`.
 *
 * Ranking: a modal that is already open when it mounts takes its rank from mount order. Render order is
 * parent-before-child, so a child that mounts in the same commit as its parent still ends up above it,
 * although its effects run first. A modal that opens later, or re-opens, takes the next rank when it
 * becomes active and so sits above everything opened in the meantime. The rank survives React's
 * StrictMode double-invoked effects, because it is only forgotten when the modal actually closes.
 */
export function useEscapeToClose(onEscape: () => void, active: boolean, enabled = true): void {
  const callbackRef = useRef(onEscape);
  callbackRef.current = onEscape;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [mountRank] = useState(() => ++openCounter);
  const mountedActive = useRef(active);
  const usedMountRank = useRef(false);
  const rankRef = useRef<number | null>(null);

  // Forget the rank when the modal closes, so the next opening is ranked afresh.
  useEffect(() => {
    if (!active) rankRef.current = null;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    if (rankRef.current === null) {
      rankRef.current = mountedActive.current && !usedMountRank.current ? mountRank : ++openCounter;
      usedMountRank.current = true;
    }
    const seq = rankRef.current;
    const entry: StackEntry = { id: Symbol('modal'), seq };
    let at = modalStack.length;
    while (at > 0 && modalStack[at - 1].seq > seq) at--;
    modalStack.splice(at, 0, entry);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== entry) return;
      if (!enabledRef.current) return;
      e.preventDefault();
      callbackRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const idx = modalStack.indexOf(entry);
      if (idx !== -1) modalStack.splice(idx, 1);
    };
  }, [active, mountRank]);
}

/**
 * Standardizes an overlay modal's dismiss behavior: Escape (topmost modal only, see
 * `useEscapeToClose`) and a click on the backdrop itself (not bubbled up from its content) both call
 * `onClose`.
 *
 * `active` is the modal's own visibility flag. `enabled` suppresses dismissal temporarily without
 * leaving the stack, e.g. `enabled = !saving` while a save is in flight.
 *
 * Returns a click handler to attach to the outer backdrop `<div>`'s `onClick`.
 */
export function useModalDismiss(
  onClose: () => void,
  active: boolean,
  enabled = true
): (e: React.MouseEvent<HTMLElement>) => void {
  useEscapeToClose(onClose, active, enabled);

  return (e: React.MouseEvent<HTMLElement>) => {
    if (active && enabled && e.target === e.currentTarget) {
      onClose();
    }
  };
}
