import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProfileStore } from '../../src/main/profile/ProfileStore';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';
import type { S3Config } from '../../src/shared/types/storage';

describe('ProfileStore', () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-profiles-test-'));
    storePath = path.join(tempDir, 'subfolder', 'profiles.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('returns empty profiles when file does not exist', async () => {
    const store = new ProfileStore(storePath);
    const profiles = await store.getProfiles();
    expect(profiles).toEqual({ ssh: [], s3: [] });
  });

  it('saves and retrieves SSH profiles', async () => {
    const store = new ProfileStore(storePath);
    const sshConfig: SSHConnectionConfig = {
      id: 'ssh-1',
      name: 'Production Server',
      host: 'prod.example.com',
      port: 22,
      username: 'admin',
      authType: 'password',
      password: 'secret',
    };

    await store.saveSSH(sshConfig);
    const profiles = await store.getProfiles();
    expect(profiles.ssh).toHaveLength(1);
    expect(profiles.ssh[0]).toEqual(sshConfig);

    // Verify persistence across new store instance
    const store2 = new ProfileStore(storePath);
    const profiles2 = await store2.getProfiles();
    expect(profiles2.ssh[0]).toEqual(sshConfig);
  });

  it('updates an existing SSH profile with the same ID', async () => {
    const store = new ProfileStore(storePath);
    const sshConfig: SSHConnectionConfig = {
      id: 'ssh-1',
      name: 'Old Server',
      host: 'old.example.com',
      username: 'admin',
      authType: 'password',
    };
    await store.saveSSH(sshConfig);

    const updatedConfig: SSHConnectionConfig = {
      ...sshConfig,
      name: 'Updated Server',
      port: 2222,
    };
    await store.saveSSH(updatedConfig);

    const profiles = await store.getProfiles();
    expect(profiles.ssh).toHaveLength(1);
    expect(profiles.ssh[0].name).toBe('Updated Server');
    expect(profiles.ssh[0].port).toBe(2222);
  });

  it('deletes an SSH profile by ID', async () => {
    const store = new ProfileStore(storePath);
    await store.saveSSH({
      id: 'ssh-1',
      name: 'Server 1',
      host: 's1.example.com',
      username: 'root',
      authType: 'password',
    });
    await store.saveSSH({
      id: 'ssh-2',
      name: 'Server 2',
      host: 's2.example.com',
      username: 'root',
      authType: 'password',
    });

    await store.deleteSSH('ssh-1');
    const profiles = await store.getProfiles();
    expect(profiles.ssh).toHaveLength(1);
    expect(profiles.ssh[0].id).toBe('ssh-2');
  });

  it('deleting non-existent SSH profile does not fail', async () => {
    const store = new ProfileStore(storePath);
    await store.deleteSSH('non-existent');
    const profiles = await store.getProfiles();
    expect(profiles.ssh).toHaveLength(0);
  });

  it('saves and retrieves S3 profiles', async () => {
    const store = new ProfileStore(storePath);
    const s3Config: S3Config = {
      id: 's3-1',
      name: 'MinIO Backup',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'miniopass',
    };

    await store.saveS3(s3Config);
    const profiles = await store.getProfiles();
    expect(profiles.s3).toHaveLength(1);
    expect(profiles.s3[0]).toEqual(s3Config);
  });

  it('updates an existing S3 profile with the same ID', async () => {
    const store = new ProfileStore(storePath);
    const s3Config: S3Config = {
      id: 's3-1',
      name: 'Original S3',
      region: 'us-east-1',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    };
    await store.saveS3(s3Config);

    const updatedConfig: S3Config = {
      ...s3Config,
      name: 'Updated S3',
      endpoint: 'https://s3.eu-central-1.amazonaws.com',
    };
    await store.saveS3(updatedConfig);

    const profiles = await store.getProfiles();
    expect(profiles.s3).toHaveLength(1);
    expect(profiles.s3[0].name).toBe('Updated S3');
    expect(profiles.s3[0].endpoint).toBe('https://s3.eu-central-1.amazonaws.com');
  });

  it('deletes an S3 profile by ID', async () => {
    const store = new ProfileStore(storePath);
    await store.saveS3({
      id: 's3-1',
      name: 'S3 1',
      region: 'us-east-1',
      accessKeyId: 'k1',
      secretAccessKey: 's1',
    });
    await store.deleteS3('s3-1');

    const profiles = await store.getProfiles();
    expect(profiles.s3).toHaveLength(0);
  });

  it('handles corrupted JSON file gracefully', async () => {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, '{ corrupted json: true !!!', 'utf-8');

    const store = new ProfileStore(storePath);
    const profiles = await store.getProfiles();
    expect(profiles).toEqual({ ssh: [], s3: [] });
  });

  it('throws error when saving configuration without ID', async () => {
    const store = new ProfileStore(storePath);
    await expect(
      store.saveSSH({
        id: '',
        name: 'Invalid',
        host: 'example.com',
        username: 'user',
        authType: 'password',
      })
    ).rejects.toThrow('Profile ID is required');

    await expect(
      store.saveS3({
        id: '',
        name: 'Invalid',
        region: 'us-east-1',
        accessKeyId: 'k',
        secretAccessKey: 's',
      })
    ).rejects.toThrow('Profile ID is required');
  });
});
