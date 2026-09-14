import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { PassThrough } from 'node:stream';
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
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  BaseStorageProvider,
  formatDate,
  getMimeType,
} from './StorageProvider';
import type {
  FileEntry,
  IStorageProvider,
  S3Config,
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
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
      },
    };

    if (config.rejectUnauthorized !== undefined || config.customCaPath) {
      const httpsAgentOptions: https.AgentOptions = {};
      if (config.rejectUnauthorized !== undefined) {
        httpsAgentOptions.rejectUnauthorized = config.rejectUnauthorized;
      }
      if (config.customCaPath) {
        httpsAgentOptions.ca = fs.readFileSync(config.customCaPath);
      }
      s3ClientConfig.requestHandler = new NodeHttpHandler({
        httpsAgent: new https.Agent(httpsAgentOptions),
      });
    }

    this.client = new S3Client(s3ClientConfig);
  }

  async list(remotePath: string): Promise<FileEntry[]> {
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
      return results.sort((a, b) => a.name.localeCompare(b.name));
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
      return;
    }

    const folderKey = key.endsWith('/') ? key : `${key}/`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: folderKey,
        Body: '',
      })
    );
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
      return;
    }

    if (!isDirectory) {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
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

    await this.client.send(
      new CopyObjectCommand({
        Bucket: dst.bucket,
        Key: dst.key,
        CopySource: `${src.bucket}/${encodedSourceKey}`,
      })
    );

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: src.bucket,
        Key: src.key,
      })
    );
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

  async createWriteStream(
    remotePath: string,
    _options?: WriteStreamOptions,
  ): Promise<NodeJS.WritableStream> {
    const { bucket, key } = parseS3Path(remotePath);

    if (!bucket || !key) {
      throw new Error(`Cannot write to root or bucket: ${remotePath}`);
    }

    const passThrough = new PassThrough();
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: passThrough,
        ContentType: getMimeType(key),
      },
    });

    const originalFinal = passThrough._final.bind(passThrough);
    passThrough._final = (callback) => {
      originalFinal(async (err) => {
        if (err) return callback(err);
        try {
          await upload.done();
          callback();
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

  async disconnect(): Promise<void> {
    this.client.destroy();
  }
}
