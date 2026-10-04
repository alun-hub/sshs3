import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { classNames } from '../../lib/format';

export interface ProfileRowMenuItem {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  /** Draws a divider above this item (used to set destructive actions apart). */
  separated?: boolean;
}

interface ProfileRowMenuProps {
  items: ProfileRowMenuItem[];
  label?: string;
}

const MENU_WIDTH = 190;
const ITEM_HEIGHT = 30;

/**
 * Overflow ("...") menu for secondary row actions. Rendered with fixed positioning so it is not
 * clipped by the scrolling modal body, and flips upward when there is no room below the button.
 */
export const ProfileRowMenu: React.FC<ProfileRowMenuProps> = ({ items, label = 'More actions' }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const open = pos !== null;

  const close = useCallback(() => setPos(null), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close only the menu, not the surrounding modal.
      e.stopPropagation();
      e.preventDefault();
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = items.length * ITEM_HEIGHT + 12;
    const openUp = rect.bottom + height > window.innerHeight - 8;
    setPos({
      top: openUp ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onDoubleClick={(e) => e.stopPropagation()}
        className={classNames(
          'rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors',
          open && 'bg-app-surface-hover text-txt-primary'
        )}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-[60] rounded-lg border border-border-strong bg-app-card p-1 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <React.Fragment key={item.label}>
              {item.separated && <div className="my-1 h-px bg-border-subtle" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={classNames(
                  'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                  item.danger
                    ? 'text-red-400 hover:bg-red-500/15'
                    : 'text-txt-primary hover:bg-app-surface-hover'
                )}
              >
                <span className="shrink-0">{item.icon}</span>
                {item.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  );
};

export default ProfileRowMenu;
