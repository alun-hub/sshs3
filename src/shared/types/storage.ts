export type StorageType = 'local' | 'sftp' | 's3';

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  mtime?: string; // ISO 8601 string yyyy-mm-dd HH:mm or ISO
  mimeType?: string;
  permissions?: string;
}

export interface TransferProgress {
  jobId: string;
  fileName: string;
  transferredBytes: number;
  totalBytes: number;
  percentage: number;
  bytesPerSecond: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  statusMessage?: string;
}

export interface WriteStreamOptions {
  size?: number;
}

export interface ObjectMetadata {
  contentType?: string;
}

export interface S3Tag {
  key: string;
  value: string;
}

export type S3VersioningStatus = 'Enabled' | 'Suspended' | 'Disabled';

export interface BucketVersioningInfo {
  status: S3VersioningStatus;
}

export interface ObjectVersionEntry {
  versionId: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
  size: number;
  lastModified?: string;
}

export interface IStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType;
  list(remotePath: string, options?: { force?: boolean }): Promise<FileEntry[]>;
  stat(remotePath: string): Promise<FileEntry>;
  createFolder(remotePath: string): Promise<void>;
  delete(remotePath: string, isDirectory: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  createReadStream(remotePath: string, start?: number, end?: number): Promise<NodeJS.ReadableStream>;
  createWriteStream(remotePath: string, options?: WriteStreamOptions): Promise<NodeJS.WritableStream>;
  chmod?(remotePath: string, mode: number | string): Promise<void>;
  setMetadata?(remotePath: string, metadata: ObjectMetadata): Promise<void>;
  disconnect?(): Promise<void>;
  // S3-specific administration (buckets & objects)
  getTags?(remotePath: string): Promise<S3Tag[]>;
  setTags?(remotePath: string, tags: S3Tag[]): Promise<void>;
  getBucketPolicy?(bucketPath: string): Promise<string | null>;
  setBucketPolicy?(bucketPath: string, policy: string | null): Promise<void>;
  getBucketCors?(bucketPath: string): Promise<string | null>;
  setBucketCors?(bucketPath: string, corsJson: string | null): Promise<void>;
  getBucketVersioning?(bucketPath: string): Promise<BucketVersioningInfo>;
  setBucketVersioning?(bucketPath: string, enabled: boolean): Promise<void>;
  listObjectVersions?(remotePath: string): Promise<ObjectVersionEntry[]>;
  deleteObjectVersion?(remotePath: string, versionId: string): Promise<void>;
  restoreObjectVersion?(remotePath: string, versionId: string): Promise<void>;
  getPresignedUrl?(remotePath: string, expiresInSeconds: number): Promise<string>;
}

export type SFTPAuthType = 'password' | 'privateKey' | 'smartcard' | 'agent';

export type ProxyType = 'http' | 'socks5' | 'socks4';

export interface ProxyConfig {
  enabled?: boolean;
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface SFTPConfig {
  id?: string;
  name?: string;
  host: string;
  port: number;
  username: string;
  authType: SFTPAuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  agentPath?: string;
  pkcs11LibPath?: string;
  pin?: string;
  initialPath?: string;
  proxy?: ProxyConfig;
  proxyJump?: string;
  group?: string;
  lastUsedAt?: string;
  compression?: boolean;
  serverAliveInterval?: number;
  ciphers?: string;
  kexAlgorithms?: string;
  macs?: string;
}

export interface S3Config {
  id: string;
  name: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
  ssl?: boolean;
  rejectUnauthorized?: boolean;
  customCaPath?: string;
  initialPath?: string;
  proxy?: ProxyConfig;
  group?: string;
  lastUsedAt?: string;
}
