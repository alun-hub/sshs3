import { allSignIns } from '@shared/awsSignIns';
import type { AwsSignIn } from '@shared/types/aws';
import type { AwsSsoStatusInfo } from '@shared/types/awsScan';
import type { AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig } from '@shared/types/ssh';

export interface BadgeRow extends AwsSignIn {
  /** At least one saved SSM profile signs in with this start URL: an expired sign-in then needs attention. */
  used: boolean;
}

export type BadgeTone = 'ok' | 'attention' | 'none';

/**
 * The sign-ins to show in the top-bar badge: policy and saved sign-ins, plus any start URL that saved SSM profiles
 * use but that has no saved entry (so a profile never depends on a sign-in the user cannot see).
 */
export function buildBadgeRows(
  settings: Pick<AppSettings, 'awsSignIns' | 'awsManagedSignIns'> | undefined,
  profiles: readonly SSHConnectionConfig[]
): BadgeRow[] {
  const rows: BadgeRow[] = allSignIns(settings?.awsSignIns, settings?.awsManagedSignIns).map((s) => ({ ...s, used: false }));
  const keyOf = (url: string, region: string) => `${url}\u0000${region}`;
  const byKey = new Map(rows.map((r) => [keyOf(r.startUrl, r.region), r]));
  for (const p of profiles) {
    const sso = p.ssm?.enabled ? p.ssm.sso : undefined;
    if (!sso) continue;
    const existing = byKey.get(keyOf(sso.startUrl, sso.region)) ?? rows.find((r) => r.startUrl === sso.startUrl);
    if (existing) {
      existing.used = true;
      continue;
    }
    const row: BadgeRow = { id: `profile:${sso.startUrl}`, name: sso.startUrl.replace(/^https:\/\//, '').replace(/\/.*$/, ''), startUrl: sso.startUrl, region: sso.region, used: true };
    rows.push(row);
    byKey.set(keyOf(row.startUrl, row.region), row);
  }
  return rows;
}

/** green = signed in somewhere and nothing in use is lapsed; amber = a sign-in that saved profiles use is lapsed or missing. */
export function badgeTone(rows: readonly BadgeRow[], statuses: Record<string, AwsSsoStatusInfo | undefined>): BadgeTone {
  if (rows.some((r) => r.used && statuses[r.id] && statuses[r.id]!.status !== 'valid')) return 'attention';
  return rows.some((r) => statuses[r.id]?.status === 'valid') ? 'ok' : 'none';
}

export function badgeTitle(tone: BadgeTone, rows: readonly BadgeRow[]): string {
  if (tone === 'attention') return 'AWS: a sign-in used by your profiles has expired (click to sign in)';
  if (tone === 'ok') return 'AWS: signed in';
  return rows.length === 0 ? 'AWS: no sign-ins yet' : 'AWS: not signed in';
}
