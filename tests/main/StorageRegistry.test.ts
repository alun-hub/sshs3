import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageRegistry } from '../../src/main/storage/StorageRegistry';
import { LocalStorageProvider } from '../../src/main/storage/LocalStorageProvider';
import { SFTPStorageProvider } from '../../src/main/storage/SFTPStorageProvider';
import { S3StorageProvider } from '../../src/main/storage/S3StorageProvider';
import { K8sPodStorageProvider } from '../../src/main/storage/K8sPodStorageProvider';

describe('StorageRegistry', () => {
  let registry: StorageRegistry;

  beforeEach(() => {
    registry = new StorageRegistry();
  });

  afterEach(async () => {
    await registry.disconnectAll();
  });

  it('creates and returns a LocalStorageProvider', async () => {
    const provider = await registry.getOrCreate({
      id: 'local-1',
      name: 'Local Provider',
      type: 'local',
      localBasePath: '/tmp',
    });

    expect(provider).toBeInstanceOf(LocalStorageProvider);
    expect(provider.id).toBe('local-1');
    expect(registry.get('local-1')).toBe(provider);
    expect(registry.has('local-1')).toBe(true);
  });

  it('reuses existing provider if already created', async () => {
    const provider1 = await registry.getOrCreate({
      id: 'local-1',
      name: 'Local',
      type: 'local',
    });

    const provider2 = await registry.getOrCreate({
      id: 'local-1',
      name: 'Local Renamed',
      type: 'local',
    });

    expect(provider1).toBe(provider2);
  });

  it('creates an SFTPStorageProvider with sftpConfig', async () => {
    const provider = await registry.getOrCreate({
      id: 'sftp-1',
      name: 'SFTP Provider',
      type: 'sftp',
      sftpConfig: {
        host: 'sftp.example.com',
        port: 22,
        username: 'user',
        authType: 'password',
        password: 'pass',
      },
    });

    expect(provider).toBeInstanceOf(SFTPStorageProvider);
    expect(provider.id).toBe('sftp-1');
  });

  it('builds a per-host SFTP host-key verifier via sftpHostVerifierFactory', async () => {
    const fakeVerifier = vi.fn();
    const factory = vi.fn().mockReturnValue(fakeVerifier);
    const registryWithFactory = new StorageRegistry({ sftpHostVerifierFactory: factory });

    await registryWithFactory.getOrCreate({
      id: 'sftp-hv',
      name: 'SFTP HV',
      type: 'sftp',
      sftpConfig: {
        host: 'hv.example.com',
        port: 2222,
        username: 'user',
        authType: 'password',
        password: 'pass',
      },
    });

    expect(factory).toHaveBeenCalledWith('hv.example.com', 2222);
    await registryWithFactory.disconnectAll();
  });

  it('defaults the host-key verifier factory port to 22 when unset', async () => {
    const factory = vi.fn().mockReturnValue(vi.fn());
    const registryWithFactory = new StorageRegistry({ sftpHostVerifierFactory: factory });

    await registryWithFactory.getOrCreate({
      id: 'sftp-hv-default-port',
      name: 'SFTP HV',
      type: 'sftp',
      sftpConfig: {
        host: 'hv2.example.com',
        username: 'user',
        authType: 'password',
        password: 'pass',
      } as any,
    });

    expect(factory).toHaveBeenCalledWith('hv2.example.com', 22);
    await registryWithFactory.disconnectAll();
  });

  it('throws when creating SFTPStorageProvider without sftpConfig', async () => {
    await expect(
      registry.getOrCreate({
        id: 'sftp-invalid',
        name: 'Invalid SFTP',
        type: 'sftp',
      })
    ).rejects.toThrow('SFTP config is required');
  });

  it('creates an S3StorageProvider with s3Config', async () => {
    const provider = await registry.getOrCreate({
      id: 's3-1',
      name: 'S3 Provider',
      type: 's3',
      s3Config: {
        id: 's3-1',
        name: 'S3',
        region: 'us-east-1',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    });

    expect(provider).toBeInstanceOf(S3StorageProvider);
    expect(provider.id).toBe('s3-1');
  });

  it('throws when creating S3StorageProvider without s3Config', async () => {
    await expect(
      registry.getOrCreate({
        id: 's3-invalid',
        name: 'Invalid S3',
        type: 's3',
      })
    ).rejects.toThrow('S3 config is required');
  });

  it('creates a K8sPodStorageProvider with k8sConfig', async () => {
    const provider = await registry.getOrCreate({
      id: 'k8s-ctx/ns/pod/container',
      name: 'pod (container)',
      type: 'k8s',
      k8sConfig: {
        id: 'k8s-ctx/ns/pod/container',
        name: 'pod (container)',
        contextName: 'ctx',
        namespace: 'ns',
        podName: 'pod',
        containerName: 'container',
      },
    });

    expect(provider).toBeInstanceOf(K8sPodStorageProvider);
    expect(provider.id).toBe('k8s-ctx/ns/pod/container');
  });

  it('throws when creating K8sPodStorageProvider without k8sConfig', async () => {
    await expect(
      registry.getOrCreate({
        id: 'k8s-invalid',
        name: 'Invalid K8s',
        type: 'k8s',
      })
    ).rejects.toThrow('Kubernetes storage config is required');
  });

  it('throws on unsupported storage type', async () => {
    await expect(
      registry.getOrCreate({
        id: 'bad-1',
        name: 'Bad',
        type: 'unknown' as any,
      })
    ).rejects.toThrow('Unsupported storage type');
  });

  it('allows manual provider registration and retrieval', () => {
    const mockProvider: any = { id: 'custom-1', name: 'Custom', type: 'local' };
    registry.register(mockProvider);
    expect(registry.get('custom-1')).toBe(mockProvider);
    expect(registry.getAll()).toHaveLength(1);
  });

  it('disconnects and removes single provider', async () => {
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    const mockProvider: any = {
      id: 'custom-1',
      name: 'Custom',
      type: 'local',
      disconnect: disconnectFn,
    };
    registry.register(mockProvider);

    await registry.disconnect('custom-1');
    expect(disconnectFn).toHaveBeenCalled();
    expect(registry.has('custom-1')).toBe(false);
  });

  it('disconnects all providers on disconnectAll', async () => {
    const d1 = vi.fn().mockResolvedValue(undefined);
    const d2 = vi.fn().mockResolvedValue(undefined);
    registry.register({ id: 'p1', name: 'P1', type: 'local', disconnect: d1 } as any);
    registry.register({ id: 'p2', name: 'P2', type: 'local', disconnect: d2 } as any);

    await registry.disconnectAll();
    expect(d1).toHaveBeenCalled();
    expect(d2).toHaveBeenCalled();
    expect(registry.getAll()).toHaveLength(0);
  });
});
