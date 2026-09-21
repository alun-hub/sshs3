/**
 * Maps a physical key (KeyboardEvent.code) to the unshifted symbol it types on a standard
 * QWERTY layout. Used to recover the base symbol for a Shift-held combo: browsers report
 * KeyboardEvent.key as whatever character the *current keyboard layout* produces for that
 * physical key with Shift held (e.g. Shift+, -> '<' on a US layout, but '<' isn't universal —
 * on Swedish/Nordic ISO layouts the same physical key produces ';'). Comparing raw e.key values
 * against a hardcoded shortcut string is therefore layout-dependent and unreliable.
 */
const PHYSICAL_KEY_BASE_SYMBOLS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
};

export interface ShortcutKeyEventLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Builds the canonical "Ctrl+Shift+X" combo string for a keydown event. Shared by the shortcut
 * recorder (Settings) and the runtime shortcut matcher (App) so a shortcut recorded on a given
 * machine/layout always matches what pressing that same physical key produces at runtime there —
 * even if KeyboardEvent.code turns out to be unreliable for a particular layout/platform, since
 * both sides fall back to the same raw e.key in that case and stay consistent with each other.
 * Returns null for a lone modifier keypress (nothing to bind yet).
 */
export function comboFromKeyboardEvent(e: ShortcutKeyEventLike): string | null {
  if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift') {
    return null;
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (e.shiftKey && e.code && PHYSICAL_KEY_BASE_SYMBOLS[e.code]) {
    key = PHYSICAL_KEY_BASE_SYMBOLS[e.code];
  }
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);

  return parts.join('+');
}
