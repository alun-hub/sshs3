import { parseRegionList } from '@shared/awsSignIns';
import { scanFolder, uniqueNames } from '@shared/awsScan';
import { suggestLoginName } from '@shared/ssm';
import type { AwsSsoAccount } from '@shared/types/aws';
import type { AwsPickItem, AwsScanTarget, ScannedInstance } from '@shared/types/awsScan';
import type { SSHConnectionConfig } from '@shared/types/ssh';

/** Pure helpers behind the "Add from AWS" guide. */

/** One search target per chosen account, all with the same role name. */
export function ssoTargets(
  sso: { startUrl: string; region: string },
  accounts: readonly AwsSsoAccount[],
  selected: ReadonlySet<string>,
  roleName: string
): AwsScanTarget[] {
  return accounts
    .filter((a) => selected.has(a.accountId))
    .map((a) => ({
      id: `acct-${a.accountId}`,
      label: a.accountName || a.accountId,
      accountId: a.accountId,
      accountName: a.accountName,
      source: { kind: 'sso' as const, sso: { startUrl: sso.startUrl, region: sso.region, accountId: a.accountId, roleName } },
    }));
}

export function profileTargets(names: readonly string[]): AwsScanTarget[] {
  return names.map((name) => ({ id: `profile-${name}`, label: name, source: { kind: 'profile' as const, name } }));
}

export function defaultTargets(): AwsScanTarget[] {
  return [{ id: 'default', label: 'Default credentials', source: { kind: 'default' } }];
}

/** Regions preselected in the guide: the policy/settings list when there is one, else the sign-in's own region as a first guess. */
export function initialRegions(settingsRegions: string | undefined, signInRegion?: string): string[] {
  const configured = parseRegionList(settingsRegions);
  if (configured.length > 0) return configured;
  return signInRegion ? parseRegionList(signInRegion) : [];
}

/** Names already used per folder by saved profiles, so an imported name never collides with one. */
export function takenNamesByFolder(profiles: readonly SSHConnectionConfig[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const p of profiles) {
    if (!p.group) continue;
    const set = out.get(p.group) ?? new Set<string>();
    set.add(p.name);
    out.set(p.group, set);
  }
  return out;
}

/** Instances that already have an SSM profile (instance ids are unique in AWS). */
export function alreadyAdded(profiles: readonly SSHConnectionConfig[]): Set<string> {
  return new Set(profiles.filter((p) => p.ssm?.enabled).map((p) => p.host));
}

/**
 * Turns the chosen instances into import items: folder `AWS/<account>/<region>`, a name that is unique in its folder
 * and a login name (the user's own entry for the instance, else a suggestion for its platform).
 */
export function buildPickItems(
  chosen: readonly ScannedInstance[],
  targets: ReadonlyMap<string, AwsScanTarget>,
  usernames: Readonly<Record<string, string>>,
  taken: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  connect: Pick<AwsPickItem, 'mode' | 'authType' | 'privateKeyPath'> = {}
): AwsPickItem[] {
  const byFolder = new Map<string, ScannedInstance[]>();
  const folderOf = new Map<string, string>();
  for (const i of chosen) {
    const target = targets.get(i.targetId);
    if (!target) continue;
    const folder = scanFolder(target.accountName || target.label, i.region);
    folderOf.set(`${i.targetId}\u0000${i.region}\u0000${i.instanceId}`, folder);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), i]);
  }
  const items: AwsPickItem[] = [];
  for (const [folder, list] of byFolder) {
    const names = uniqueNames(list.map((i) => ({ instanceId: i.instanceId, name: i.name })), taken.get(folder));
    for (const i of list) {
      items.push({
        instance: i,
        source: targets.get(i.targetId)!.source,
        name: names.get(i.instanceId) ?? i.name,
        username: usernames[i.instanceId]?.trim() || suggestLoginName(i.platformName),
        folder,
        ...connect,
      });
    }
  }
  return items;
}

/** Stable key of one search result: the same node can be found through two targets. */
export function instanceKey(i: Pick<ScannedInstance, 'targetId' | 'region' | 'instanceId'>): string {
  return `${i.targetId}\u0000${i.region}\u0000${i.instanceId}`;
}

/** Account ids typed by hand (comma, space or newline separated); anything that is not 12 digits is ignored. */
export function parseAccountIds(text: string): AwsSsoAccount[] {
  const seen = new Set<string>();
  const out: AwsSsoAccount[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    if (/^\d{12}$/.test(part) && !seen.has(part)) {
      seen.add(part);
      out.push({ accountId: part });
    }
  }
  return out;
}

/** Roles known per account: the list AWS returned, or `loading` / `error` while it is not there. */
export type AccountRoles = Readonly<Record<string, readonly string[] | 'loading' | 'error' | undefined>>;

const isList = (v: AccountRoles[string]): v is readonly string[] => Array.isArray(v);

/** One search target per chosen account with that account's own role; accounts without a role are left out. */
export function ssoTargetsByRole(
  sso: { startUrl: string; region: string },
  accounts: readonly AwsSsoAccount[],
  selected: ReadonlySet<string>,
  roles: Readonly<Record<string, string | undefined>>
): AwsScanTarget[] {
  return accounts.flatMap((a) => (selected.has(a.accountId) && roles[a.accountId] ? ssoTargets(sso, [a], selected, roles[a.accountId]!) : []));
}

/** The role to preselect for an account: its only role, else the first preferred name it has. */
export function defaultRole(roles: readonly string[], preferred: ReadonlyArray<string | undefined>): string | undefined {
  if (roles.length === 1) return roles[0];
  return preferred.find((p): p is string => !!p && roles.includes(p));
}

/** Roles to offer for "Same role everywhere": every role found in the selected accounts with how many have it. */
export function commonRoleOptions(selected: ReadonlySet<string>, roles: AccountRoles): Array<{ role: string; count: number; total: number }> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const id of selected) {
    const list = roles[id];
    if (!isList(list)) continue;
    total++;
    for (const r of list) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts].map(([role, count]) => ({ role, count, total })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
}

/** Sets `role` for every selected account that has it; other accounts keep what they had. */
export function applyCommonRole(
  role: string,
  selected: ReadonlySet<string>,
  roles: AccountRoles,
  current: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const next = { ...current };
  for (const id of selected) {
    const list = roles[id];
    if (isList(list) && list.includes(role)) next[id] = role;
  }
  return next;
}

/** Selected accounts that still have no role (or whose roles are still loading). */
export function accountsWithoutRole(selected: ReadonlySet<string>, roleByAccount: Readonly<Record<string, string | undefined>>): string[] {
  return [...selected].filter((id) => !roleByAccount[id]);
}
