import type { TabHandoff, TabHandoffSession } from '@shared/types/ipc';
import { collectLeafIds } from './paneTree';
import { getLiveSession, type LiveSession } from './liveSessions';
import { normalizeTab, sanitizeTabForSession, type AppTab } from './tabs';

/** A dirty editor tab holds edits only this window has, so it stays where it is. */
export function canMoveTab(tab: AppTab): boolean {
  return !tab.isDirty;
}

/** The running terminal sessions of a tab, one per pane that currently shows one. */
export function collectTabSessions(
  tab: AppTab,
  lookup: (paneId: string) => LiveSession | undefined = getLiveSession
): TabHandoffSession[] {
  if (!tab.paneTree) return [];
  const sessions: TabHandoffSession[] = [];
  for (const paneId of collectLeafIds(tab.paneTree)) {
    const live = lookup(paneId);
    if (live) sessions.push({ paneId, sessionId: live.sessionId, kind: live.kind });
  }
  return sessions;
}

/** Packs a tab for another window. Secrets are stripped the same way as for the saved session. */
export function buildTabHandoff(
  tab: AppTab,
  lookup?: (paneId: string) => LiveSession | undefined
): TabHandoff {
  const { zoomedPaneId: _zoomedPaneId, ...plain } = sanitizeTabForSession(tab);
  return { tab: { ...plain } as Record<string, unknown>, sessions: collectTabSessions(tab, lookup) };
}

/** Turns a received handoff back into a tab of this window. */
export function adoptedTab(handoff: TabHandoff): AppTab {
  const { isDirty: _isDirty, ...rest } = handoff.tab as unknown as AppTab;
  return normalizeTab(rest as AppTab);
}
