import { describe, expect, it } from 'vitest';
import type { AppTab } from './tabs';
import { adoptedTab, buildTabHandoff, canMoveTab, collectTabSessions } from './tabTransfer';

const tree = {
  type: 'split' as const,
  id: 'sp',
  orientation: 'row' as const,
  children: [
    { type: 'leaf' as const, id: 'p1', local: true },
    { type: 'leaf' as const, id: 'p2', local: true },
  ],
};
const tab: AppTab = { id: 't1', type: 'terminal', title: 'T', paneTree: tree, zoomedPaneId: 'p1' };

describe('tabTransfer', () => {
  it('collects only the panes that have a running session', () => {
    const lookup = (id: string) => (id === 'p2' ? { sessionId: 's2', kind: 'ssh' as const } : undefined);
    expect(collectTabSessions(tab, lookup)).toEqual([{ paneId: 'p2', sessionId: 's2', kind: 'ssh' }]);
    expect(collectTabSessions({ id: 'f', type: 'filemanager', title: 'F' }, lookup)).toEqual([]);
  });

  it('builds a handoff without transient view state', () => {
    const handoff = buildTabHandoff(tab, () => ({ sessionId: 's', kind: 'k8s' }));
    expect(handoff.tab).not.toHaveProperty('zoomedPaneId');
    expect(handoff.tab.id).toBe('t1');
    expect(handoff.sessions.map((s) => s.paneId)).toEqual(['p1', 'p2']);
  });

  it('drops pasted editor content from the handoff', () => {
    const editor: AppTab = { id: 'e', type: 'editor', title: 'x', editorInitialContent: 'secret log content' };
    expect(buildTabHandoff(editor).tab).not.toHaveProperty('editorInitialContent');
  });

  it('refuses to move a tab with unsaved changes', () => {
    expect(canMoveTab({ ...tab, isDirty: true })).toBe(false);
    expect(canMoveTab(tab)).toBe(true);
  });

  it('adopts a received tab, always with a pane tree and never dirty', () => {
    const received = adoptedTab({ tab: { id: 't9', type: 'terminal', title: 'X', isDirty: true }, sessions: [] });
    expect(received.paneTree).toBeDefined();
    expect(received.isDirty).toBeUndefined();
  });
});
