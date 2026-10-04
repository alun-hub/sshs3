import { describe, it, expect } from 'vitest';
import { expandSnippet } from './snippets';

describe('expandSnippet', () => {
  it('fills known variables and leaves unknown ones alone', () => {
    const out = expandSnippet('ssh {{ user }}@{{host}} {{other}}', { host: 'h1', user: 'bob' });
    expect(out).toBe('ssh bob@h1 {{other}}');
  });

  it('formats {{date}} as yyyy-mm-dd HH:mm', () => {
    expect(expandSnippet('{{date}}', { host: '', user: '' }, new Date(2026, 9, 4, 15, 7))).toBe('2026-10-04 15:07');
  });
});
