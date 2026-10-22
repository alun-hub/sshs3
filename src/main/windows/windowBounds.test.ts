import { describe, it, expect } from 'vitest';
import { resolveWindowBounds } from './windowBounds';

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const second = { x: 1920, y: 0, width: 2560, height: 1440 };

describe('resolveWindowBounds', () => {
  it('keeps bounds that are on a connected display', () => {
    const saved = { x: 2000, y: 100, width: 1000, height: 700 };
    expect(resolveWindowBounds(saved, [primary, second], primary)).toEqual(saved);
  });

  it('falls back to the primary display when the saved monitor is gone', () => {
    const saved = { x: 2000, y: 100, width: 1000, height: 700 };
    expect(resolveWindowBounds(saved, [primary], primary)).toEqual({ x: 460, y: 190, width: 1000, height: 700 });
  });

  it('centers the default size when nothing is saved or the value is corrupt', () => {
    const expected = { x: 360, y: 140, width: 1200, height: 800 };
    expect(resolveWindowBounds(undefined, [primary], primary)).toEqual(expected);
    expect(resolveWindowBounds({ x: NaN, y: 0, width: 10, height: 10 }, [primary], primary)).toEqual(expected);
  });

  it('enforces a usable minimum size and fits oversized windows to the primary display', () => {
    expect(resolveWindowBounds({ x: 10, y: 10, width: 50, height: 50 }, [primary], primary)).toMatchObject({
      width: 400,
      height: 300,
    });
    expect(resolveWindowBounds({ x: 5000, y: 0, width: 4000, height: 3000 }, [primary], primary)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('treats a window that only barely touches a display as off-screen', () => {
    const saved = { x: 1900, y: 0, width: 1000, height: 700 };
    expect(resolveWindowBounds(saved, [primary], primary).x).toBe(460);
  });
});
