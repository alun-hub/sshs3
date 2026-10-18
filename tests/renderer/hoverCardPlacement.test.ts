import { describe, it, expect } from 'vitest';
import { placeHoverCard } from '../../src/renderer/src/lib/hoverCardPlacement';

const vp = { viewportWidth: 1000, viewportHeight: 700 };

describe('placeHoverCard', () => {
  it('opens right of and below the pointer when it fits', () => {
    expect(placeHoverCard({ x: 100, y: 100, width: 380, height: 300, ...vp })).toEqual({ left: 112, top: 116 });
  });

  it('flips left and above near the bottom-right corner', () => {
    expect(placeHoverCard({ x: 900, y: 600, width: 380, height: 300, ...vp })).toEqual({ left: 508, top: 284 });
  });

  it('keeps a card taller than the room below inside the viewport', () => {
    const { top } = placeHoverCard({ x: 100, y: 400, width: 380, height: 420, ...vp });
    expect(top + 420).toBeLessThanOrEqual(700 - 16);
    expect(top).toBeGreaterThanOrEqual(16);
  });

  it('clamps to the margin when the viewport is smaller than the card', () => {
    expect(placeHoverCard({ x: 50, y: 50, width: 380, height: 900, ...vp }).top).toBe(16);
  });
});
