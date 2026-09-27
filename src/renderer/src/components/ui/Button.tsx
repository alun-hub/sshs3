import React from 'react';
import { classNames } from '../../lib/format';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-500 shadow-sm disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-500 shadow-sm disabled:opacity-50',
  secondary:
    'border border-border-subtle text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-50',
  ghost: 'text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary disabled:opacity-40',
};

/**
 * Shared button primitive (UX review #2/#6). Every modal used to hand-roll
 * this same Tailwind string (with small, accidental variations in padding
 * and disabled opacity) — centralizing it means a global tweak like the
 * focus ring only needs to happen once. Migrate call sites incrementally;
 * see the UX review report for suggested starting points.
 */
export const Button: React.FC<ButtonProps> = ({ variant = 'secondary', className, type, children, ...rest }) => (
  <button
    type={type ?? 'button'}
    className={classNames(
      'flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors',
      VARIANT_CLASSES[variant],
      className
    )}
    {...rest}
  >
    {children}
  </button>
);

export default Button;
