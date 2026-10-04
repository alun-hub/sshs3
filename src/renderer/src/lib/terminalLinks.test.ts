import { describe, it, expect } from 'vitest';
import { findPaths, findUrls } from './terminalLinks';

describe('findUrls', () => {
  it('finds urls and strips trailing punctuation', () => {
    expect(findUrls('see https://example.com/a?b=1, and http://x.io.').map((u) => u.url)).toEqual([
      'https://example.com/a?b=1',
      'http://x.io',
    ]);
  });

  it('keeps balanced parentheses but drops a stray closing one', () => {
    expect(findUrls('https://en.wikipedia.org/wiki/Foo_(bar)')[0].url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(findUrls('(https://example.com)')[0].url).toBe('https://example.com');
  });

  it('ignores non-http schemes', () => {
    expect(findUrls('ftp://example.com file:///etc/passwd')).toEqual([]);
  });
});

describe('findPaths', () => {
  it('finds absolute and home-relative paths', () => {
    expect(findPaths('cat /var/log/syslog and ~/notes/todo.md').map((p) => p.text)).toEqual([
      '/var/log/syslog',
      '~/notes/todo.md',
    ]);
  });

  it('strips trailing punctuation and keeps :line out of the path but inside the range', () => {
    const [p] = findPaths('error in /srv/app/main.py:42:7, see above');
    expect(p.text).toBe('/srv/app/main.py');
    expect(p.length).toBe('/srv/app/main.py:42:7'.length);
    expect(findPaths('see /etc/hosts.')[0].text).toBe('/etc/hosts');
  });

  it('does not match urls, words with slashes, fractions or bare slashes', () => {
    expect(findPaths('https://example.com/a/b and/or 1/2 / #')).toEqual([]);
  });
});
