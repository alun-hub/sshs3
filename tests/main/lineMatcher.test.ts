import { describe, it, expect } from 'vitest';
import { buildLineMatcher } from '../../src/main/search/lineMatcher';

describe('buildLineMatcher', () => {
  it('matches a plain substring case-insensitively by default', () => {
    const matcher = buildLineMatcher('hello', 'literal', false);
    expect(matcher('say HELLO world')).toEqual({ start: 4, end: 9 });
    expect(matcher('nothing here')).toBeNull();
  });

  it('respects caseSensitive for plain substring search', () => {
    const matcher = buildLineMatcher('Hello', 'literal', true);
    expect(matcher('say Hello world')).toEqual({ start: 4, end: 9 });
    expect(matcher('say hello world')).toBeNull();
  });

  it('matches a normal, safe regex', () => {
    const matcher = buildLineMatcher('h[ae]llo', 'regex', false);
    expect(matcher('say hallo world')).toEqual({ start: 4, end: 9 });
    expect(matcher('say hxllo world')).toBeNull();
  });

  it('returns no match (instead of throwing) for a syntactically invalid regex', () => {
    const matcher = buildLineMatcher('(unclosed', 'regex', false);
    expect(matcher('anything')).toBeNull();
  });

  // M10 (code review): a catastrophic-backtracking pattern must never
  // actually be compiled/run — it should behave like an invalid regex
  // (silently no match) rather than hang the caller synchronously.
  it('refuses a classic catastrophic-backtracking pattern instead of hanging (M10)', () => {
    const matcher = buildLineMatcher('(a+)+$', 'regex', false);
    const maliciousLine = 'a'.repeat(40) + '!';

    const start = Date.now();
    const result = matcher(maliciousLine);
    const elapsedMs = Date.now() - start;

    expect(result).toBeNull();
    expect(elapsedMs).toBeLessThan(200);
  });

  it('refuses another nested-quantifier catastrophic pattern (M10)', () => {
    const matcher = buildLineMatcher('(a*)*b', 'regex', false);
    const maliciousLine = 'a'.repeat(40);

    const start = Date.now();
    const result = matcher(maliciousLine);
    const elapsedMs = Date.now() - start;

    expect(result).toBeNull();
    expect(elapsedMs).toBeLessThan(200);
  });

  it('refuses a regex pattern longer than the maximum allowed query length (M10)', () => {
    const matcher = buildLineMatcher('a'.repeat(1000), 'regex', false);
    expect(matcher('a'.repeat(1000))).toBeNull();
  });

  it('still allows a normal, longer-but-safe regex within the length limit (M10)', () => {
    const matcher = buildLineMatcher('^ERROR: .*(timeout|refused)$', 'regex', false);
    expect(matcher('ERROR: connection refused')).not.toBeNull();
    expect(matcher('INFO: all good')).toBeNull();
  });
});
