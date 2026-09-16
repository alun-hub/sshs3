import React, { useEffect, useRef, useState } from 'react';
import { classNames } from '../../lib/format';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y, visible: false });

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('contextmenu', handlePointerDown, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('contextmenu', handlePointerDown, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(4, clampedX), y: Math.max(4, clampedY), visible: true });
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', top: pos.y, left: pos.x, visibility: pos.visible ? 'visible' : 'hidden' }}
      className="z-50 min-w-[190px] rounded-md border border-slate-700 bg-slate-800 py-1 text-sm shadow-2xl"
    >
      {items.map((item) => (
        <React.Fragment key={item.key}>
          {item.separatorBefore && <div className="my-1 border-t border-slate-700" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onSelect?.();
              onClose();
            }}
            className={classNames(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs',
              item.disabled
                ? 'cursor-not-allowed text-slate-500'
                : item.danger
                  ? 'text-red-400 hover:bg-red-950/60'
                  : 'text-slate-200 hover:bg-sky-900/50'
            )}
          >
            {item.icon && <item.icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{item.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default ContextMenu;
