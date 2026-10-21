import { describe, it, expect } from 'vitest';
import {
  isEmptyUnconnectedTab,
  normalizeTab,
  sanitizeTabForSession,
  tabForNumber,
  type AppTab,
} from '../../src/renderer/src/lib/tabs';

describe('tabs helpers', () => {
  it('maps tab numbers 1..8 to that tab and 9 to the last tab', () => {
    const tabs = ['a', 'b', 'c'].map((id) => ({ id, type: 'terminal', title: id }) as AppTab);
    expect(tabForNumber(tabs, 1)?.id).toBe('a');
    expect(tabForNumber(tabs, 3)?.id).toBe('c');
    expect(tabForNumber(tabs, 4)).toBeNull();
    expect(tabForNumber(tabs, 9)?.id).toBe('c');
    expect(tabForNumber([], 9)).toBeNull();
    expect(tabForNumber(tabs, 0)).toBeNull();
  });

  it('does not persist the transient pane zoom in a saved session', () => {
    const tab = {
      id: 't1',
      type: 'terminal',
      title: 'T',
      paneTree: { type: 'leaf', id: 'a' },
      zoomedPaneId: 'a',
    } as AppTab;
    expect(sanitizeTabForSession(tab)).not.toHaveProperty('zoomedPaneId');
  });

  it('gives a terminal tab without a pane tree a single root leaf', () => {
    const tab = normalizeTab({ id: 't1', type: 'terminal', title: 'Terminal 1' } as AppTab);
    expect(tab.paneTree).toMatchObject({ type: 'leaf', id: 't1-root' });
  });

  it('leaves file manager tabs and tabs that already have a tree untouched', () => {
    const fm = { id: 'f1', type: 'filemanager', title: 'File Manager 1' } as AppTab;
    expect(normalizeTab(fm)).toBe(fm);
    const withTree = { id: 't1', type: 'terminal', title: 'T', paneTree: { type: 'leaf', id: 'x' } } as AppTab;
    expect(normalizeTab(withTree)).toBe(withTree);
  });

  it('treats a single not-yet-connected pane as empty, a connected or local one as not', () => {
    const base = { id: 't1', type: 'terminal', title: 'T' };
    expect(isEmptyUnconnectedTab({ ...base, paneTree: { type: 'leaf', id: 'a' } } as AppTab)).toBe(true);
    expect(isEmptyUnconnectedTab({ ...base, paneTree: { type: 'leaf', id: 'a', local: true } } as AppTab)).toBe(false);
    expect(
      isEmptyUnconnectedTab({ ...base, paneTree: { type: 'leaf', id: 'a', config: { id: 'c' } } } as unknown as AppTab)
    ).toBe(false);
  });

  it('strips credentials from the pane tree before a tab is saved', () => {
    const tab = {
      id: 't1',
      type: 'terminal',
      title: 'T',
      paneTree: {
        type: 'leaf',
        id: 'a',
        config: { id: 'c', host: 'h', username: 'u', authType: 'password', password: 'secret', pin: '1234' }, // pragma: allowlist secret
      },
    } as unknown as AppTab;
    const saved = JSON.stringify(sanitizeTabForSession(tab));
    expect(saved).not.toContain('secret');
    expect(saved).not.toContain('1234');
    expect(saved).toContain('"host":"h"');
  });
});
