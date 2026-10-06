import { describe, it, expect } from 'vitest';
import { buildTree, computeDiff } from '../../src/main/dirsync/DirectorySyncService';
import type { FileEntry } from '../../src/shared/types/storage';

type Node = FileEntry[] | Error;

/** A fake provider whose directory listings are given as path -> entries (or an Error to throw). */
function fakeProvider(tree: Record<string, Node>) {
  return {
    type: 'local',
    list: async (p: string) => {
      const node = tree[p];
      if (node instanceof Error) throw node;
      if (!node) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      return node;
    },
  } as any;
}

const file = (dir: string, name: string): FileEntry =>
  ({ name, path: `${dir}/${name}`, isDirectory: false, size: 1, modifiedTime: 1 }) as any;
const dir = (parent: string, name: string, extra: Partial<FileEntry> = {}): FileEntry =>
  ({ name, path: `${parent}/${name}`, isDirectory: true, size: 0, modifiedTime: 1, ...extra }) as any;

describe('DirectorySyncService', () => {
  it('treats a missing root as empty', async () => {
    const tree = await buildTree(fakeProvider({}), '/missing');
    expect(tree.size).toBe(0);
  });

  it('rethrows a non-"not found" failure listing the root instead of treating it as empty', async () => {
    const provider = fakeProvider({ '/src': new Error('Connection lost') });
    await expect(buildTree(provider, '/src')).rejects.toThrow('Connection lost');
  });

  it('does not follow symlinked directories', async () => {
    const provider = fakeProvider({
      '/src': [dir('/src', 'loop', { isSymlink: true }), file('/src', 'a.txt')],
      '/src/loop': [file('/src/loop', 'inner.txt')],
    });
    const tree = await buildTree(provider, '/src');
    expect([...tree.keys()].sort()).toEqual(['a.txt', 'loop']);
  });

  it('does not report target entries below an unreadable source folder as only-target', async () => {
    const source = fakeProvider({
      '/src': [dir('/src', 'locked'), file('/src', 'a.txt')],
      '/src/locked': new Error('EACCES: permission denied'),
    });
    const target = fakeProvider({
      '/dst': [dir('/dst', 'locked'), file('/dst', 'a.txt'), file('/dst', 'extra.txt')],
      '/dst/locked': [file('/dst/locked', 'keep.txt')],
    });

    const diff = await computeDiff(source, '/src', target, '/dst');

    expect(diff.skippedPaths.source).toEqual(['locked']);
    const onlyTarget = diff.entries.filter((e) => e.status === 'only-target').map((e) => e.relativePath);
    expect(onlyTarget).toEqual(['extra.txt']);
  });
});
