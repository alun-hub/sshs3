import { describe, expect, it } from 'vitest';
import { nextMenuIndex } from './menuNavigation';

describe('nextMenuIndex', () => {
  it('steps down and wraps at the end', () => {
    expect(nextMenuIndex(3, 0, 'ArrowDown')).toBe(1);
    expect(nextMenuIndex(3, 2, 'ArrowDown')).toBe(0);
  });

  it('steps up and wraps at the start', () => {
    expect(nextMenuIndex(3, 2, 'ArrowUp')).toBe(1);
    expect(nextMenuIndex(3, 0, 'ArrowUp')).toBe(2);
  });

  it('starts at the first item going down and the last going up when nothing is focused', () => {
    expect(nextMenuIndex(3, -1, 'ArrowDown')).toBe(0);
    expect(nextMenuIndex(3, -1, 'ArrowUp')).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextMenuIndex(4, 2, 'Home')).toBe(0);
    expect(nextMenuIndex(4, 1, 'End')).toBe(3);
  });

  it('ignores other keys and empty menus', () => {
    expect(nextMenuIndex(3, 0, 'a')).toBeNull();
    expect(nextMenuIndex(3, 0, 'Enter')).toBeNull();
    expect(nextMenuIndex(0, -1, 'ArrowDown')).toBeNull();
  });
});
