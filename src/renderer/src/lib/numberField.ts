/**
 * Helpers for a number field the user types into. While they type, the field holds text that is not yet a value
 * ("1" on the way to "16"), so a field that only accepts a finished, in-range number cannot be typed into.
 * Both helpers work on non-negative whole numbers.
 */

const WHOLE_NUMBER = /^\d+$/;

/** The number a draft stands for if it is a whole number in [min, max]; null while it is not (empty, partial, out of range). */
export function parseNumberDraft(draft: string, min: number, max: number): number | null {
  const text = draft.trim();
  if (!WHOLE_NUMBER.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

/** What a draft becomes when the user leaves the field: the nearest allowed number, or null to go back to the stored value. */
export function settleNumberDraft(draft: string, min: number, max: number): number | null {
  const text = draft.trim();
  if (!WHOLE_NUMBER.test(text)) return null;
  return Math.min(max, Math.max(min, Number(text)));
}
