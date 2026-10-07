import os from 'node:os';
import { IPC_CHANNELS, type StorageConnectConfig } from '../../shared/types/ipc';
import type { FileEntry, ObjectMetadata, S3Tag, BucketVersioningInfo, ObjectVersionEntry, SpaceInfo, VolumeInfo } from '../../shared/types/storage';
import type { IpcBridge } from '../IpcBridge';
import type { SmartcardCoordinator } from '../smartcard/SmartcardCoordinator';

/** The part of IpcBridge this handler group may use. */
export type StorageHost = Pick<
  IpcBridge,
  'registerHandler' | 'requireS3Capability' | 'resolveProxyJumpConfig' | 'storageRegistry'
> & {
  smartcard: Pick<
    SmartcardCoordinator,
    'awaitStartupUnlock' | 'cleanupSmartcardSessionAgent' | 'prepareFido2SftpConfig' | 'prepareSftpSmartcardConfig'
  >;
};

export function registerStorageHandlers(bridge: StorageHost): void {
  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_CONNECT,
    async (_event, config: StorageConnectConfig) => {
      let resolvedConfig = config;
      if (config.type === 'sftp') {
        // A startup unlock error does not block a background connect.
        await bridge.smartcard.awaitStartupUnlock();
      }
      if (config.type === 'sftp' && config.sftpConfig && !bridge.storageRegistry.has(config.id)) {
        let sftpConfig = await bridge.resolveProxyJumpConfig(config.sftpConfig);
        sftpConfig = await bridge.smartcard.prepareSftpSmartcardConfig(sftpConfig, config.id);
        sftpConfig = await bridge.smartcard.prepareFido2SftpConfig(sftpConfig, config.id);
        resolvedConfig = { ...config, sftpConfig };
      }
      await bridge.storageRegistry.getOrCreate(resolvedConfig);
      return { id: config.id };
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_DISCONNECT,
    async (_event, providerId: string) => {
      await bridge.storageRegistry.disconnect(providerId);
      void bridge.smartcard.cleanupSmartcardSessionAgent(providerId);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_LIST,
    async (_event, providerId: string, remotePath: string, force?: boolean): Promise<FileEntry[]> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      return await (provider as any).list(remotePath, { force });
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_STAT,
    async (_event, providerId: string, remotePath: string): Promise<FileEntry> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      return await provider.stat(remotePath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_CREATE_FOLDER,
    async (_event, providerId: string, remotePath: string): Promise<void> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      await provider.createFolder(remotePath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_DELETE,
    async (_event, providerId: string, remotePath: string, isDirectory: boolean): Promise<void> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      await provider.delete(remotePath, isDirectory);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_RENAME,
    async (_event, providerId: string, oldPath: string, newPath: string): Promise<void> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      await provider.rename(oldPath, newPath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_CHMOD,
    async (_event, providerId: string, remotePath: string, mode: number | string): Promise<void> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      if (typeof provider.chmod !== 'function') {
        throw new Error(`Storage provider "${providerId}" does not support chmod`);
      }
      await provider.chmod(remotePath, mode);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_SET_METADATA,
    async (_event, providerId: string, remotePath: string, metadata: ObjectMetadata): Promise<void> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      if (typeof provider.setMetadata !== 'function') {
        throw new Error(`Storage provider "${providerId}" does not support metadata updates`);
      }
      await provider.setMetadata(remotePath, metadata);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_GET_TAGS,
    async (_event, providerId: string, remotePath: string): Promise<S3Tag[]> => {
      const provider = bridge.requireS3Capability(providerId, 'getTags');
      return await provider.getTags!(remotePath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_SET_TAGS,
    async (_event, providerId: string, remotePath: string, tags: S3Tag[]): Promise<void> => {
      const provider = bridge.requireS3Capability(providerId, 'setTags');
      await provider.setTags!(remotePath, tags);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_GET_BUCKET_POLICY,
    async (_event, providerId: string, bucketPath: string): Promise<string | null> => {
      const provider = bridge.requireS3Capability(providerId, 'getBucketPolicy');
      return await provider.getBucketPolicy!(bucketPath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_SET_BUCKET_POLICY,
    async (_event, providerId: string, bucketPath: string, policy: string | null): Promise<void> => {
      const provider = bridge.requireS3Capability(providerId, 'setBucketPolicy');
      await provider.setBucketPolicy!(bucketPath, policy);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_GET_BUCKET_CORS,
    async (_event, providerId: string, bucketPath: string): Promise<string | null> => {
      const provider = bridge.requireS3Capability(providerId, 'getBucketCors');
      return await provider.getBucketCors!(bucketPath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_SET_BUCKET_CORS,
    async (_event, providerId: string, bucketPath: string, corsJson: string | null): Promise<void> => {
      const provider = bridge.requireS3Capability(providerId, 'setBucketCors');
      await provider.setBucketCors!(bucketPath, corsJson);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_GET_BUCKET_VERSIONING,
    async (_event, providerId: string, bucketPath: string): Promise<BucketVersioningInfo> => {
      const provider = bridge.requireS3Capability(providerId, 'getBucketVersioning');
      return await provider.getBucketVersioning!(bucketPath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_SET_BUCKET_VERSIONING,
    async (_event, providerId: string, bucketPath: string, enabled: boolean): Promise<void> => {
      const provider = bridge.requireS3Capability(providerId, 'setBucketVersioning');
      await provider.setBucketVersioning!(bucketPath, enabled);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_LIST_OBJECT_VERSIONS,
    async (_event, providerId: string, remotePath: string): Promise<ObjectVersionEntry[]> => {
      const provider = bridge.requireS3Capability(providerId, 'listObjectVersions');
      return await provider.listObjectVersions!(remotePath);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_DELETE_OBJECT_VERSION,
    async (_event, providerId: string, remotePath: string, versionId: string): Promise<void> => {
      const provider = bridge.requireS3Capability(providerId, 'deleteObjectVersion');
      await provider.deleteObjectVersion!(remotePath, versionId);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_RESTORE_OBJECT_VERSION,
    async (_event, providerId: string, remotePath: string, versionId: string): Promise<void> => {
      const provider = bridge.requireS3Capability(providerId, 'restoreObjectVersion');
      await provider.restoreObjectVersion!(remotePath, versionId);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_GET_PRESIGNED_URL,
    async (_event, providerId: string, remotePath: string, expiresInSeconds: number): Promise<string> => {
      const provider = bridge.requireS3Capability(providerId, 'getPresignedUrl');
      return await provider.getPresignedUrl!(remotePath, expiresInSeconds);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_GET_HOMEDIR,
    async (_event, providerId: string): Promise<string> => {
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      if (typeof provider.getHomeDir === 'function') {
        return await provider.getHomeDir();
      }
      if (provider.type === 'local') {
        return os.homedir();
      }
      return '/';
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_GET_SPACE,
    async (_event, providerId: string, remotePath: string): Promise<SpaceInfo | undefined> => {
      if (typeof providerId !== 'string' || typeof remotePath !== 'string') {
        throw new Error('Invalid arguments');
      }
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      return typeof provider.getSpace === 'function' ? await provider.getSpace(remotePath) : undefined;
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.STORAGE_LIST_VOLUMES,
    async (_event, providerId: string): Promise<VolumeInfo[]> => {
      if (typeof providerId !== 'string') {
        throw new Error('Invalid arguments');
      }
      const provider = bridge.storageRegistry.get(providerId);
      if (!provider) {
        throw new Error(`Storage provider not found: ${providerId}`);
      }
      return typeof provider.listVolumes === 'function' ? await provider.listVolumes() : [];
    }
  );
}
