import { describe, it, expect } from 'vitest';
import { parseNumberDraft, settleNumberDraft } from '../../src/renderer/src/lib/numberField';

describe('parseNumberDraft', () => {
  it('accepts a whole number inside the range, including the ends', () => {
    expect(parseNumberDraft('16', 8, 32)).toBe(16);
    expect(parseNumberDraft('8', 8, 32)).toBe(8);
    expect(parseNumberDraft('32', 8, 32)).toBe(32);
  });

  it('is null for a draft that is still on its way: too small so far, empty or not a whole number', () => {
    expect(parseNumberDraft('1', 8, 32)).toBeNull();
    expect(parseNumberDraft('', 8, 32)).toBeNull();
    expect(parseNumberDraft('  ', 8, 32)).toBeNull();
    expect(parseNumberDraft('1.5', 8, 32)).toBeNull();
    expect(parseNumberDraft('-12', 8, 32)).toBeNull();
    expect(parseNumberDraft('1e1', 8, 32)).toBeNull();
  });

  it('is null above the range', () => {
    expect(parseNumberDraft('33', 8, 32)).toBeNull();
    expect(parseNumberDraft('99999999999999999999', 8, 32)).toBeNull();
  });

  it('ignores surrounding spaces and leading zeros', () => {
    expect(parseNumberDraft(' 16 ', 8, 32)).toBe(16);
    expect(parseNumberDraft('016', 8, 32)).toBe(16);
  });
});

describe('settleNumberDraft', () => {
  it('keeps a number that is already allowed', () => {
    expect(settleNumberDraft('16', 8, 32)).toBe(16);
  });

  it('moves a number outside the range to the nearest end', () => {
    expect(settleNumberDraft('2', 8, 32)).toBe(8);
    expect(settleNumberDraft('99', 8, 32)).toBe(32);
    expect(settleNumberDraft('99999999999999999999', 8, 32)).toBe(32);
  });

  it('is null when there is nothing usable to settle on, so the field goes back to its stored value', () => {
    expect(settleNumberDraft('', 8, 32)).toBeNull();
    expect(settleNumberDraft('abc', 8, 32)).toBeNull();
    expect(settleNumberDraft('1.5', 8, 32)).toBeNull();
  });
});

describe('with a step (min 500, max 50000, step 500)', () => {
  it('accepts only numbers on the grid that starts at min', () => {
    expect(parseNumberDraft('500', 500, 50000, 500)).toBe(500);
    expect(parseNumberDraft('1500', 500, 50000, 500)).toBe(1500);
    expect(parseNumberDraft('50000', 500, 50000, 500)).toBe(50000);
    expect(parseNumberDraft('750', 500, 50000, 500)).toBeNull();
    expect(parseNumberDraft('5200', 500, 50000, 500)).toBeNull();
  });

  it('counts the grid from min, not from zero', () => {
    expect(parseNumberDraft('13', 8, 32, 5)).toBe(13);
    expect(parseNumberDraft('15', 8, 32, 5)).toBeNull();
  });

  it('settles on the nearest number on the grid, half-way going up', () => {
    expect(settleNumberDraft('700', 500, 50000, 500)).toBe(500);
    expect(settleNumberDraft('750', 500, 50000, 500)).toBe(1000);
    expect(settleNumberDraft('5200', 500, 50000, 500)).toBe(5000);
    expect(settleNumberDraft('2', 500, 50000, 500)).toBe(500);
    expect(settleNumberDraft('99999', 500, 50000, 500)).toBe(50000);
  });

  it('never settles above max when max is not on the grid', () => {
    expect(settleNumberDraft('31', 8, 32, 5)).toBe(28);
    expect(settleNumberDraft('99', 8, 32, 5)).toBe(28);
  });

  it('treats a step of zero or below, or a step that is not a number, as 1', () => {
    expect(parseNumberDraft('16', 8, 32, 0)).toBe(16);
    expect(parseNumberDraft('16', 8, 32, -5)).toBe(16);
    expect(settleNumberDraft('16', 8, 32, Number.NaN)).toBe(16);
  });
});
