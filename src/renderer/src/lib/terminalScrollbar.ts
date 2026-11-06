/**
 * Scrollbar look for xterm terminals (xterm 6 draws its own scrollbar, so the app's
 * `::-webkit-scrollbar` CSS no longer reaches it).
 *
 * The slider colours mirror the app's `--border-strong` (resting) and `--text-muted` (hover/drag)
 * for each theme, which is what the scrollbar used before xterm 6. Rounded corners live in
 * `index.css` (`.xterm-scrollable-element > .scrollbar > .slider`), as xterm has no option for them.
 */

/** Scrollbar width in px, the same 6 px as the rest of the app. xterm's default is 14 px. */
export const TERMINAL_SCROLLBAR_WIDTH = 6;

/** Passed as the `overviewRuler` option of `new Terminal(...)`; its `width` sets the scrollbar width. */
export const TERMINAL_SCROLLBAR_OPTIONS = { width: TERMINAL_SCROLLBAR_WIDTH };

export const SCROLLBAR_THEME_DARK = {
  scrollbarSliderBackground: '#2e3c59',
  scrollbarSliderHoverBackground: '#99a6bb',
  scrollbarSliderActiveBackground: '#99a6bb',
};

export const SCROLLBAR_THEME_LIGHT = {
  scrollbarSliderBackground: '#64748b',
  scrollbarSliderHoverBackground: '#475569',
  scrollbarSliderActiveBackground: '#475569',
};

export const SCROLLBAR_THEME_BREEZE = {
  scrollbarSliderBackground: '#8a9397',
  scrollbarSliderHoverBackground: '#b2bbbc',
  scrollbarSliderActiveBackground: '#b2bbbc',
};
