import { describe, it, expect } from 'vitest';
import { countOtherSessionPanes, createLeaf, updateSplitWeights } from '../../src/renderer/src/lib/paneTree';
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
