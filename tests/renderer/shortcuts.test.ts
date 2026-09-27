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

  it('normalizes Tab and Linux ISO_Left_Tab to Tab for Ctrl+Tab and Ctrl+Shift+Tab', () => {
    expect(comboFromKeyboardEvent({ key: 'Tab', code: 'Tab', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl+Tab'
    );
    expect(comboFromKeyboardEvent({ key: 'Tab', code: 'Tab', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(
      'Ctrl+Shift+Tab'
    );
    // Linux X11/Wayland reports Shift+Tab as key 'ISO_Left_Tab'
    expect(comboFromKeyboardEvent({ key: 'ISO_Left_Tab', code: 'Tab', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(
      'Ctrl+Shift+Tab'
    );
  });

  it('builds combo strings for font size shortcuts across keyboard layouts and numpad', () => {
    // Swedish layout: '+' is unshifted next to 0 (physical code Minus)
    expect(comboFromKeyboardEvent({ key: '+', code: 'Minus', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl++'
    );
    // Swedish layout: '-' is unshifted next to Right Shift (physical code Slash)
    expect(comboFromKeyboardEvent({ key: '-', code: 'Slash', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl+-'
    );
    // US layout: '-' is unshifted next to 0 (physical code Minus)
    expect(comboFromKeyboardEvent({ key: '-', code: 'Minus', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl+-'
    );
    // US layout: '=' unshifted
    expect(comboFromKeyboardEvent({ key: '=', code: 'Equal', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl+='
    );
    // US layout: Shift+'=' produces '+'
    expect(comboFromKeyboardEvent({ key: '+', code: 'Equal', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe(
      'Ctrl+Shift+='
    );
    // Numpad '+' and '-'
    expect(comboFromKeyboardEvent({ key: '+', code: 'NumpadAdd', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl++'
    );
    expect(comboFromKeyboardEvent({ key: '-', code: 'NumpadSubtract', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl+-'
    );
    // Reset combo '0'
    expect(comboFromKeyboardEvent({ key: '0', code: 'Digit0', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(
      'Ctrl+0'
    );
  });
});
