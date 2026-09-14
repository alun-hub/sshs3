import fs from 'node:fs';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import {
  BaseStorageProvider,
  formatDate,
  getMimeType,
} from './StorageProvider';
import type {
  FileEntry,
  IStorageProvider,
  SFTPConfig,
  StorageType,
  WriteStreamOptions,
} from '../../shared/types/storage';

/**
 * Parses permissions into an octal permission string (e.g. "755").
 */
function extractPermissions(item: any): string | undefined {
  if (typeof item.permissions === 'string') {
    return item.permissions;
  }
  if (typeof item.mode === 'number') {
    return (item.mode & 0o777).toString(8).padStart(3, '0');
  }
  if (item.attrs && typeof item.attrs.mode === 'number') {
    return (item.attrs.mode & 0o777).toString(8).padStart(3, '0');
  }
  if (item.rights && typeof item.rights === 'object') {
    const parseRights = (r: string = '') => {
      let val = 0;
      if (r.includes('r')) val += 4;
      if (r.includes('w')) val += 2;
      if (r.includes('x')) val += 1;
      return val;
    };
    const u = parseRights(item.rights.user);
    const g = parseRights(item.rights.group);
    const o = parseRights(item.rights.other);
    return `${u}${g}${o}`;
  }
  if (typeof item.longname === 'string' && item.longname.length >= 10) {
    const parseRwx = (str: string = '') => {
      let val = 0;
      if (str[0] === 'r') val += 4;
      if (str[1] === 'w') val += 2;
      if (str[2] === 'x') val += 1;
      return val;
    };
    const u = parseRwx(item.longname.slice(1, 4));
    const g = parseRwx(item.longname.slice(4, 7));
    const o = parseRwx(item.longname.slice(7, 10));
    return `${u}${g}${o}`;
  }
  return undefined;
}

/**
 * Parses modifyTime / mtime into yyyy-mm-dd HH:mm (24h) format.
 */
function parseModifyTime(stats: any): string | undefined {
  const m = stats.modifyTime ?? stats.mtime;
  if (m === undefined || m === null) {
    return undefined;
  }
  if (m instanceof Date) {
    return formatDate(m);
  }
  if (typeof m === 'number') {
    return formatDate(new Date(m > 1e11 ? m : m * 1000));
  }
  if (typeof m === 'string') {
    const d = new Date(m);
    if (!isNaN(d.getTime())) {
      return formatDate(d);
    }
  }
  return undefined;
}

export class SFTPStorageProvider extends BaseStorageProvider implements IStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType = 'sftp';

  private config: SFTPConfig;
  private client: SftpClient;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(config: SFTPConfig, client?: SftpClient) {
    super();
    this.config = { ...config };
    const port = config.port ?? 22;
    this.id = config.id ?? `${config.username}@${config.host}:${port}`;
    this.name = config.name ?? `${config.username}@${config.host}`;
    this.client = client ?? new SftpClient();

    this.client.on('close', () => {
      this.isConnected = false;
    });
    this.client.on('end', () => {
      this.isConnected = false;
    });
    this.client.on('error', () => {
      this.isConnected = false;
    });
  }

  /**
   * Builds the connect options based on SFTPConfig and platform defaults.
   */
  private buildConnectOptions(): Record<string, any> {
    const connectOptions: Record<string, any> = {
      host: this.config.host,
      port: this.config.port ?? 22,
      username: this.config.username,
    };

    if (this.config.authType === 'password') {
      connectOptions.password = this.config.password;
    } else if (this.config.authType === 'privateKey') {
      if (this.config.privateKeyPath) {
        connectOptions.privateKey = fs.readFileSync(this.config.privateKeyPath);
      }
      if (this.config.passphrase) {
        connectOptions.passphrase = this.config.passphrase;
      }
    } else if (this.config.authType === 'agent') {
      const agent =
        this.config.agentPath ??
        (process.platform === 'win32'
          ? process.env.SSH_AUTH_SOCK || '\\\\.\\pipe\\pageant'
          : process.env.SSH_AUTH_SOCK);

      if (agent) {
        connectOptions.agent = agent;
      }
    }

    return connectOptions;
  }

  /**
   * Ensures an active connection to the SFTP server, establishing one if needed.
   * Deduplicates concurrent connection attempts.
   */
  public async ensureConnected(): Promise<void> {
    if (this.isConnected) {
      return;
    }
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      try {
        const options = this.buildConnectOptions();
        await this.client.connect(options as any);
        this.isConnected = true;
      } catch (err) {
        this.isConnected = false;
        throw err;
      } finally {
        this.connectionPromise = null;
      }
    })();

    return this.connectionPromise;
  }

  async list(remotePath: string): Promise<FileEntry[]> {
    await this.ensureConnected();

    const fileList = await this.client.list(remotePath);
    const results: FileEntry[] = [];

    for (const item of fileList) {
      const isDir = item.type === 'd' || (item as any).isDirectory === true;
      const entryPath = path.posix.join(remotePath, item.name);
      const mtime = parseModifyTime(item);

      results.push({
        name: item.name,
        path: entryPath,
        size: item.size,
        isDirectory: isDir,
        mtime,
        mimeType: isDir ? undefined : getMimeType(item.name),
        permissions: extractPermissions(item),
      });
    }

    // Sort directories first, then alphabetical by name
    results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  async stat(remotePath: string): Promise<FileEntry> {
    await this.ensureConnected();

    const stats = await this.client.stat(remotePath);
    const isDir = Boolean(stats.isDirectory);
    const name = path.posix.basename(remotePath) || remotePath;
    const mtime = parseModifyTime(stats);

    return {
      name,
      path: remotePath,
      size: stats.size,
      isDirectory: isDir,
      mtime,
      mimeType: isDir ? undefined : getMimeType(name),
      permissions: extractPermissions(stats),
    };
  }

  async createFolder(remotePath: string): Promise<void> {
    await this.ensureConnected();
    await this.client.mkdir(remotePath, true);
  }

  async delete(remotePath: string, isDirectory: boolean): Promise<void> {
    const normalized = path.posix.normalize(remotePath);
    if (
      normalized === '/' ||
      normalized === '.' ||
      remotePath.trim() === '/' ||
      remotePath.trim() === ''
    ) {
      throw new Error(`Cannot delete root directory: ${remotePath}`);
    }

    await this.ensureConnected();

    if (isDirectory) {
      await this.client.rmdir(remotePath, true);
    } else {
      await this.client.delete(remotePath);
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.ensureConnected();
    await this.client.rename(oldPath, newPath);
  }

  async createReadStream(
    remotePath: string,
    start?: number,
    end?: number,
  ): Promise<NodeJS.ReadableStream> {
    await this.ensureConnected();

    if (typeof start === 'number' || typeof end === 'number') {
      const options: { start?: number; end?: number } = {};
      if (typeof start === 'number') options.start = start;
      if (typeof end === 'number') options.end = end;
      return this.client.createReadStream(remotePath, options);
    }

    return this.client.createReadStream(remotePath);
  }

  async createWriteStream(
    remotePath: string,
    options?: WriteStreamOptions,
  ): Promise<NodeJS.WritableStream> {
    await this.ensureConnected();

    if (options) {
      return this.client.createWriteStream(remotePath, options as any);
    }
    return this.client.createWriteStream(remotePath);
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.end();
    } finally {
      this.isConnected = false;
    }
  }
}
