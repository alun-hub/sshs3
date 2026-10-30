import { describe, it, expect } from 'vitest';
import { parseSearchQuery } from '../../src/renderer/src/lib/searchQuery';

describe('parseSearchQuery', () => {
  it('treats blank input as an empty query', () => {
    expect(parseSearchQuery('')).toEqual({ terms: [], tags: [], adHoc: null, empty: true });
    expect(parseSearchQuery('   ')).toMatchObject({ empty: true });
  });

  it('splits plain words into terms, all of which must match', () => {
    expect(parseSearchQuery('  web   prod ')).toEqual({ terms: ['web', 'prod'], tags: [], adHoc: null, empty: false });
  });

  it('reads #word as a tag filter, lower-cased, and keeps other words as terms', () => {
    expect(parseSearchQuery('#Prod web #db')).toMatchObject({ terms: ['web'], tags: ['prod', 'db'] });
  });

  it('ignores a lone # and strips repeated ones', () => {
    expect(parseSearchQuery('#')).toMatchObject({ terms: [], tags: [], empty: true });
    expect(parseSearchQuery('##prod')).toMatchObject({ tags: ['prod'] });
  });

  it('recognises user@host and user@host:port as a quick-connect target and still searches for it', () => {
    expect(parseSearchQuery('alice@web1:2222')).toEqual({
      terms: ['alice@web1:2222'],
      tags: [],
      adHoc: { username: 'alice', host: 'web1', port: 2222 },
      empty: false,
    });
  });

  it('does not offer quick-connect when the text has more than a target in it', () => {
    expect(parseSearchQuery('alice@web1 prod').adHoc).toBeNull();
  });
});
