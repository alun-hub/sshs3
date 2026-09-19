import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const { mockEncryptString, mockDecryptString, mockIsEncryptionAvailable } = vi.hoisted(() => {
  return {
    mockEncryptString: vi.fn((value: string) => Buffer.from(`cipher:${value}`, 'utf-8')),
    mockDecryptString: vi.fn((buf: Buffer) => buf.toString('utf-8').replace(/^cipher:/, '')),
    mockIsEncryptionAvailable: vi.fn().mockReturnValue(true),
  };
});

vi.mock('electron', () => {
  const mockObj = {
    app: { getPath: vi.fn().mockReturnValue('/tmp/user-data') },
    safeStorage: {
      isEncryptionAvailable: mockIsEncryptionAvailable,
      encryptString: mockEncryptString,
      decryptString: mockDecryptString,
    },
  };
  return { ...mockObj, default: mockObj };
});

import { SyncConfigStore } from '../../src/main/services/SyncConfigStore';
import type { StorageConnectConfig } from '../../src/shared/types/ipc';

describe('SyncConfigStore', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    mockIsEncryptionAvailable.mockReturnValue(true);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-sync-config-test-'));
    storePath = path.join(tempDir, 'sync-config.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns an empty config when no file exists yet', async () => {
    const store = new SyncConfigStore(storePath);
    expect(await store.getConfig()).toEqual({});
  });

  it('encrypts the sync target credentials at rest and decrypts them on read', async () => {
    const store = new SyncConfigStore(storePath);
    const target: StorageConnectConfig = {
      id: 'sync-target',
      name: 'My Sync Bucket',
      type: 's3',
      s3Config: { id: 'sync-target', name: 'My Sync Bucket', region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'top-secret' },
    };
    await store.setTarget(target);

    const raw = await fs.readFile(storePath, 'utf-8');
    expect(raw).not.toContain('top-secret');

    const config = await store.getConfig();
    expect(config.target?.s3Config?.secretAccessKey).toBe('top-secret');
    expect(config.target?.s3Config?.accessKeyId).toBe('AKIA');
  });

  it('persists salts independently without clobbering the other one', async () => {
    const store = new SyncConfigStore(storePath);
    const topologySalt = Buffer.from('topology-salt-bytes');
    await store.setSalts({ topologySalt });

    let config = await store.getConfig();
    expect(config.topologySaltBase64).toBe(topologySalt.toString('base64'));
    expect(config.credentialsSaltBase64).toBeUndefined();

    const credentialsSalt = Buffer.from('credentials-salt-bytes');
    await store.setSalts({ credentialsSalt });

    config = await store.getConfig();
    expect(config.topologySaltBase64).toBe(topologySalt.toString('base64'));
    expect(config.credentialsSaltBase64).toBe(credentialsSalt.toString('base64'));
  });

  it('records the last successful sync timestamp', async () => {
    const store = new SyncConfigStore(storePath);
    await store.setLastSyncAt('2026-01-01T00:00:00.000Z');
    expect((await store.getConfig()).lastSyncAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('persists autoSync setting', async () => {
    const store = new SyncConfigStore(storePath);
    expect((await store.getConfig()).autoSync).toBeUndefined();
    await store.setAutoSync(true);
    expect((await store.getConfig()).autoSync).toBe(true);
    await store.setAutoSync(false);
    expect((await store.getConfig()).autoSync).toBe(false);
  });
});
