import React, { useState } from 'react';
import { parseNumberDraft, settleNumberDraft } from '../../lib/numberField';

interface ClampedNumberInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

/**
 * A whole-number field that can be typed into. It keeps the text being typed apart from the stored value: a
 * number in [min, max] is passed on as soon as it is complete, so "16" works although "1" alone is below `min`,
 * and when the field is left the text settles on the nearest allowed number (or goes back to the stored value if
 * it was empty). A value outside the range is never passed on.
 */
export const ClampedNumberInput: React.FC<ClampedNumberInputProps> = ({
  value,
  min,
  max,
  step,
  onChange,
  id,
  'aria-label': ariaLabel,
  className,
}) => {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      id={id}
      aria-label={ariaLabel}
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const next = parseNumberDraft(e.target.value, min, max);
        if (next !== null) onChange(next);
      }}
      onBlur={() => {
        if (draft === null) return;
        const settled = settleNumberDraft(draft, min, max);
        if (settled !== null) onChange(settled);
        setDraft(null);
      }}
      className={className}
    />
  );
};
