import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';
import { S3ContentSearchService } from '../../src/main/search/S3ContentSearchService';
import { StorageRegistry } from '../../src/main/storage/StorageRegistry';
import type { S3Config } from '../../src/shared/types/storage';
import type { SearchStartOptions } from '../../src/shared/types/search';

const clientSendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    public send = clientSendMock;
    constructor(_config: any) {}
  }
  class ListObjectsV2Command {
    constructor(public input: any) {}
  }
  class GetObjectCommand {
    constructor(public input: any) {}
  }
  return { S3Client, ListObjectsV2Command, GetObjectCommand };
});

import { S3StorageProvider } from '../../src/main/storage/S3StorageProvider';

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(check, 5);
    };
    check();
  });
}

describe('S3ContentSearchService', () => {
  let registry: StorageRegistry;
  let service: S3ContentSearchService;

  const config: S3Config = {
    id: 's3-test',
    name: 'Test Bucket',
    region: 'us-east-1',
    accessKeyId: 'AKIA',
    secretAccessKey: 'secret',
  };

  beforeEach(() => {
    clientSendMock.mockReset();
    registry = new StorageRegistry();
    service = new S3ContentSearchService();
    registry.register(new S3StorageProvider(config));
  });

  function baseOptions(overrides: Partial<SearchStartOptions> = {}): SearchStartOptions {
    return {
      providerId: 's3-test',
      sourceType: 's3',
      rootPath: '/my-bucket',
      query: 'needle',
      mode: 'literal',
      caseSensitive: false,
      ...overrides,
    };
  }

  it('lists objects under the prefix, downloads each, and reports matches', async () => {
    clientSendMock.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [
            { Key: 'a.log', Size: 100 },
            { Key: 'b.log', Size: 100 },
          ],
          NextContinuationToken: undefined,
        };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        const body =
          command.input.Key === 'a.log'
            ? Readable.from(['no match here\n'])
            : Readable.from(['line one\n', 'contains needle right here\n']);
        return { Body: body };
      }
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    });

    const results: any[] = [];
    const done: any[] = [];
    await service.startSearch(registry, baseOptions(), (e) => results.push(...e.matches), () => {}, (e) => done.push(e));

    await waitFor(() => done.length === 1);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      path: '/my-bucket/b.log',
      displayPath: 'b.log',
      lineNumber: 2,
      source: 's3-download',
    });
    expect(done[0]).toMatchObject({ matchCount: 1, scannedCount: 2, cancelled: false, truncated: false });
  });

  it('skips objects larger than maxFileSizeBytes without downloading them', async () => {
    clientSendMock.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return { Contents: [{ Key: 'huge.log', Size: 999_999_999 }], NextContinuationToken: undefined };
      }
      throw new Error('GetObjectCommand should not be called for an oversized object');
    });

    const errors: any[] = [];
    const done: any[] = [];
    await service.startSearch(
      registry,
      baseOptions({ maxFileSizeBytes: 1024 }),
      () => {},
      (e) => errors.push(e),
      (e) => done.push(e)
    );

    await waitFor(() => done.length === 1);
    expect(done[0]).toMatchObject({ scannedCount: 0, matchCount: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '/my-bucket/huge.log', fatal: false });
    expect(errors[0].message).toContain('exceeds size cap');
  });

  it('applies include/exclude glob filters to object keys', async () => {
    clientSendMock.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [
            { Key: 'keep.csv', Size: 10 },
            { Key: 'skip.txt', Size: 10 },
            { Key: 'excluded.min.csv', Size: 10 },
          ],
          NextContinuationToken: undefined,
        };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        return { Body: Readable.from(['needle\n']) };
      }
      throw new Error('unexpected');
    });

    const results: any[] = [];
    const done: any[] = [];
    await service.startSearch(
      registry,
      baseOptions({ includeGlobs: ['*.csv'], excludeGlobs: ['*.min.csv'] }),
      (e) => results.push(...e.matches),
      () => {},
      (e) => done.push(e)
    );

    await waitFor(() => done.length === 1);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('/my-bucket/keep.csv');
  });

  it('reports non-fatal errors for objects that fail to download without aborting the search', async () => {
    clientSendMock.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return { Contents: [{ Key: 'broken.log', Size: 10 }], NextContinuationToken: undefined };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        throw new Error('access denied');
      }
      throw new Error('unexpected');
    });

    const errors: any[] = [];
    const done: any[] = [];
    await service.startSearch(registry, baseOptions(), () => {}, (e) => errors.push(e), (e) => done.push(e));

    await waitFor(() => done.length === 1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ path: '/my-bucket/broken.log', fatal: false });
    expect(errors[0].message).toContain('access denied');
  });

  it('cancelSearch stops further processing and marks the done event cancelled', async () => {
    const pendingGetResolvers: Array<() => void> = [];
    clientSendMock.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return {
          Contents: [
            { Key: 'a.log', Size: 10 },
            { Key: 'b.log', Size: 10 },
          ],
          NextContinuationToken: undefined,
        };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        await new Promise<void>((resolve) => {
          pendingGetResolvers.push(resolve);
        });
        return { Body: Readable.from(['needle\n']) };
      }
      throw new Error('unexpected');
    });

    const done: any[] = [];
    const { searchId } = await service.startSearch(registry, baseOptions(), () => {}, () => {}, (e) => done.push(e));

    await waitFor(() => pendingGetResolvers.length === 2);
    service.cancelSearch(searchId);
    pendingGetResolvers.forEach((resolve) => resolve());

    await waitFor(() => done.length === 1);
    expect(done[0]).toMatchObject({ cancelled: true });
  });

  it('emits progress heartbeats while scanning', async () => {
    clientSendMock.mockImplementation(async (command: any) => {
      if (command.constructor.name === 'ListObjectsV2Command') {
        return { Contents: [{ Key: 'a.log', Size: 10 }], NextContinuationToken: undefined };
      }
      if (command.constructor.name === 'GetObjectCommand') {
        // Slow enough that the 300ms progress heartbeat has time to fire before this resolves.
        await new Promise((resolve) => setTimeout(resolve, 350));
        return { Body: Readable.from(['needle\n']) };
      }
      throw new Error('unexpected');
    });

    const progress: any[] = [];
    const done: any[] = [];
    await service.startSearch(
      registry,
      baseOptions(),
      () => {},
      () => {},
      (e) => done.push(e),
      (e) => progress.push(e)
    );

    await waitFor(() => done.length === 1, 3000);

    expect(progress.length).toBeGreaterThanOrEqual(1);
    expect(progress[0]).toMatchObject({ scannedCount: 1, currentPath: 'a.log' });
  });
});
