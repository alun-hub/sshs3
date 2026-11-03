import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { defineTargetTouched, wasTargetTouched } from '../../src/main/storage/targetTouched';

describe('targetTouched', () => {
  it('treats a stream without the signal as touched (previous clean-up behaviour)', () => {
    expect(wasTargetTouched(new PassThrough())).toBe(true);
    expect(wasTargetTouched(undefined)).toBe(true);
    expect(wasTargetTouched({ targetTouched: 'yes' })).toBe(true);
  });

  it('follows the live value of the getter', () => {
    let touched = false;
    const stream = defineTargetTouched(new PassThrough(), () => touched);
    expect(wasTargetTouched(stream)).toBe(false);
    touched = true;
    expect(wasTargetTouched(stream)).toBe(true);
  });
});
