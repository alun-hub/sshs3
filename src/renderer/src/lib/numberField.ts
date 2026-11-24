/**
 * Helpers for a number field the user types into. While they type, the field holds text that is not yet a value
 * ("1" on the way to "16"), so a field that only accepts a finished, in-range number cannot be typed into.
 * Both helpers work on non-negative whole numbers. With a `step`, the allowed numbers are min, min + step,
 * min + 2 * step and so on, like a number input's own validation.
 */

const WHOLE_NUMBER = /^\d+$/;

const stepOrOne = (step: number): number => (Number.isFinite(step) && step > 0 ? step : 1);

/**
 * The number a draft stands for if it is allowed: a whole number in [min, max] that is min plus a whole
 * number of steps. Null while it is not (empty, partial, out of range, off the step).
 */
export function parseNumberDraft(draft: string, min: number, max: number, step = 1): number | null {
  const text = draft.trim();
  if (!WHOLE_NUMBER.test(text)) return null;
  const value = Number(text);
  if (value < min || value > max) return null;
  return (value - min) % stepOrOne(step) === 0 ? value : null;
}

/**
 * What a draft becomes when the user leaves the field: the nearest allowed number (half-way goes up), or null to
 * go back to the stored value.
 */
export function settleNumberDraft(draft: string, min: number, max: number, step = 1): number | null {
  const text = draft.trim();
  if (!WHOLE_NUMBER.test(text)) return null;
  const s = stepOrOne(step);
  const clamped = Math.min(max, Math.max(min, Number(text)));
  const snapped = min + Math.round((clamped - min) / s) * s;
  // Rounding up can pass `max` when max is not itself a step; the last allowed number is then the one below it.
  return snapped <= max ? snapped : min + Math.floor((max - min) / s) * s;
}
