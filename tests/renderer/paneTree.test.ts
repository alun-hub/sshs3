import { describe, it, expect } from 'vitest';
import {
  closePane,
  countOtherSessionPanes,
  createLeaf,
  findLeaf,
  paneSftpConfig,
  shouldHoistLocalPerf,
  splitPane,
  splitSourceConfig,
  updateLeaf,
  updateSplitWeights,
} from '../../src/renderer/src/lib/paneTree';
import type { PaneSplit } from '../../src/shared/types/session';

describe('updateSplitWeights', () => {
  const tree: PaneSplit = {
    type: 'split',
    id: 'split-1',
    orientation: 'row',
    children: [createLeaf('leaf-1'), createLeaf('leaf-2')],
  };

  it('sets weights on the matching split node', () => {
    const next = updateSplitWeights(tree, 'split-1', [0.3, 0.7]) as PaneSplit;
    expect(next.weights).toEqual([0.3, 0.7]);
    expect(next).not.toBe(tree);
  });

  it('finds and updates a nested split node, leaving siblings untouched', () => {
    const nested: PaneSplit = {
      type: 'split',
      id: 'outer',
      orientation: 'row',
      children: [createLeaf('leaf-1'), tree],
    };

    const next = updateSplitWeights(nested, 'split-1', [0.2, 0.8]) as PaneSplit;
    expect((next.children[1] as PaneSplit).weights).toEqual([0.2, 0.8]);
    expect(next.children[0]).toBe(nested.children[0]); // untouched leaf keeps identity
  });

  it('is a no-op (same reference) when the split id is not found', () => {
    const next = updateSplitWeights(tree, 'nonexistent', [0.2, 0.8]);
    expect(next).toBe(tree);
  });

  it('returns a leaf unchanged', () => {
    const leaf = createLeaf('leaf-1');
    expect(updateSplitWeights(leaf, 'leaf-1', [0.2, 0.8])).toBe(leaf);
  });
});

describe('countOtherSessionPanes', () => {
  const tree: PaneSplit = {
    type: 'split',
    id: 'split-1',
    orientation: 'row',
    children: [
      createLeaf('keep', { local: true }),
      createLeaf('empty'),
      createLeaf('local', { local: true }),
      createLeaf('k8s', { k8sTarget: { podName: 'p' } as never }),
    ],
  };

  it('counts the other panes that hold a session and skips empty placeholders and the kept pane', () => {
    expect(countOtherSessionPanes(tree, 'keep')).toBe(2);
    expect(countOtherSessionPanes(tree, 'empty')).toBe(3);
  });

  it('is zero when no other pane has a session', () => {
    expect(countOtherSessionPanes(createLeaf('only', { local: true }), 'only')).toBe(0);
  });
});

describe('shouldHoistLocalPerf', () => {
  const split = (...children: PaneSplit['children']): PaneSplit => ({
    type: 'split',
    id: 's',
    orientation: 'row',
    children,
  });
  const ssh = { host: 'h', port: 22, username: 'u' } as never;

  it('hoists when two or more local shells share the tab', () => {
    expect(shouldHoistLocalPerf(split(createLeaf('a', { local: true }), createLeaf('b', { local: true })))).toBe(true);
  });

  it('keeps a lone local shell next to a remote pane on its own bar', () => {
    expect(shouldHoistLocalPerf(split(createLeaf('a', { local: true }), createLeaf('b', { config: ssh })))).toBe(false);
  });

  it('still hoists the local shells when a remote pane is present', () => {
    const tree = split(createLeaf('a', { local: true }), createLeaf('b', { local: true }), createLeaf('c', { config: ssh }));
    expect(shouldHoistLocalPerf(tree)).toBe(true);
  });

  it('does not hoist for a single pane', () => {
    expect(shouldHoistLocalPerf(createLeaf('a', { local: true }))).toBe(false);
  });
});

describe('split source connection', () => {
  const ssh = { id: 'p1', name: 'web', host: 'h', username: 'u', authType: 'agent' } as never;
  const connected = createLeaf('a', { config: ssh });

  it('offers the SSH connection of the pane that was split', () => {
    const { tree, newPaneId } = splitPane(connected, 'a', 'row', 't');
    expect(findLeaf(tree, newPaneId)?.splitFromPaneId).toBe('a');
    expect(splitSourceConfig(tree, newPaneId)).toBe(ssh);
  });

  it('passes the source on when a still empty pane is split again', () => {
    const first = splitPane(connected, 'a', 'row', 't');
    const second = splitPane(first.tree, first.newPaneId, 'column', 't');
    expect(splitSourceConfig(second.tree, second.newPaneId)).toBe(ssh);
  });

  it('offers nothing after splitting a local or empty pane, and adds no key', () => {
    for (const source of [createLeaf('a', { local: true }), createLeaf('a')]) {
      const { tree, newPaneId } = splitPane(source, 'a', 'row', 't');
      expect(findLeaf(tree, newPaneId)).toEqual({ type: 'leaf', id: newPaneId });
      expect(splitSourceConfig(tree, newPaneId)).toBeUndefined();
    }
  });

  it('offers nothing once the source is closed or no longer runs SSH', () => {
    const { tree, newPaneId } = splitPane(connected, 'a', 'row', 't');
    expect(splitSourceConfig(closePane(tree, 'a')!, newPaneId)).toBeUndefined();
    const local = updateLeaf(tree, 'a', (l) => ({ ...l, config: undefined, local: true }));
    expect(splitSourceConfig(local, newPaneId)).toBeUndefined();
  });

  it('offers nothing once the pane has a session of its own', () => {
    const { tree, newPaneId } = splitPane(connected, 'a', 'row', 't');
    const used = updateLeaf(tree, newPaneId, (l) => ({ ...l, local: true }));
    expect(splitSourceConfig(used, newPaneId)).toBeUndefined();
  });
});

describe('paneSftpConfig', () => {
  const ssh = { id: 'p1', host: 'h' } as never;
  const shell = { id: 'p2', host: 'i-0123456789abcdef0', ssm: { enabled: true, mode: 'shell' } } as never;
  const tree: PaneSplit = {
    type: 'split',
    id: 's',
    orientation: 'row',
    children: [createLeaf('a', { config: ssh }), createLeaf('b', { local: true }), createLeaf('c', { config: shell })],
  };

  it('takes the active pane, or the first one when none is active', () => {
    expect(paneSftpConfig(tree, 'a')).toBe(ssh);
    expect(paneSftpConfig(tree, undefined)).toBe(ssh);
  });

  it('has nothing for a local pane or a Session Manager shell', () => {
    expect(paneSftpConfig(tree, 'b')).toBeUndefined();
    expect(paneSftpConfig(tree, 'c')).toBeUndefined();
  });
});
