import { isValidInstanceId, sanitizeAwsText } from './ssm';
import type { AwsScanSkip, AwsScanSkipReason, ScannedInstance } from './types/awsScan';

/**
 * Regions searched by default for "all regions": the commercial regions enabled in every account. Opt-in
 * regions (e.g. af-south-1, ap-east-1, me-south-1) and GovCloud/China are left out; they are added by hand.
 */
export const AWS_DEFAULT_REGIONS: readonly string[] = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-southeast-1', 'ap-southeast-2',
];

/** Upper bounds for one scan: instances shown and target × region searches run. */
export const MAX_SCAN_INSTANCES = 500;
export const MAX_SCAN_JOBS = 400;

/** The EC2 `Name` tag, sanitised; undefined when absent or empty. */
export function nameFromTags(tags: ReadonlyArray<{ Key?: string; Value?: string }> | undefined): string | undefined {
  const value = tags?.find((t) => t.Key === 'Name')?.Value;
  const clean = sanitizeAwsText(value, 80);
  return clean || undefined;
}

/**
 * Makes profile names unique within a folder. Two instances called `web` in the same account and region would
 * otherwise become one "system" (Connect all) in sshs3; a duplicate gets its instance id appended.
 * `taken` holds names already used in the folder (case-insensitive).
 */
export function uniqueNames(
  items: ReadonlyArray<{ instanceId: string; name: string }>,
  taken: ReadonlySet<string> = new Set()
): Map<string, string> {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.name.toLowerCase(), (counts.get(i.name.toLowerCase()) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const i of items) {
    const key = i.name.toLowerCase();
    let name = i.name;
    if ((counts.get(key) ?? 0) > 1 || used.has(key)) name = `${i.name} (${i.instanceId})`;
    used.add(name.toLowerCase());
    out.set(i.instanceId, name);
  }
  return out;
}

/** Folder for imported profiles: `AWS/<account name or label>/<region>`; path separators in names are replaced. */
export function scanFolder(accountNameOrLabel: string, region: string): string {
  const safe = sanitizeAwsText(accountNameOrLabel, 60).replace(/[\\/]+/g, '-') || 'account';
  return `AWS/${safe}/${region}`;
}

/** Groups scan results by account (target) then region, keeping first-seen order. */
export function groupInstances(instances: readonly ScannedInstance[]): Array<{ targetId: string; region: string; items: ScannedInstance[] }> {
  const groups = new Map<string, { targetId: string; region: string; items: ScannedInstance[] }>();
  for (const i of instances) {
    const key = `${i.targetId}\u0000${i.region}`;
    const g = groups.get(key) ?? { targetId: i.targetId, region: i.region, items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Keeps the first record per (target, instance id); the same node cannot appear twice in a scan. */
export function dedupeInstances(instances: readonly ScannedInstance[]): ScannedInstance[] {
  const seen = new Set<string>();
  const out: ScannedInstance[] = [];
  for (const i of instances) {
    if (!isValidInstanceId(i.instanceId)) continue;
    const key = `${i.targetId}\u0000${i.region}\u0000${i.instanceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

const REASON_TEXT: Record<AwsScanSkipReason, string> = {
  'access-denied': 'access denied',
  'region-disabled': 'region not enabled',
  expired: 'sign-in expired',
  credentials: 'no usable credentials',
  error: 'failed',
};

/** One line for the UI, e.g. "Searched 36, skipped 4: access denied ×3, region not enabled ×1". */
export function summarizeScan(searched: number, skipped: readonly AwsScanSkip[]): string {
  if (skipped.length === 0) return `Searched ${searched}.`;
  const counts = new Map<AwsScanSkipReason, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const parts = [...counts].map(([reason, n]) => `${REASON_TEXT[reason]} ×${n}`);
  return `Searched ${searched}, skipped ${skipped.length}: ${parts.join(', ')}.`;
}
