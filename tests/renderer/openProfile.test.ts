import { describe, it, expect } from 'vitest';
import { shouldTouchLastUsed } from '../../src/renderer/src/lib/openProfile';

describe('shouldTouchLastUsed', () => {
  it('writes the last-used time for personal profiles', () => {
    expect(shouldTouchLastUsed('personal')).toBe(true);
  });

  it('never writes it for a Team Vault profile: that would bump the vault revision for every member', () => {
    expect(shouldTouchLastUsed('vault-123')).toBe(false);
    expect(shouldTouchLastUsed('')).toBe(false);
  });
});
