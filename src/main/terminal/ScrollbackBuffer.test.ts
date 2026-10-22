import { describe, it, expect } from 'vitest';
import { ScrollbackBuffer } from './ScrollbackBuffer';

describe('ScrollbackBuffer', () => {
  it('returns the output of a session in order and keeps sessions apart', () => {
    const b = new ScrollbackBuffer();
    b.append('a', 'one ');
    b.append('b', 'x');
    b.append('a', 'two');
    expect(b.get('a')).toBe('one two');
    expect(b.get('b')).toBe('x');
    expect(b.get('missing')).toBe('');
  });

  it('drops the oldest output once the limit is exceeded', () => {
    const b = new ScrollbackBuffer(10);
    b.append('a', '12345');
    b.append('a', '67890');
    b.append('a', 'abc');
    expect(b.get('a')).toBe('67890abc');
  });

  it('trims a single oversized chunk to the limit, starting at a line boundary', () => {
    const b = new ScrollbackBuffer(20);
    b.append('a', 'old line one\nold line two\nnewest line');
    const out = b.get('a');
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('newest line')).toBe(true);
    expect(out.startsWith('\n')).toBe(false);
  });

  it('ignores empty data and forgets deleted sessions', () => {
    const b = new ScrollbackBuffer();
    b.append('a', '');
    b.append('', 'x');
    b.append('a', 'y');
    b.delete('a');
    expect(b.get('a')).toBe('');
  });
});
