import { describe, expect, it } from 'vitest';
import { printableInput } from './terminalInput';

describe('printableInput', () => {
  it('keeps typed and pasted text', () => {
    expect(printableInput('ls -la /tmp')).toBe('ls -la /tmp');
  });

  it('drops the markers around a bracketed paste', () => {
    expect(printableInput('\x1b[200~cat /etc/hosts\x1b[201~')).toBe('cat /etc/hosts');
  });

  it('drops cursor-key sequences instead of leaving their tail behind', () => {
    expect(printableInput('\x1b[A')).toBe('');
    expect(printableInput('\x1b[1;5C')).toBe('');
    expect(printableInput('\x1bOH')).toBe('');
  });

  it('drops other control characters', () => {
    expect(printableInput('a\tb\x01c')).toBe('abc');
  });
});
