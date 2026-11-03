import { describe, it, expect } from 'vitest';
import { isSyncTargetChanged } from '../../src/main/services/syncTargetIdentity';
import type { StorageConnectConfig } from '../../src/shared/types/ipc';

// The renderer gives every sync target the same id, so the id says nothing about where the data lives.
const sftp = (over: Record<string, unknown> = {}): StorageConnectConfig => ({
  id: 'sshs3-remote-profile-sync',
  name: 'Remote profile sync',
  type: 'sftp',
  sftpConfig: { host: 'Backup.Example.com', port: 22, username: 'sync', authType: 'password', password: 'a', ...over } as any,
});
const s3 = (over: Record<string, unknown> = {}): StorageConnectConfig => ({
  id: 'sshs3-remote-profile-sync',
  name: 'Remote profile sync',
  type: 's3',
  s3Config: { id: 'x', name: 'x', region: 'eu-north-1', accessKeyId: 'k', secretAccessKey: 's', ...over } as any,
});

describe('isSyncTargetChanged', () => {
  it('is false when nothing was configured before (first setup)', () => {
    expect(isSyncTargetChanged({}, { target: sftp(), remoteBasePath: '/sync' })).toBe(false);
  });

  it('ignores credentials, auth type and letter case of the host', () => {
    const prev = { target: sftp(), remoteBasePath: '/sync' };
    expect(isSyncTargetChanged(prev, { target: sftp({ password: 'b', host: 'backup.example.com', authType: 'privateKey' }), remoteBasePath: '/sync' })).toBe(false);
    expect(isSyncTargetChanged({ target: s3(), remoteBasePath: 'bkt' }, { target: s3({ accessKeyId: 'other', secretAccessKey: 'other' }), remoteBasePath: 'bkt' })).toBe(false);
  });

  it('treats a trailing slash and a missing port the same as before', () => {
    expect(isSyncTargetChanged({ target: sftp({ port: 22 }), remoteBasePath: '/sync/' }, { target: sftp({ port: undefined }), remoteBasePath: '/sync' })).toBe(false);
  });

  it('detects a different host, port, user or base path on SFTP', () => {
    const prev = { target: sftp(), remoteBasePath: '/sync' };
    expect(isSyncTargetChanged(prev, { target: sftp({ host: 'other.example.com' }), remoteBasePath: '/sync' })).toBe(true);
    expect(isSyncTargetChanged(prev, { target: sftp({ port: 2222 }), remoteBasePath: '/sync' })).toBe(true);
    expect(isSyncTargetChanged(prev, { target: sftp({ username: 'someone-else' }), remoteBasePath: '/sync' })).toBe(true);
    expect(isSyncTargetChanged(prev, { target: sftp(), remoteBasePath: '/other' })).toBe(true);
  });

  it('detects a different bucket (in the base path), endpoint or region on S3', () => {
    const prev = { target: s3(), remoteBasePath: 'bkt/prefix' };
    expect(isSyncTargetChanged(prev, { target: s3(), remoteBasePath: 'other-bkt/prefix' })).toBe(true);
    expect(isSyncTargetChanged(prev, { target: s3({ endpoint: 'https://minio.local' }), remoteBasePath: 'bkt/prefix' })).toBe(true);
    expect(isSyncTargetChanged(prev, { target: s3({ region: 'us-east-1' }), remoteBasePath: 'bkt/prefix' })).toBe(true);
  });

  it('detects a switch between SFTP and S3', () => {
    expect(isSyncTargetChanged({ target: sftp(), remoteBasePath: '' }, { target: s3(), remoteBasePath: '' })).toBe(true);
  });
});
