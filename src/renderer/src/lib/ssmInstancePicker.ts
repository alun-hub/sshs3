import { suggestLoginName } from '@shared/ssm';
import type { SsmInstance } from '@shared/types/ssm';

/** Case-insensitive match on name, instance id, platform and IP; an empty query keeps everything. */
export function filterInstances(instances: readonly SsmInstance[], query: string): SsmInstance[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...instances];
  return instances.filter((i) =>
    [i.name, i.instanceId, i.platformName, i.platformType, i.ipAddress].some((v) => v?.toLowerCase().includes(q))
  );
}

/** Suggested SSH login for the picked instances: the first one's platform decides (the user can edit it). */
export function suggestLogin(selected: readonly SsmInstance[]): string {
  return suggestLoginName(selected[0]?.platformName);
}

/** Toggles one id in a selection; `single` mode keeps at most one. */
export function toggleSelection(current: ReadonlySet<string>, id: string, single: boolean): Set<string> {
  if (single) return current.has(id) ? new Set() : new Set([id]);
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
