import type { SearchMode } from '../../shared/types/search';

export interface MatchOffsets {
  start: number;
  end: number;
}

/**
 * Builds a reusable line-matching function for one search (compiling the regex, if any,
 * only once) shared by every backend that has to test raw text client-side: the SFTP
 * backend re-derives highlight offsets for a line `grep` already matched, and the S3
 * backend has no server-side filtering at all and uses this to do the matching itself.
 */
export function buildLineMatcher(
  query: string,
  mode: SearchMode,
  caseSensitive: boolean
): (line: string) => MatchOffsets | null {
  if (mode === 'regex') {
    let re: RegExp | null;
    try {
      re = new RegExp(query, caseSensitive ? '' : 'i');
    } catch {
      re = null;
    }
    return (line: string) => {
      if (!re) return null;
      const m = re.exec(line);
      if (!m) return null;
      return { start: m.index, end: m.index + m[0].length };
    };
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  return (line: string) => {
    const haystack = caseSensitive ? line : line.toLowerCase();
    const idx = haystack.indexOf(needle);
    if (idx === -1) return null;
    return { start: idx, end: idx + needle.length };
  };
}
