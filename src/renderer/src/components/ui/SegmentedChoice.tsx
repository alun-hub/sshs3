import React, { useId } from 'react';
import { Check } from 'lucide-react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Dialog initial focus lands on the selected choice (see `useDialogFocus`). */
  autoFocus?: boolean;
  testId?: string;
}

/**
 * A small "pick one" control drawn as buttons. Native radio inputs underneath, so the group is one Tab stop and
 * the arrow keys move and select (the same pattern as the theme picker in Settings). The selected choice shows a
 * check mark besides its colour, so the state does not rely on colour alone.
 */
export function SegmentedChoice<T extends string>({ label, options, value, onChange, autoFocus, testId }: Props<T>): React.ReactElement {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={`flex min-h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-sky-500 has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-app-surface ${
              on ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              onChange={() => onChange(o.value)}
              data-autofocus={autoFocus && on ? '' : undefined}
              className="sr-only"
            />
            {on && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
