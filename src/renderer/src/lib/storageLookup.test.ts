// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupPath, statIfExists } from './storageLookup';

const entry = { name: 'a', path: '/a', size: 1, isDirectory: false };

function setApi(api: Record<string, unknown> | undefined) {
  (window as unknown as { multissh?: unknown }).multissh = api;
}

describe('lookupPath', () => {
  afterEach(() => setApi(undefined));

  it('asks storageLookup once, for an existing and a missing path', async () => {
    const storageLookup = vi.fn().mockResolvedValueOnce(entry).mockResolvedValueOnce(null);
    const storageStat = vi.fn();
    setApi({ storageLookup, storageStat });
    await expect(lookupPath('local', '/a')).resolves.toEqual(entry);
    await expect(lookupPath('local', '/nope')).resolves.toBeNull();
    expect(storageLookup).toHaveBeenCalledTimes(2);
    expect(storageStat).not.toHaveBeenCalled();
  });

  it('rejects for other failures instead of calling them a miss', async () => {
    setApi({ storageLookup: vi.fn().mockRejectedValue(new Error('Connection lost')) });
    await expect(lookupPath('p', '/a')).rejects.toThrow('Connection lost');
  });

  it('falls back to storageStat when storageLookup is not available, and rejects without any api', async () => {
    setApi({ storageStat: vi.fn().mockResolvedValue(entry) });
    await expect(lookupPath('p', '/a')).resolves.toEqual(entry);
    setApi(undefined);
    await expect(lookupPath('p', '/a')).rejects.toThrow();
  });
});

describe('statIfExists', () => {
  afterEach(() => setApi(undefined));

  it('returns the entry, or null for a miss or any failure', async () => {
    setApi({ storageLookup: vi.fn().mockResolvedValue(entry) });
    await expect(statIfExists('p', '/a')).resolves.toEqual(entry);
    setApi({ storageLookup: vi.fn().mockResolvedValue(null) });
    await expect(statIfExists('p', '/a')).resolves.toBeNull();
    setApi({ storageLookup: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(statIfExists('p', '/a')).resolves.toBeNull();
  });
});
