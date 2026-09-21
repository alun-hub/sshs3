import { describe, it, expect } from 'vitest';
import { comboFromKeyboardEvent } from '../../src/renderer/src/lib/shortcuts';

describe('comboFromKeyboardEvent', () => {
  it('builds a combo string from modifiers and an uppercased letter', () => {
    expect(comboFromKeyboardEvent({ key: 'n', code: 'KeyN', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(
      'Ctrl+Shift+N'
    );
  });

  it('returns null for a lone modifier keypress', () => {
    expect(comboFromKeyboardEvent({ key: 'Shift', code: 'ShiftLeft', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true })).toBeNull();
  });

  it('normalizes Shift+<punctuation key> via e.code so the same physical key resolves identically across keyboard layouts', () => {
    // US layout: Shift+comma-key -> e.key '<'. Swedish/Nordic ISO layout: same physical key -> e.key ';'.
    // Both must resolve to the same canonical combo, since e.code identifies the physical key, not the layout-dependent character.
    const usLayout = comboFromKeyboardEvent({ key: '<', code: 'Comma', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true });
    const swedishLayout = comboFromKeyboardEvent({ key: ';', code: 'Comma', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true });

    expect(usLayout).toBe('Ctrl+Shift+,');
    expect(swedishLayout).toBe('Ctrl+Shift+,');
  });

  it('falls back to the raw e.key when e.code is missing or unrecognized, so recorder and matcher stay consistent with each other even then', () => {
    const withoutCode = comboFromKeyboardEvent({ key: ';', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true });
    expect(withoutCode).toBe('Ctrl+Shift+;');
  });
});
