/**
 * Iterative glob match (`*` = any run of characters, `?` = exactly one) that remembers only
 * the last `*`, so it is O(name × pattern) in the worst case. A regex translation would
 * backtrack exponentially on patterns like `*a*a*a*b`.
 */
function globMatches(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let starP = -1;
  let starT = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p += 1;
      t += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      starP = p;
      starT = t;
      p += 1;
    } else if (starP !== -1) {
      p = starP + 1;
      starT += 1;
      t = starT;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/**
 * Builds a case-insensitive file-name matcher for the filter box. A query without
 * wildcards is a plain substring match; with `*` or `?` it is a glob that must match the
 * whole name, e.g. `*.log` or `app-?.txt`.
 */
export function makeNameMatcher(query: string): (name: string) => boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return () => true;
  if (!/[*?]/.test(needle)) return (name) => name.toLowerCase().includes(needle);
  return (name) => globMatches(needle, name.toLowerCase());
}
