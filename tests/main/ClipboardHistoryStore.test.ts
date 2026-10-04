import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

const { mockIsEncryptionAvailable } = vi.hoisted(() => ({
  mockIsEncryptionAvailable: vi.fn().mockReturnValue(true),
}));

vi.mock('electron', () => {
  const mockObj = {
    app: { getPath: () => os.tmpdir() },
    safeStorage: {
      isEncryptionAvailable: mockIsEncryptionAvailable,
      encryptString: (v: string) => Buffer.from(`cipher:${v}`, 'utf-8'),
      decryptString: (b: Buffer) => b.toString('utf-8').replace(/^cipher:/, ''),
    },
  };
  return { ...mockObj, default: mockObj };
});

import { ClipboardHistoryStore } from '../../src/main/clipboard/ClipboardHistoryStore';
import { CLIPBOARD_HISTORY_MAX_ENTRIES } from '../../src/shared/types/clipboard';

describe('ClipboardHistoryStore', () => {
  let tempDir: string;
  let file: string;
  let store: ClipboardHistoryStore;

  beforeEach(async () => {
    mockIsEncryptionAvailable.mockReturnValue(true);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-clip-test-'));
    file = path.join(tempDir, 'clipboard-history.json');
    store = new ClipboardHistoryStore(file);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('lists newest first and moves duplicates to the top', async () => {
    await store.add('one', 'h1', 'Host 1');
    await store.add('two', 'h1', 'Host 1');
    await store.add('one', 'h1', 'Host 1');
    expect((await store.list()).map((e) => e.text)).toEqual(['one', 'two']);
  });

  it('filters by host key', async () => {
    await store.add('a', 'h1', 'Host 1');
    await store.add('b', 'h2', 'Host 2');
    expect((await store.list('h2')).map((e) => e.text)).toEqual(['b']);
    expect(await store.list()).toHaveLength(2);
  });

  it('survives a restart and never writes plaintext to disk', async () => {
    await store.add('s3cret-token', 'h1', 'Host 1');
    const raw = await fs.readFile(file, 'utf-8');
    expect(raw).not.toContain('s3cret-token');
    const reopened = new ClipboardHistoryStore(file);
    expect((await reopened.list()).map((e) => e.text)).toEqual(['s3cret-token']);
  });

  it('keeps history in memory only when no keyring is available', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false);
    await store.add('secret', 'h1', 'Host 1');
    await expect(fs.access(file)).rejects.toThrow();
    expect(await store.list()).toHaveLength(1);
  });

  it('deletes single entries and clears everything', async () => {
    await store.add('a', 'h1', 'Host 1');
    await store.add('b', 'h1', 'Host 1');
    const [first] = await store.list();
    await store.delete(first.id);
    expect((await store.list()).map((e) => e.text)).toEqual(['a']);
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it('caps the number of entries and ignores empty or oversized text', async () => {
    await store.add('', 'h1', 'Host 1');
    await store.add('x'.repeat(100_001), 'h1', 'Host 1');
    expect(await store.list()).toEqual([]);
    for (let i = 0; i < CLIPBOARD_HISTORY_MAX_ENTRIES + 5; i++) await store.add(`e${i}`, 'h1', 'Host 1');
    expect(await store.list()).toHaveLength(CLIPBOARD_HISTORY_MAX_ENTRIES);
  });

  it('starts empty when the file is corrupted', async () => {
    await fs.writeFile(file, 'not json');
    expect(await store.list()).toEqual([]);
  });
});
