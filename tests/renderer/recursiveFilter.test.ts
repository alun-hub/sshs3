import { describe, it, expect } from 'vitest';
import type { FileEntry } from '../../src/shared/types/storage';
import { recursiveFilterFiles, RECURSIVE_MAX_RESULTS } from '../../src/renderer/src/lib/recursiveFilter';

const entry = (path: string, isDirectory = false, extra: Partial<FileEntry> = {}): FileEntry => ({
  name: path.split('/').pop() as string,
  path,
  size: 0,
  isDirectory,
  ...extra,
});

const tree: Record<string, FileEntry[]> = {
  '/r': [entry('/r/a.log'), entry('/r/sub', true), entry('/r/.hid', true), entry('/r/link', true, { isSymlink: true })],
  '/r/sub': [entry('/r/sub/b.log'), entry('/r/sub/deep', true)],
  '/r/sub/deep': [entry('/r/sub/deep/C.LOG')],
  '/r/.hid': [entry('/r/.hid/x.log')],
  '/r/link': [entry('/r/link/y.log')],
};

const run = (query: string, showHidden = false, list = async (_p: string, path: string) => tree[path] ?? []) => {
  let last: FileEntry[] = [];
  return recursiveFilterFiles({
    providerId: 'p',
    rootPath: '/r',
    query,
    showHidden,
    signal: new AbortController().signal,
    list,
    onResults: (e) => (last = e),
  }).then((summary) => ({ summary, results: last }));
};

describe('recursiveFilterFiles', () => {
  it('finds matches in subfolders case-insensitively with relative names and real paths', async () => {
    const { results } = await run('.log');
    expect(results.map((e) => e.name).sort()).toEqual(['a.log', 'sub/b.log', 'sub/deep/C.LOG']);
    expect(results.find((e) => e.name === 'sub/b.log')?.path).toBe('/r/sub/b.log');
  });

  it('skips hidden folders unless showHidden and never descends into symlinked folders', async () => {
    expect((await run('x.log')).results).toEqual([]);
    expect((await run('x.log', true)).results.map((e) => e.name)).toEqual(['.hid/x.log']);
    expect((await run('y.log', true)).results).toEqual([]);
  });

  it('counts unreadable folders instead of failing', async () => {
    const { summary, results } = await run('log', false, async (_p, path) => {
      if (path === '/r/sub') throw new Error('denied');
      return tree[path] ?? [];
    });
    expect(summary.skippedDirs).toBe(1);
    expect(results.map((e) => e.name)).toEqual(['a.log']);
  });

  it('truncates at the result cap', async () => {
    const many = Array.from({ length: RECURSIVE_MAX_RESULTS + 10 }, (_, i) => entry(`/r/f${i}.txt`));
    const { summary, results } = await run('f', false, async () => many);
    expect(summary.truncated).toBe(true);
    expect(results).toHaveLength(RECURSIVE_MAX_RESULTS);
  });

  it('stops without reporting when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await recursiveFilterFiles({
      providerId: 'p', rootPath: '/r', query: 'a', showHidden: false, signal: controller.signal,
      list: async () => [], onResults: () => { called = true; },
    });
    expect(called).toBe(false);
  });
});

import { makeNameMatcher } from '../../src/renderer/src/lib/nameFilter';

describe('makeNameMatcher', () => {
  it('substring without wildcards, anchored glob with * and ?', () => {
    expect(makeNameMatcher('log')('App.LOG.bak')).toBe(true);
    expect(makeNameMatcher('*.log')('a.LOG')).toBe(true);
    expect(makeNameMatcher('*.log')('a.log.bak')).toBe(false);
    expect(makeNameMatcher('app-?.txt')('app-1.txt')).toBe(true);
    expect(makeNameMatcher('app-?.txt')('app-12.txt')).toBe(false);
    expect(makeNameMatcher('a.b*')('aXb1')).toBe(false);
  });
});
