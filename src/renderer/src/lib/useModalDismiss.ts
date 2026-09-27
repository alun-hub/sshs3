import { useEffect } from 'react';

/**
 * Standardizes an overlay modal's dismiss behavior (M12, code review):
 * Escape (window-wide, so it fires regardless of where focus currently is —
 * same reasoning as the M11 fix for HostKeyTrustModal/TransferConflictModal/
 * AwsSsoLoginModal/SmartcardPinModal) and a click on the backdrop itself
 * (not bubbled up from its content) both call `onClose`.
 *
 * Pass `active` as the modal's own visibility flag, optionally combined with
 * an in-flight-save guard (e.g. `open && !saving`) to suppress dismissal
 * while a save is in progress, matching the existing NewFolderModal pattern.
 *
 * Returns a click handler to attach to the outer backdrop `<div>`'s
 * `onClick`.
 */
export function useModalDismiss(
  onClose: () => void,
  active: boolean
): (e: React.MouseEvent<HTMLElement>) => void {
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (e: React.MouseEvent<HTMLElement>) => {
    if (active && e.target === e.currentTarget) {
      onClose();
    }
  };
}
