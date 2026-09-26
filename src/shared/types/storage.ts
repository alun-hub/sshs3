export type StorageType = 'local' | 'sftp' | 's3' | 'k8s';

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  mtime?: string; // ISO 8601 string yyyy-mm-dd HH:mm or ISO
  mtimeMs?: number; // epoch ms, UTC — precise value for diffing, unlike the display-rounded `mtime` above
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
  mode?: number;
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
  writeFile?(remotePath: string, data: Buffer | Uint8Array, options?: WriteStreamOptions): Promise<void>;
  readFile?(remotePath: string): Promise<Buffer>;
  chmod?(remotePath: string, mode: number | string): Promise<void>;
  setMetadata?(remotePath: string, metadata: ObjectMetadata): Promise<void>;
  /**
   * Sets a file's modification time (epoch ms) after it's written, so a copy
   * preserves the source's mtime instead of taking the write time. Not
   * supported by all providers (e.g. S3's LastModified is server-controlled).
   */
  setModifiedTime?(remotePath: string, mtimeMs: number): Promise<void>;
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

// 'fido2' behaves like 'smartcard'/'agent' here: ssh2 has no libfido2 support of its own, so it
// only ever works via an already-loaded ssh-agent (see SFTPStorageProvider.buildConnectCandidates).
export type SFTPAuthType = 'password' | 'privateKey' | 'smartcard' | 'agent' | 'fido2';

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
  /** authType 'fido2' only — see SSHConnectionConfig.fido2Resident. */
  fido2Resident?: boolean;
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
  forwardAgent?: boolean;
}

export type S3AuthMode = 'static' | 'sso';

export interface S3SsoConfig {
  startUrl: string;
  region: string;
  accountId?: string;
  roleName?: string;
}

export type S3ServerSideEncryption = 'none' | 'AES256' | 'aws:kms';

export interface S3Config {
  id: string;
  name: string;
  endpoint?: string;
  region: string;
  /** Defaults to 'static' (the accessKeyId/secretAccessKey fields below) when unset. */
  authMode?: S3AuthMode;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  sso?: S3SsoConfig;
  serverSideEncryption?: S3ServerSideEncryption;
  kmsKeyId?: string;
  forcePathStyle?: boolean;
  ssl?: boolean;
  rejectUnauthorized?: boolean;
  customCaPath?: string;
  initialPath?: string;
  proxy?: ProxyConfig;
  group?: string;
  lastUsedAt?: string;
  /** ISO 8601 timestamp of the last edit. Used by remote profile sync to resolve conflicts. */
  updatedAt?: string;
  /** ISO 8601 timestamp set instead of removing the entry outright, so sync can propagate the deletion. */
  deletedAt?: string;
}
