import React from 'react';
import { classNames } from '../../lib/format';

export interface KbdProps {
  children: React.ReactNode;
  /** 'boxed' (default) draws a small bordered key cap; 'plain' is bare inline text. */
  variant?: 'boxed' | 'plain';
  className?: string;
}

/**
 * Shared keyboard-shortcut label (UX review #6/#2). Previously every call
 * site hand-rolled the same `border border-border-subtle bg-app-surface ...`
 * string; centralizing it means a future tweak (size, contrast) happens once.
 */
export const Kbd: React.FC<KbdProps> = ({ children, variant = 'boxed', className }) => (
  <kbd
    className={classNames(
      'font-mono text-2xs',
      variant === 'boxed'
        ? 'rounded border border-border-subtle bg-app-surface px-1.5 py-0.5 text-txt-muted'
        : 'text-txt-secondary',
      className
    )}
  >
    {children}
  </kbd>
);

export default Kbd;
