import fs from 'node:fs';
import os from 'node:os';
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

// Mirrors the OpenSSH client's own default identity file lookup order, since
// that is what terminal sessions (spawned via the real `ssh` binary) already
// rely on - an SFTP profile with no explicit password/key should fail no more
// often than a terminal session to the same host does.
const DEFAULT_IDENTITY_FILES = ['id_ed25519', 'id_ecdsa', 'id_rsa'];

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
    this.attachLifecycleListeners(this.client);
  }

  private attachLifecycleListeners(client: SftpClient): void {
    client.on('close', () => {
      this.isConnected = false;
    });
    client.on('end', () => {
      this.isConnected = false;
    });
    client.on('error', () => {
      this.isConnected = false;
    });
  }

  /**
   * Builds one or more candidate connect option sets, tried in order until one
   * succeeds. An explicit password or private key is used as-is (single
   * candidate). Otherwise - no credential configured, or authType 'agent' /
   * 'smartcard' (ssh2 has no PKCS#11 support) - falls back to ssh-agent and
   * then the user's default identity files, same as a bare `ssh host` would.
   */
  private buildConnectCandidates(): Record<string, any>[] {
    const base = {
      host: this.config.host,
      port: this.config.port ?? 22,
      username: this.config.username,
    };

    if (this.config.authType === 'password' && this.config.password) {
      return [{ ...base, password: this.config.password }];
    }

    if (this.config.authType === 'privateKey' && this.config.privateKeyPath) {
      const candidate: Record<string, any> = {
        ...base,
        privateKey: fs.readFileSync(this.config.privateKeyPath),
      };
      if (this.config.passphrase) {
        candidate.passphrase = this.config.passphrase;
      }
      return [candidate];
    }

    const candidates: Record<string, any>[] = [];

    const agent =
      this.config.agentPath ??
      (process.platform === 'win32'
        ? process.env.SSH_AUTH_SOCK || '\\\\.\\pipe\\pageant'
        : process.env.SSH_AUTH_SOCK);
    if (agent) {
      candidates.push({ ...base, agent });
    }

    for (const file of DEFAULT_IDENTITY_FILES) {
      const resolved = path.join(os.homedir(), '.ssh', file);
      if (fs.existsSync(resolved)) {
        candidates.push({ ...base, privateKey: fs.readFileSync(resolved) });
      }
    }

    if (this.config.password) {
      candidates.push({ ...base, password: this.config.password });
    }

    return candidates.length > 0 ? candidates : [base];
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

    const doConnect = async () => {
      try {
        const candidates = this.buildConnectCandidates();
        let lastErr: unknown;
        for (const options of candidates) {
          // A fresh client per candidate: retrying .connect() on the same
          // ssh2-sftp-client instance after a failed attempt leaves its
          // underlying ssh2 connection in a broken state and the next
          // connect() call hangs indefinitely instead of failing or
          // succeeding cleanly.
          const client = new SftpClient();
          try {
            await client.connect(options as any);
            this.client = client;
            this.attachLifecycleListeners(client);
            this.isConnected = true;
            return;
          } catch (err) {
            lastErr = err;
            await client.end().catch(() => {});
          }
        }
        throw lastErr;
      } catch (err) {
        this.isConnected = false;
        throw err;
      }
    };

    this.connectionPromise = doConnect().finally(() => {
      this.connectionPromise = null;
    });

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
      normalized === '..' ||
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

    const normalized = path.posix.normalize(remotePath.replace(/\\/g, '/'));

    if (typeof start === 'number' || typeof end === 'number') {
      const options: { start?: number; end?: number } = {};
      if (typeof start === 'number') options.start = start;
      if (typeof end === 'number') options.end = end;
      return this.client.createReadStream(normalized, options);
    }

    return this.client.createReadStream(normalized);
  }

  async createWriteStream(
    remotePath: string,
    options?: WriteStreamOptions,
  ): Promise<NodeJS.WritableStream> {
    await this.ensureConnected();

    const normalized = path.posix.normalize(remotePath.replace(/\\/g, '/'));

    if (options) {
      return this.client.createWriteStream(normalized, options as any);
    }
    return this.client.createWriteStream(normalized);
  }

  async disconnect(): Promise<void> {
    if (this.connectionPromise) {
      try {
        await this.connectionPromise;
      } catch {
        // Ignore connection errors during disconnect
      }
    }
    try {
      await this.client.end();
    } finally {
      this.isConnected = false;
    }
  }
}
