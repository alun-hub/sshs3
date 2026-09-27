import safeRegex from 'safe-regex2';
import type { SearchMode } from '../../shared/types/search';

export interface MatchOffsets {
  start: number;
  end: number;
}

// M10 (code review): a user-supplied regex is compiled directly from
// search input with no timeout. A single catastrophic-backtracking pattern
// (e.g. `(a+)+$`) matched against one long line can hang the whole main
// process synchronously for as long as it takes to fail — freezing all IPC,
// every other transfer/search, and the UI — since yieldToEventLoop only
// yields *between* lines, not inside a single regex match. safe-regex2
// rejects a pattern whose nested-repetition ("star height") shape could
// cause that exponential blowup, before it's ever compiled/run.
const MAX_QUERY_LENGTH = 500;

function isSafeRegexQuery(query: string): boolean {
  return query.length <= MAX_QUERY_LENGTH && safeRegex(query);
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
      re = isSafeRegexQuery(query) ? new RegExp(query, caseSensitive ? '' : 'i') : null;
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
