const MARGIN = 16;

/**
 * Top-left corner for a card opened at (x, y): right of and below the pointer when it fits, otherwise
 * flipped to the left / above, and finally clamped so the whole card stays inside the viewport.
 */
export function placeHoverCard(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}): { left: number; top: number } {
  const { x, y, width, height, viewportWidth, viewportHeight } = opts;

  let left = x + 12;
  if (left + width > viewportWidth - MARGIN) left = x - width - 12;
  left = Math.max(MARGIN, Math.min(left, viewportWidth - MARGIN - width));

  let top = y + MARGIN;
  if (top + height > viewportHeight - MARGIN) top = y - height - MARGIN;
  top = Math.max(MARGIN, Math.min(top, viewportHeight - MARGIN - height));

  return { left, top };
}
