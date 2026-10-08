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

import { TeamVaultConfigStore } from '../../src/main/services/TeamVaultConfigStore';
import type { StorageConnectConfig } from '../../src/shared/types/ipc';

describe('TeamVaultConfigStore', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    mockIsEncryptionAvailable.mockReturnValue(true);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-team-vault-config-test-'));
    storePath = path.join(tempDir, 'team-vault-sync-config.json');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns an empty config when no file exists yet', async () => {
    const store = new TeamVaultConfigStore(storePath);
    expect(await store.getConfig()).toEqual({});
  });

  it('encrypts the S3 target credentials at rest and decrypts them on read', async () => {
    const store = new TeamVaultConfigStore(storePath);
    const target: StorageConnectConfig = {
      id: 'team-vault-target',
      name: 'Team Vault Bucket',
      type: 's3',
      s3Config: {
        id: 'team-vault-target',
        name: 'Team Vault Bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'top-secret',
      },
    };
    await store.setTarget(target, 'team-bucket/prefix');

    const raw = await fs.readFile(storePath, 'utf-8');
    expect(raw).not.toContain('top-secret');

    const config = await store.getConfig();
    expect(config.target?.s3Config?.secretAccessKey).toBe('top-secret');
    expect(config.target?.s3Config?.accessKeyId).toBe('AKIA');
    expect(config.remoteBasePath).toBe('team-bucket/prefix');
  });

  it('records the last successful sync timestamp', async () => {
    const store = new TeamVaultConfigStore(storePath);
    await store.setLastSyncAt('2026-01-01T00:00:00.000Z');
    expect((await store.getConfig()).lastSyncAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('clear() resets the target and every other field', async () => {
    const store = new TeamVaultConfigStore(storePath);
    await store.setTarget({
      id: 'team-vault-target',
      name: 'Team Vault Bucket',
      type: 's3',
      s3Config: {
        id: 'team-vault-target',
        name: 'Team Vault Bucket',
        region: 'us-east-1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'top-secret',
      },
    });
    await store.setLastSyncAt('2026-01-01T00:00:00.000Z');

    await store.clear();

    expect(await store.getConfig()).toEqual({});
  });
});
