import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import SftpClient from 'ssh2-sftp-client';
import { Client as SSH2Client } from 'ssh2';
import { createProxySocket } from '../proxy/proxySocket';
import { AskpassServer } from '../smartcard/AskpassServer';
import { AgentLifecycleManager } from '../ssh/AgentLifecycleManager';

const execFileAsync = promisify(execFile);
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
import type { SshHostVerifierFn } from '../ssh/HostKeyVerifier';

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

function parseJumpHost(jumpStr: string, defaultUser: string): { username: string; host: string; port: number } {
  let username = defaultUser;
  let hostAndPort = jumpStr.trim();
  if (hostAndPort.includes('@')) {
    const parts = hostAndPort.split('@');
    username = parts[0];
    hostAndPort = parts[1];
  }
  let host = hostAndPort;
  let port = 22;
  if (hostAndPort.includes(':')) {
    const parts = hostAndPort.split(':');
    host = parts[0];
    port = parseInt(parts[1], 10) || 22;
  }
  return { username, host, port };
}

export class SFTPStorageProvider extends BaseStorageProvider implements IStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType = 'sftp';

  private config: SFTPConfig;
  private client: SftpClient;
  private jumpClient?: SSH2Client;
  private isConnected: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private hostVerifier?: SshHostVerifierFn;

  constructor(config: SFTPConfig, client?: SftpClient, hostVerifier?: SshHostVerifierFn) {
    super();
    this.config = { ...config };
    const port = config.port ?? 22;
    this.id = config.id ?? `${config.username}@${config.host}:${port}`;
    this.name = config.name ?? `${config.username}@${config.host}`;
    this.client = client ?? new SftpClient();
    this.hostVerifier = hostVerifier;
    this.attachLifecycleListeners(this.client);
  }

  private attachLifecycleListeners(client: SftpClient): void {
    const cleanup = () => {
      this.isConnected = false;
      if (this.jumpClient) {
        try { this.jumpClient.end(); } catch { /* ignore */ }
        this.jumpClient = undefined;
      }
    };
    client.on('close', cleanup);
    client.on('end', cleanup);
    client.on('error', cleanup);
  }

  /**
   * Builds one or more candidate connect option sets, tried in order until one
   * succeeds. An explicit password or private key is used as-is (single
   * candidate). Otherwise - no credential configured, or authType 'agent' /
   * 'smartcard' (ssh2 has no PKCS#11 support) - falls back to ssh-agent and
   * then the user's default identity files, same as a bare `ssh host` would.
   */
  private buildConnectCandidates(): Record<string, any>[] {
    const base: Record<string, any> = {
      host: this.config.host,
      port: this.config.port ?? 22,
      username: this.config.username,
    };
    if (this.hostVerifier) {
      base.hostVerifier = this.hostVerifier;
    }
    if (this.config.serverAliveInterval) {
      base.keepaliveInterval = this.config.serverAliveInterval * 1000;
    }
    const algorithms: Record<string, string[]> = {};
    if (this.config.ciphers) algorithms.cipher = this.config.ciphers.split(',').map((s) => s.trim());
    if (this.config.kexAlgorithms) algorithms.kex = this.config.kexAlgorithms.split(',').map((s) => s.trim());
    if (this.config.macs) algorithms.hmac = this.config.macs.split(',').map((s) => s.trim());
    if (Object.keys(algorithms).length > 0) {
      base.algorithms = algorithms;
    }

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
   * Attempts to ensure the PKCS#11 smartcard provider is loaded into the user's ssh-agent.
   */
  private async loadSmartcardIntoAgent(): Promise<void> {
    const libPath = this.config.pkcs11LibPath;
    if (!libPath) return;

    const agentStatus = await AgentLifecycleManager.ensureAgent();
    const agentSock =
      this.config.agentPath ??
      agentStatus.socketPath ??
      (process.platform === 'win32'
        ? process.env.SSH_AUTH_SOCK || '\\\\.\\pipe\\openssh-ssh-agent'
        : process.env.SSH_AUTH_SOCK);

    if (!agentSock || !agentStatus.isRunning) {
      if (process.platform === 'win32') {
        throw new Error(
          'Smartcard authentication for SFTP requires the Windows OpenSSH Authentication Agent service. ' +
          'Please start it by running in Administrator PowerShell:\r\n' +
          'Set-Service ssh-agent -StartupType Manual; Start-Service ssh-agent'
        );
      } else {
        throw new Error(
          'Smartcard authentication for SFTP requires ssh-agent, but none is running and automatic startup failed: ' +
          (agentStatus.error || 'Check openssh-client installation.')
        );
      }
    }

    try {
      const sshAddBin = process.platform === 'win32' ? 'ssh-add.exe' : 'ssh-add';
      const env: NodeJS.ProcessEnv = { ...process.env, SSH_AUTH_SOCK: agentSock };

      const listRes = await execFileAsync(sshAddBin, ['-l'], { env }).catch(() => ({ stdout: '' }));
      if (listRes.stdout && listRes.stdout.includes(libPath)) {
        return;
      }

      let askpassServer: AskpassServer | undefined;
      let askpassEnv: Record<string, string> = {};
      const pin = (this.config as any).pin || this.config.passphrase;

      if (pin) {
        askpassServer = new AskpassServer({
          promptHandler: () => pin,
        });
        await askpassServer.start();
        askpassEnv = askpassServer.getEnv();
      }

      try {
        await execFileAsync(sshAddBin, ['-s', libPath], {
          env: {
            ...env,
            ...askpassEnv,
          },
        });
      } finally {
        if (askpassServer) {
          await askpassServer.stop();
        }
      }
    } catch (err) {
      console.warn('SFTPStorageProvider: Attempting ssh-add -s smartcard loading:', err);
    }
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
        if (this.config.authType === 'smartcard' && this.config.pkcs11LibPath) {
          await this.loadSmartcardIntoAgent();
        }
        const candidates = this.buildConnectCandidates();
        let lastErr: unknown;
        for (const options of candidates) {
          // A fresh client per candidate: retrying .connect() on the same
          // ssh2-sftp-client instance after a failed attempt leaves its
          // underlying ssh2 connection in a broken state and the next
          // connect() call hangs indefinitely instead of failing or
          // succeeding cleanly.
          const client = new SftpClient();
          let sock: any = undefined;
          try {
            const connectOpts = { ...options };
            if (this.config.proxyJump && this.config.proxyJump.trim()) {
              const jumpTarget = parseJumpHost(this.config.proxyJump, this.config.username);
              const jumpClient = new SSH2Client();
              await new Promise<void>((resolve, reject) => {
                jumpClient.on('ready', () => resolve());
                jumpClient.on('error', (err) => reject(err));
                const jumpOpts: any = {
                  host: jumpTarget.host,
                  port: jumpTarget.port,
                  username: jumpTarget.username,
                  readyTimeout: 15000,
                };
                const agent =
                  this.config.agentPath ??
                  (process.platform === 'win32'
                    ? process.env.SSH_AUTH_SOCK || '\\\\.\\pipe\\pageant'
                    : process.env.SSH_AUTH_SOCK);
                if (agent) {
                  jumpOpts.agent = agent;
                }
                if (this.config.password) {
                  jumpOpts.password = this.config.password;
                }
                if (this.config.privateKeyPath && fs.existsSync(this.config.privateKeyPath)) {
                  jumpOpts.privateKey = fs.readFileSync(this.config.privateKeyPath);
                  if (this.config.passphrase) jumpOpts.passphrase = this.config.passphrase;
                }
                jumpClient.connect(jumpOpts);
              });
              this.jumpClient = jumpClient;
              sock = await new Promise<any>((resolve, reject) => {
                jumpClient.forwardOut('127.0.0.1', 0, this.config.host, this.config.port ?? 22, (err, stream) => {
                  if (err) return reject(err);
                  resolve(stream);
                });
              });
              connectOpts.sock = sock;
            } else if (this.config.proxy?.enabled && this.config.proxy.host) {
              sock = await createProxySocket(this.config.proxy, {
                host: this.config.host,
                port: this.config.port ?? 22,
              });
              connectOpts.sock = sock;
            }
            await client.connect(connectOpts as any);
            this.client = client;
            this.attachLifecycleListeners(client);
            this.isConnected = true;
            return;
          } catch (err) {
            lastErr = err;
            if (sock) {
              try { sock.destroy(); } catch { /* ignore */ }
            }
            if (this.jumpClient) {
              try { this.jumpClient.end(); } catch { /* ignore */ }
              this.jumpClient = undefined;
            }
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

  async chmod(remotePath: string, mode: number | string): Promise<void> {
    await this.ensureConnected();
    const normalized = path.posix.normalize(remotePath.replace(/\\/g, '/'));
    const numericMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
    if (Number.isNaN(numericMode)) {
      throw new Error(`Invalid chmod mode: ${mode}`);
    }
    await this.client.chmod(normalized, numericMode);
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
      if (this.jumpClient) {
        try { this.jumpClient.end(); } catch { /* ignore */ }
        this.jumpClient = undefined;
      }
      this.isConnected = false;
    }
  }
}
