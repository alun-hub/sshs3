import type { SSHConnectionConfig } from '@shared/types/ssh';
import { formatDate } from './dateFormat';
import { searchEntries } from './globalSearch';
import { buildProfileEntries } from './globalSearchIndex';
import { parseSearchQuery } from './searchQuery';

export interface LandingMatch {
  profile: SSHConnectionConfig;
  /** Matched character positions in the profile name, for highlighting. */
  titleIndices: number[];
}

/**
 * Saved SSH profiles matching the landing page's quick-connect text, best first. Uses the same
 * fuzzy engine as the global search (Ctrl+Shift+G): several words, `#tag` filters and a ranking by
 * field, so the first match, which Enter connects to, is the best one.
 */
export function searchLandingProfiles(profiles: SSHConnectionConfig[], raw: string, limit: number): LandingMatch[] {
  const parsed = parseSearchQuery(raw);
  if (parsed.empty) return [];
  const entries = buildProfileEntries([{ source: 'personal', ssh: profiles, s3: [] }]);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const matches: LandingMatch[] = [];
  for (const result of searchEntries(entries, parsed)) {
    const profile = byId.get(result.entry.ref);
    if (profile) matches.push({ profile, titleIndices: result.titleIndices });
    if (matches.length >= limit) break;
  }
  return matches;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago"; older than a week falls back to yyyy-mm-dd. */
export function formatLastUsed(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(iso);
}
