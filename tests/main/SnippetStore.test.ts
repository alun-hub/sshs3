import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

vi.mock('electron', () => {
  const mockObj = { app: { getPath: () => os.tmpdir() } };
  return { ...mockObj, default: mockObj };
});

import { SnippetStore } from '../../src/main/snippets/SnippetStore';

describe('SnippetStore', () => {
  let tempDir: string;
  let file: string;
  let store: SnippetStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-snip-test-'));
    file = path.join(tempDir, 'snippets.json');
    store = new SnippetStore(file);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('saves, lists and persists snippets across instances', async () => {
    const saved = await store.save({ name: ' Disk usage ', command: 'df -h' });
    expect(saved.name).toBe('Disk usage');
    expect(await new SnippetStore(file).list()).toEqual([saved]);
  });

  it('updates in place when the id exists', async () => {
    const a = await store.save({ name: 'a', command: 'one' });
    await store.save({ id: a.id, name: 'a2', command: 'two' });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: a.id, name: 'a2', command: 'two' });
  });

  it('lists global snippets plus those for the given host only', async () => {
    await store.save({ name: 'global', command: 'g' });
    await store.save({ name: 'h1', command: 'x', hostKey: 'ssh:1', hostLabel: 'one' });
    await store.save({ name: 'h2', command: 'y', hostKey: 'ssh:2', hostLabel: 'two' });
    expect((await store.list('ssh:1')).map((s) => s.name)).toEqual(['global', 'h1']);
    expect(await store.list()).toHaveLength(3);
  });

  it('deletes snippets', async () => {
    const a = await store.save({ name: 'a', command: 'x' });
    await store.delete(a.id);
    expect(await store.list()).toEqual([]);
  });

  it('rejects empty names and commands', async () => {
    await expect(store.save({ name: '  ', command: 'x' })).rejects.toThrow('Invalid snippet');
    await expect(store.save({ name: 'a', command: '  ' })).rejects.toThrow('Invalid snippet');
  });

  it('starts empty on a corrupted file but keeps a copy of it', async () => {
    await fs.writeFile(file, '{not json');
    expect(await new SnippetStore(file).list()).toEqual([]);
    expect(await fs.readFile(`${file}.corrupt`, 'utf-8')).toBe('{not json');
  });

  it('does not treat an unreadable file as empty', async () => {
    await fs.mkdir(file); // reading a directory fails with EISDIR, not ENOENT
    await expect(store.list()).rejects.toThrow();
    await expect(store.save({ name: 'a', command: 'x' })).rejects.toThrow();
  });
});
