import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { PassThrough } from 'node:stream';
import { createProxySocket } from '../proxy/proxySocket';
import { SystemTrustStore } from '../crypto/SystemTrustStore';
import {
  S3Client,
  type S3ClientConfig,
  ListBucketsCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  HeadBucketCommand,
  HeadObjectCommand,
  CreateBucketCommand,
  type CreateBucketCommandInput,
  type BucketLocationConstraint,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  DeleteBucketCommand,
  CopyObjectCommand,
  GetObjectCommand,
  type GetObjectCommandInput,
  GetObjectTaggingCommand,
  PutObjectTaggingCommand,
  DeleteObjectTaggingCommand,
  GetBucketTaggingCommand,
  PutBucketTaggingCommand,
  DeleteBucketTaggingCommand,
  GetBucketPolicyCommand,
  PutBucketPolicyCommand,
  DeleteBucketPolicyCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  DeleteBucketCorsCommand,
  GetBucketVersioningCommand,
  PutBucketVersioningCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fromSSO } from '@aws-sdk/credential-provider-sso';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  BaseStorageProvider,
  formatDate,
  getMimeType,
} from './StorageProvider';
import type {
  BucketVersioningInfo,
  FileEntry,
  IStorageProvider,
  ObjectMetadata,
  ObjectVersionEntry,
  S3Config,
  S3Tag,
  StorageType,
  WriteStreamOptions,
} from '../../shared/types/storage';

/**
 * Parses a remote S3 path into bucket and key components.
 * Examples:
 * - "" or "/" -> { bucket: "", key: "" }
 * - "/bucket" -> { bucket: "bucket", key: "" }
 * - "/bucket/path/to/file.txt" -> { bucket: "bucket", key: "path/to/file.txt" }
 */
export function parseS3Path(remotePath: string): { bucket: string; key: string } {
  if (!remotePath) {
    return { bucket: '', key: '' };
  }
  const normalized = remotePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) {
    return { bucket: '', key: '' };
  }
  const slashIndex = normalized.indexOf('/');
  if (slashIndex === -1) {
    return { bucket: normalized, key: '' };
  }
  const bucket = normalized.slice(0, slashIndex);
  const key = normalized.slice(slashIndex + 1);
  return { bucket, key };
}

export class S3StorageProvider extends BaseStorageProvider implements IStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType = 's3';
  readonly config: S3Config;
  public readonly client: S3Client;

  constructor(config: S3Config) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.config = config;

    const s3ClientConfig: S3ClientConfig = {
      region: config.region || 'us-east-1',
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials:
        config.authMode === 'sso' && config.sso
          ? fromSSO({
              ssoStartUrl: config.sso.startUrl,
              ssoRegion: config.sso.region,
              ssoAccountId: config.sso.accountId,
              ssoRoleName: config.sso.roleName,
            })
          : {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
              ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
            },
    };

    const systemCAs = SystemTrustStore.getCAs();
    const effectiveCa = config.customCaPath
      ? fs.readFileSync(config.customCaPath)
      : systemCAs.length > 0
      ? SystemTrustStore.getMergedRootCertificates()
      : undefined;

    const hasProxy = Boolean(config.proxy?.enabled && config.proxy.host);
    const hasCustomTls = config.rejectUnauthorized !== undefined || effectiveCa !== undefined;

    if (hasProxy || hasCustomTls) {
      const httpsAgentOptions: https.AgentOptions = {};
      if (config.rejectUnauthorized !== undefined) {
        httpsAgentOptions.rejectUnauthorized = config.rejectUnauthorized;
      }
      if (effectiveCa !== undefined) {
        httpsAgentOptions.ca = effectiveCa;
      }

      if (hasProxy && config.proxy) {
        const proxyCfg = config.proxy;
        const httpAgent = new http.Agent();
        (httpAgent as any).createConnection = (opts: any, cb: any) => {
          createProxySocket(proxyCfg, {
            host: opts.host || opts.hostname,
            port: Number(opts.port) || 80,
          })
            .then((socket) => cb(null, socket))
            .catch((err) => cb(err));
        };

        const httpsAgent = new https.Agent(httpsAgentOptions);
        (httpsAgent as any).createConnection = (opts: any, cb: any) => {
          createProxySocket(proxyCfg, {
            host: opts.host || opts.hostname,
            port: Number(opts.port) || 443,
          })
            .then((socket) => {
              const tlsSocket = tls.connect({
                socket,
                host: opts.host || opts.hostname,
                servername: opts.servername || opts.host || opts.hostname,
                rejectUnauthorized: config.rejectUnauthorized ?? true,
                ca: effectiveCa,
              });
              tlsSocket.on('error', (err) => cb(err));
              cb(null, tlsSocket);
            })
            .catch((err) => cb(err));
        };

        s3ClientConfig.requestHandler = new NodeHttpHandler({
          httpAgent,
          httpsAgent,
        });
      } else {
        s3ClientConfig.requestHandler = new NodeHttpHandler({
          httpsAgent: new https.Agent(httpsAgentOptions),
        });
      }
    }

    this.client = new S3Client(s3ClientConfig);
  }

  private listCache: Map<string, { entries: FileEntry[]; timestamp: number }> = new Map();
  public static readonly CACHE_TTL_MS = 60_000;

  public clearCache(): void {
    this.listCache.clear();
  }

  /** Server-side encryption params to apply to every PutObject/Upload call, per the profile's config. */
  private sseParams(): { ServerSideEncryption?: 'AES256' | 'aws:kms'; SSEKMSKeyId?: string } {
    const sse = this.config.serverSideEncryption;
    if (!sse || sse === 'none') {
      return {};
    }
    return {
      ServerSideEncryption: sse,
      ...(sse === 'aws:kms' && this.config.kmsKeyId ? { SSEKMSKeyId: this.config.kmsKeyId } : {}),
    };
  }

  async list(remotePath: string, options?: { force?: boolean }): Promise<FileEntry[]> {
    const normalizedPath = remotePath.replace(/\\/g, '/');
    if (!options?.force) {
      const cached = this.listCache.get(normalizedPath);
      if (cached && Date.now() - cached.timestamp < S3StorageProvider.CACHE_TTL_MS) {
        return cached.entries;
      }
    }

    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket) {
      const output = await this.client.send(new ListBucketsCommand({}));
      const buckets = output.Buckets ?? [];
      const results: FileEntry[] = buckets.map((b) => ({
        name: b.Name ?? '',
        path: `/${b.Name ?? ''}`,
        size: 0,
        isDirectory: true,
        mtime: b.CreationDate ? formatDate(b.CreationDate) : undefined,
      }));
      results.sort((a, b) => a.name.localeCompare(b.name));
      this.listCache.set(normalizedPath, { entries: results, timestamp: Date.now() });
      return results;
    }

    const prefix = key ? (key.endsWith('/') ? key : `${key}/`) : '';
    let continuationToken: string | undefined = undefined;
    const results: FileEntry[] = [];

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken,
      });
      const output = await this.client.send(command);

      // Virtual directories (CommonPrefixes)
      for (const cp of output.CommonPrefixes ?? []) {
        const cpPrefix = cp.Prefix ?? '';
        const stripped = cpPrefix.replace(/\/+$/, '');
        const name = path.posix.basename(stripped);
        results.push({
          name,
          path: `/${bucket}/${stripped}`,
          size: 0,
          isDirectory: true,
          mtime: undefined,
        });
      }

      // Objects (Contents)
      for (const item of output.Contents ?? []) {
        const itemKey = item.Key ?? '';
        // Skip the folder marker itself or any key ending with '/'
        if (itemKey === prefix || itemKey === '' || itemKey.endsWith('/')) {
          continue;
        }
        const name = path.posix.basename(itemKey);
        results.push({
          name,
          path: `/${bucket}/${itemKey}`,
          size: item.Size ?? 0,
          isDirectory: false,
          mtime: item.LastModified ? formatDate(item.LastModified) : undefined,
          mimeType: getMimeType(name),
        });
      }

      continuationToken = output.NextContinuationToken;
    } while (continuationToken);

    // Sort: directories first, then alphabetical
    results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    this.listCache.set(normalizedPath, { entries: results, timestamp: Date.now() });
    return results;
  }

  async stat(remotePath: string): Promise<FileEntry> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket) {
      return {
        name: '/',
        path: '/',
        size: 0,
        isDirectory: true,
      };
    }

    if (!key) {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      return {
        name: bucket,
        path: `/${bucket}`,
        size: 0,
        isDirectory: true,
      };
    }

    const cleanKey = key.replace(/\/+$/, '');
    const isExplicitDir = key.endsWith('/');

    // 1. If not explicitly ending with '/', check if it's an object file
    if (!isExplicitDir) {
      try {
        const head = await this.client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: cleanKey })
        );
        const name = path.posix.basename(cleanKey);
        return {
          name,
          path: `/${bucket}/${cleanKey}`,
          size: head.ContentLength ?? 0,
          isDirectory: false,
          mtime: head.LastModified ? formatDate(head.LastModified) : undefined,
          mimeType: head.ContentType || getMimeType(name),
        };
      } catch {
        // Fall through to directory checks
      }
    }

    // 2. Check if explicit folder marker object exists (${cleanKey}/)
    try {
      const headDir = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: `${cleanKey}/` })
      );
      const name = path.posix.basename(cleanKey);
      return {
        name,
        path: `/${bucket}/${cleanKey}`,
        size: 0,
        isDirectory: true,
        mtime: headDir.LastModified ? formatDate(headDir.LastModified) : undefined,
      };
    } catch {
      // Fall through to prefix check
    }

    // 3. Check if virtual prefix exists (contains any objects or sub-prefixes)
    const list = await this.client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${cleanKey}/`,
        MaxKeys: 1,
      })
    );

    const hasChildren =
      (list.Contents && list.Contents.length > 0) ||
      (list.CommonPrefixes && list.CommonPrefixes.length > 0) ||
      Boolean(list.KeyCount && list.KeyCount > 0);

    if (hasChildren) {
      const name = path.posix.basename(cleanKey);
      return {
        name,
        path: `/${bucket}/${cleanKey}`,
        size: 0,
        isDirectory: true,
      };
    }

    throw new Error(`Path not found: ${remotePath}`);
  }

  async createFolder(remotePath: string): Promise<void> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket) {
      throw new Error(`Cannot create folder at root: ${remotePath}`);
    }

    if (!key) {
      const createParams: CreateBucketCommandInput = {
        Bucket: bucket,
        ...(this.config.region && this.config.region !== 'us-east-1'
          ? {
              CreateBucketConfiguration: {
                LocationConstraint: this.config.region as BucketLocationConstraint,
              },
            }
          : {}),
      };
      await this.client.send(new CreateBucketCommand(createParams));
      this.clearCache();
      return;
    }

    const folderKey = key.endsWith('/') ? key : `${key}/`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: folderKey,
        Body: '',
        ContentLength: 0,
        ...this.sseParams(),
      })
    );
    this.clearCache();
  }

  async delete(remotePath: string, isDirectory: boolean): Promise<void> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket) {
      throw new Error(`Cannot delete root: ${remotePath}`);
    }

    if (!key) {
      if (!isDirectory) {
        throw new Error(`Expected file but found bucket: ${remotePath}`);
      }
      await this.client.send(new DeleteBucketCommand({ Bucket: bucket }));
      this.clearCache();
      return;
    }

    if (!isDirectory) {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      this.clearCache();
      return;
    }

    // Deleting directory: delete all objects under the prefix, plus the directory marker
    const prefix = key.endsWith('/') ? key : `${key}/`;
    let continuationToken: string | undefined = undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listed: ListObjectsV2CommandOutput = await this.client.send(listCommand);

      const objectsToDelete: { Key: string }[] = [];
      for (const item of listed.Contents ?? []) {
        if (item.Key) {
          objectsToDelete.push({ Key: item.Key });
        }
      }

      if (objectsToDelete.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: objectsToDelete,
              Quiet: true,
            },
          })
        );
      }

      continuationToken = listed.NextContinuationToken;
    } while (continuationToken);

    // Also ensure folder marker is deleted in case it wasn't returned
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: prefix,
      })
    ).catch(() => {});
    this.clearCache();
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const src = parseS3Path(oldPath);
    const dst = parseS3Path(newPath);

    if (!src.bucket || !src.key) {
      throw new Error(`Cannot rename root or bucket directly: ${oldPath}`);
    }

    if (!dst.bucket || !dst.key) {
      throw new Error(`Destination must include bucket and key: ${newPath}`);
    }

    const encodedSourceKey = src.key
      .split('/')
      .map(encodeURIComponent)
      .join('/');

    const copyCommand = new CopyObjectCommand({
      Bucket: dst.bucket,
      Key: dst.key,
      CopySource: `${src.bucket}/${encodedSourceKey}`,
      ...this.sseParams(),
    });

    let copyErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.client.send(copyCommand);
        copyErr = null;
        break;
      } catch (err: any) {
        copyErr = err;
        const code = err?.name || err?.Code || err?.code;
        if (code === 'NoSuchKey' && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 150));
          continue;
        }
        throw err;
      }
    }
    if (copyErr) throw copyErr;

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: src.bucket,
        Key: src.key,
      })
    );
    this.clearCache();
  }

  async setMetadata(remotePath: string, metadata: ObjectMetadata): Promise<void> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket || !key) {
      throw new Error(`Cannot set metadata on root or bucket: ${remotePath}`);
    }

    const encodedKey = key
      .split('/')
      .map(encodeURIComponent)
      .join('/');

    const head = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

    await this.client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: `${bucket}/${encodedKey}`,
        MetadataDirective: 'REPLACE',
        ContentType: metadata.contentType || head.ContentType || getMimeType(key),
        Metadata: head.Metadata,
        ...this.sseParams(),
      })
    );
    this.clearCache();
  }

  async createReadStream(
    remotePath: string,
    start?: number,
    end?: number,
  ): Promise<NodeJS.ReadableStream> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket || !key) {
      throw new Error(`Cannot read root or bucket as stream: ${remotePath}`);
    }

    const params: GetObjectCommandInput = {
      Bucket: bucket,
      Key: key,
    };

    if (typeof start === 'number' || typeof end === 'number') {
      const startStr = typeof start === 'number' ? start : '';
      const endStr = typeof end === 'number' ? end : '';
      params.Range = `bytes=${startStr}-${endStr}`;
    }

    const res = await this.client.send(new GetObjectCommand(params));

    if (!res.Body) {
      throw new Error(`Empty response body for: ${remotePath}`);
    }

    return res.Body as NodeJS.ReadableStream;
  }

  /**
   * Generates a temporary, pre-signed HTTPS URL for downloading a single
   * object without AWS credentials. SigV4 caps the expiry at 7 days.
   */
  async getPresignedUrl(remotePath: string, expiresInSeconds: number): Promise<string> {
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket || !key) {
      throw new Error(`Requires an object path: ${remotePath}`);
    }
    const MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
    const expiresIn = Math.min(Math.max(1, Math.floor(expiresInSeconds)), MAX_EXPIRY_SECONDS);
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
  }

  async createWriteStream(
    remotePath: string,
    options?: WriteStreamOptions,
  ): Promise<NodeJS.WritableStream> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket || !key) {
      throw new Error(`Cannot write to root or bucket: ${remotePath}`);
    }

    const passThrough = new PassThrough({ autoDestroy: false, emitClose: false });
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: passThrough,
        ContentType: getMimeType(key),
        ...(options?.size !== undefined && options.size >= 0
          ? { ContentLength: options.size }
          : {}),
        ...this.sseParams(),
      },
    });

    // Start consuming stream data immediately to avoid backpressure deadlocks
    const uploadPromise = upload.done();
    uploadPromise
      .then(() => {
        this.clearCache();
      })
      .catch((err) => {
        if (!passThrough.destroyed) {
          passThrough.destroy(err);
        }
      });

    const originalFinal = passThrough._final.bind(passThrough);
    passThrough._final = (callback) => {
      originalFinal(async (err) => {
        if (err) return callback(err);
        try {
          await uploadPromise;
          this.clearCache();
          callback();
          passThrough.emit('close');
        } catch (uploadErr: any) {
          callback(uploadErr);
        }
      });
    };

    passThrough.on('error', () => {
      upload.abort();
    });

    return passThrough;
  }

  async writeFile(
    remotePath: string,
    data: Buffer | Uint8Array,
    _options?: WriteStreamOptions,
  ): Promise<void> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket || !key) {
      throw new Error(`Cannot write to root or bucket: ${remotePath}`);
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: getMimeType(key),
        ContentLength: data.byteLength,
        ...this.sseParams(),
      })
    );
    this.clearCache();
  }

  async readFile(remotePath: string): Promise<Buffer> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket || !key) {
      throw new Error(`Cannot read root or bucket as file: ${remotePath}`);
    }

    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

    if (!res.Body) {
      return Buffer.alloc(0);
    }

    const byteArray = await (res.Body as any).transformToByteArray();
    return Buffer.from(byteArray);
  }

  async getTags(remotePath: string): Promise<S3Tag[]> {
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket) {
      throw new Error(`Cannot get tags for the root: ${remotePath}`);
    }

    try {
      if (!key) {
        const output = await this.client.send(new GetBucketTaggingCommand({ Bucket: bucket }));
        return (output.TagSet ?? []).map((t) => ({ key: t.Key ?? '', value: t.Value ?? '' }));
      }
      const output = await this.client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
      return (output.TagSet ?? []).map((t) => ({ key: t.Key ?? '', value: t.Value ?? '' }));
    } catch (err: any) {
      if (err?.name === 'NoSuchTagSet' || err?.Code === 'NoSuchTagSet') {
        return [];
      }
      throw err;
    }
  }

  async setTags(remotePath: string, tags: S3Tag[]): Promise<void> {
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket) {
      throw new Error(`Cannot set tags for the root: ${remotePath}`);
    }

    const TagSet = tags.map((t) => ({ Key: t.key, Value: t.value }));

    if (!key) {
      if (tags.length === 0) {
        await this.client.send(new DeleteBucketTaggingCommand({ Bucket: bucket }));
        this.clearCache();
        return;
      }
      await this.client.send(new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet } }));
      this.clearCache();
      return;
    }

    if (tags.length === 0) {
      await this.client.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }));
      this.clearCache();
      return;
    }
    await this.client.send(new PutObjectTaggingCommand({ Bucket: bucket, Key: key, Tagging: { TagSet } }));
    this.clearCache();
  }

  private requireBucketOnly(remotePath: string): string {
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket || key) {
      throw new Error(`Requires a bucket path: ${remotePath}`);
    }
    return bucket;
  }

  async getBucketPolicy(remotePath: string): Promise<string | null> {
    const bucket = this.requireBucketOnly(remotePath);
    try {
      const output = await this.client.send(new GetBucketPolicyCommand({ Bucket: bucket }));
      return output.Policy ?? null;
    } catch (err: any) {
      if (err?.name === 'NoSuchBucketPolicy' || err?.Code === 'NoSuchBucketPolicy') {
        return null;
      }
      throw err;
    }
  }

  async setBucketPolicy(remotePath: string, policy: string | null): Promise<void> {
    const bucket = this.requireBucketOnly(remotePath);
    if (!policy || !policy.trim()) {
      await this.client.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
      return;
    }
    await this.client.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy: policy }));
  }

  async getBucketCors(remotePath: string): Promise<string | null> {
    const bucket = this.requireBucketOnly(remotePath);
    try {
      const output = await this.client.send(new GetBucketCorsCommand({ Bucket: bucket }));
      return JSON.stringify(output.CORSRules ?? [], null, 2);
    } catch (err: any) {
      if (err?.name === 'NoSuchCORSConfiguration' || err?.Code === 'NoSuchCORSConfiguration') {
        return null;
      }
      throw err;
    }
  }

  async setBucketCors(remotePath: string, corsJson: string | null): Promise<void> {
    const bucket = this.requireBucketOnly(remotePath);
    if (!corsJson || !corsJson.trim()) {
      await this.client.send(new DeleteBucketCorsCommand({ Bucket: bucket }));
      return;
    }
    let rules: unknown;
    try {
      rules = JSON.parse(corsJson);
    } catch {
      throw new Error('Invalid JSON for CORS rules');
    }
    if (!Array.isArray(rules)) {
      throw new Error('CORS rules must be a JSON array of rules');
    }
    await this.client.send(
      new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules as any } })
    );
  }

  async getBucketVersioning(remotePath: string): Promise<BucketVersioningInfo> {
    const bucket = this.requireBucketOnly(remotePath);
    const output = await this.client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    return { status: (output.Status as BucketVersioningInfo['status']) ?? 'Disabled' };
  }

  async setBucketVersioning(remotePath: string, enabled: boolean): Promise<void> {
    const bucket = this.requireBucketOnly(remotePath);
    await this.client.send(
      new PutBucketVersioningCommand({
        Bucket: bucket,
        VersioningConfiguration: { Status: enabled ? 'Enabled' : 'Suspended' },
      })
    );
  }

  async listObjectVersions(remotePath: string): Promise<ObjectVersionEntry[]> {
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket) {
      throw new Error(`Cannot list versions for the root: ${remotePath}`);
    }

    const results: ObjectVersionEntry[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;

    do {
      const output = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: key || undefined,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        })
      );

      for (const v of output.Versions ?? []) {
        if (key && v.Key !== key) continue;
        results.push({
          versionId: v.VersionId ?? '',
          isLatest: Boolean(v.IsLatest),
          isDeleteMarker: false,
          size: v.Size ?? 0,
          lastModified: v.LastModified ? formatDate(v.LastModified) : undefined,
        });
      }

      for (const m of output.DeleteMarkers ?? []) {
        if (key && m.Key !== key) continue;
        results.push({
          versionId: m.VersionId ?? '',
          isLatest: Boolean(m.IsLatest),
          isDeleteMarker: true,
          size: 0,
          lastModified: m.LastModified ? formatDate(m.LastModified) : undefined,
        });
      }

      keyMarker = output.IsTruncated ? output.NextKeyMarker : undefined;
      versionIdMarker = output.IsTruncated ? output.NextVersionIdMarker : undefined;
    } while (keyMarker);

    results.sort((a, b) => (a.lastModified ?? '') < (b.lastModified ?? '') ? 1 : -1);
    return results;
  }

  async deleteObjectVersion(remotePath: string, versionId: string): Promise<void> {
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket || !key) {
      throw new Error(`Requires an object path: ${remotePath}`);
    }
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key, VersionId: versionId }));
    this.clearCache();
  }

  async restoreObjectVersion(remotePath: string, versionId: string): Promise<void> {
    const { bucket, key } = parseS3Path(remotePath);
    if (!bucket || !key) {
      throw new Error(`Requires an object path: ${remotePath}`);
    }
    const encodedKey = key
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: `${bucket}/${encodedKey}?versionId=${versionId}`,
        ...this.sseParams(),
      })
    );
    this.clearCache();
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }
}
