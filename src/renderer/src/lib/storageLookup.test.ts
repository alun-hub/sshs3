// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statIfExists } from './storageLookup';

const entry = { name: 'a', path: '/a', size: 1, isDirectory: false };

function setApi(api: Record<string, unknown> | undefined) {
  (window as unknown as { multissh?: unknown }).multissh = api;
}

describe('statIfExists', () => {
  afterEach(() => setApi(undefined));

  it('does not stat a path that does not exist', async () => {
    const storageStat = vi.fn();
    setApi({ storageExists: vi.fn().mockResolvedValue(false), storageStat });
    await expect(statIfExists('local', '/nope')).resolves.toBeNull();
    expect(storageStat).not.toHaveBeenCalled();
  });

  it('returns the entry of an existing path', async () => {
    setApi({ storageExists: vi.fn().mockResolvedValue(true), storageStat: vi.fn().mockResolvedValue(entry) });
    await expect(statIfExists('local', '/a')).resolves.toEqual(entry);
  });

  it('lets the stat decide when the existence check fails or is unavailable', async () => {
    setApi({ storageExists: vi.fn().mockRejectedValue(new Error('no provider')), storageStat: vi.fn().mockResolvedValue(entry) });
    await expect(statIfExists('p', '/a')).resolves.toEqual(entry);
    setApi({ storageStat: vi.fn().mockResolvedValue(entry) });
    await expect(statIfExists('p', '/a')).resolves.toEqual(entry);
  });

  it('is null when the stat rejects or there is no api', async () => {
    setApi({ storageStat: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(statIfExists('p', '/a')).resolves.toBeNull();
    setApi(undefined);
    await expect(statIfExists('p', '/a')).resolves.toBeNull();
  });
});
