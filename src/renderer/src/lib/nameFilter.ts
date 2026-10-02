/**
 * Builds a case-insensitive file-name matcher for the filter box. A query without
 * wildcards is a plain substring match; with `*` (any run of characters) or `?` (exactly
 * one character) it is a glob that must match the whole name, e.g. `*.log` or `app-?.txt`.
 */
export function makeNameMatcher(query: string): (name: string) => boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return () => true;
  if (!/[*?]/.test(needle)) return (name) => name.toLowerCase().includes(needle);
  const source = needle
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  const re = new RegExp(`^${source}$`, 's');
  return (name) => re.test(name.toLowerCase());
}
