import { describe, it, expect } from 'vitest';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import { formatLastUsed, searchLandingProfiles } from './landingSearch';

const p = (id: string, name: string, host: string, extra: Partial<SSHConnectionConfig> = {}): SSHConnectionConfig => ({
  id,
  name,
  host,
  port: 22,
  username: 'alun',
  authType: 'password',
  ...extra,
});

const profiles = [
  p('1', 'gnarg ssh-ca', 'gnarg'),
  p('2', 'build-box', 'ci.example.com', { tags: ['ci'] }),
  p('3', 'prod web', 'web1.example.com', { tags: ['prod'] }),
];

describe('searchLandingProfiles', () => {
  it('returns nothing for an empty query', () => {
    expect(searchLandingProfiles(profiles, '  ', 8)).toEqual([]);
  });

  it('matches fuzzily, with highlight positions in the name', () => {
    const [hit] = searchLandingProfiles(profiles, 'gnca', 8);
    expect(hit.profile.id).toBe('1');
    expect(hit.titleIndices.length).toBe(4);
  });

  it('requires every word and honours #tag filters', () => {
    expect(searchLandingProfiles(profiles, 'prod web', 8).map((m) => m.profile.id)).toEqual(['3']);
    expect(searchLandingProfiles(profiles, '#ci', 8).map((m) => m.profile.id)).toEqual(['2']);
    expect(searchLandingProfiles(profiles, 'build #prod', 8)).toEqual([]);
  });

  it('caps the number of results', () => {
    expect(searchLandingProfiles(profiles, 'e', 1)).toHaveLength(1);
  });
});

describe('formatLastUsed', () => {
  const now = Date.parse('2026-11-01T12:00:00Z');
  it('is relative for the last week and a date after that', () => {
    expect(formatLastUsed('2026-11-01T11:59:50Z', now)).toBe('just now');
    expect(formatLastUsed('2026-11-01T11:55:00Z', now)).toBe('5 min ago');
    expect(formatLastUsed('2026-11-01T09:00:00Z', now)).toBe('3 h ago');
    expect(formatLastUsed('2026-10-30T12:00:00Z', now)).toBe('2 d ago');
    expect(formatLastUsed('2026-09-01T12:00:00Z', now)).toMatch(/^2026-09-0[12]$/);
  });
  it('is empty for missing or invalid input', () => {
    expect(formatLastUsed(undefined, now)).toBe('');
    expect(formatLastUsed('nope', now)).toBe('');
  });
});
