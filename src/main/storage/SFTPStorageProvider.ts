import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { Client as SSH2Client } from 'ssh2';
import { createProxySocket } from '../proxy/proxySocket';
import { AgentLifecycleManager } from '../ssh/AgentLifecycleManager';
import { loadSmartcardIntoPrivateAgent } from '../smartcard/SmartcardAgentLoader';
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

/**
 * Parses modifyTime / mtime into epoch ms (UTC), for precise diffing.
 */
function parseModifyTimeMs(stats: any): number | undefined {
  const m = stats.modifyTime ?? stats.mtime;
  if (m === undefined || m === null) {
    return undefined;
  }
  if (m instanceof Date) {
    return m.getTime();
  }
  if (typeof m === 'number') {
    return m > 1e11 ? m : m * 1000;
  }
  if (typeof m === 'string') {
    const d = new Date(m);
    if (!isNaN(d.getTime())) {
      return d.getTime();
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
  private cachedHomeDir?: string;
  private privateAgentPid?: number;
  private pinPromptHandler?: (prompt: string) => Promise<string> | string;

  constructor(
    config: SFTPConfig,
    client?: SftpClient,
    hostVerifier?: SshHostVerifierFn,
    pinPromptHandler?: (prompt: string) => Promise<string> | string
  ) {
    super();
    this.config = { ...config };
    const port = config.port ?? 22;
    this.id = config.id ?? `${config.username}@${config.host}:${port}`;
    this.name = config.name ?? `${config.username}@${config.host}`;
    this.client = client ?? new SftpClient();
    this.hostVerifier = hostVerifier;
    this.pinPromptHandler = pinPromptHandler;
    this.attachLifecycleListeners(this.client);
  }

  private onLifecycleCleanup = (): void => {
    this.isConnected = false;
    if (this.jumpClient) {
      try { this.jumpClient.end(); } catch { /* ignore */ }
      this.jumpClient = undefined;
    }
  };

  private attachLifecycleListeners(client: SftpClient): void {
    if (typeof (client as any).setMaxListeners === 'function') {
      (client as any).setMaxListeners(100);
    }
    if ((client as any).client && typeof (client as any).client.setMaxListeners === 'function') {
      (client as any).client.setMaxListeners(100);
    }
    try {
      client.removeListener('close', this.onLifecycleCleanup);
      client.removeListener('end', this.onLifecycleCleanup);
      client.removeListener('error', this.onLifecycleCleanup);
    } catch {
      // ignore
    }
    client.on('close', this.onLifecycleCleanup);
    client.on('end', this.onLifecycleCleanup);
    client.on('error', this.onLifecycleCleanup);
  }

  /**
   * Builds one or more candidate connect option sets, tried in order until one
   * succeeds. An explicit password or private key is used as-is (single
   * candidate). Otherwise - no credential configured, or authType 'agent' /
   * 'smartcard' / 'fido2' (ssh2 has no PKCS#11 or libfido2 support of its
   * own) - falls back to ssh-agent and then the user's default identity
   * files, same as a bare `ssh host` would. A 'fido2' profile pointing at a
   * key *file* (privateKeyPath, non-resident) is NOT read directly here even
   * though privateKeyPath is set - ssh2 can't parse the `-sk` key format, so
   * it must go through the agent fallback below too, same as resident mode.
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
  /**
   * Ensures the configured PKCS#11 module's key is available to an
   * ssh-agent that this.buildConnectCandidates() can authenticate through
   * (ssh2 has no native PKCS#11 support).
   *
   * If config.agentPath is already set, an agent has already been prepared
   * by the caller (e.g. IpcBridge's 'agent-per-session' smartcard mode) and
   * is trusted to already hold the key — nothing to do here. Otherwise a
   * private, ephemeral agent is spawned and loaded just for this one
   * connection, and torn down again in disconnect(). This never touches the
   * process's inherited SSH_AUTH_SOCK (the desktop's own agent/wallet),
   * which would otherwise register the card there and cause the OS to
   * prompt for its PIN independently of sshs3's own UI.
   */
  private async loadSmartcardIntoAgent(): Promise<void> {
    const libPath = this.config.pkcs11LibPath;
    if (!libPath || this.config.agentPath) return;

    console.log(`[smartcard] SFTPStorageProvider(${this.id}): no agentPath provided, loading its own ephemeral agent`);
    const staticPin = (this.config as any).pin || this.config.passphrase;
    const promptHandler = this.pinPromptHandler ?? (() => staticPin ?? '');

    const { pid, socketPath } = await loadSmartcardIntoPrivateAgent(libPath, promptHandler);
    console.log(`[smartcard] SFTPStorageProvider(${this.id}): ephemeral agent loaded OK, pid=${pid}, socket=${socketPath}`);
    this.privateAgentPid = pid;
    this.config.agentPath = socketPath;
  }

  /**
   * Ensures an active connection to the SFTP server, establishing one if needed.
   * Deduplicates concurrent connection attempts.
   */
  public async ensureConnected(): Promise<void> {
    const rawClient = (this.client as any).client;
    const sock = rawClient?._sock;
    const socketDead = sock && (sock.destroyed || !sock.writable);
    const sftpMissing = (this.client as any).sftp === null;

    if (this.isConnected && !socketDead && !sftpMissing) {
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
          if (typeof (client as any).setMaxListeners === 'function') {
            (client as any).setMaxListeners(100);
          }
          if ((client as any).client && typeof (client as any).client.setMaxListeners === 'function') {
            (client as any).client.setMaxListeners(100);
          }
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
                  jumpOpts.tryKeyboard = true;
                  (jumpClient as any).on(
                    'keyboard-interactive',
                    (
                      _name: string,
                      _instructions: string,
                      _instructionsLang: string,
                      prompts: Array<{ prompt: string; echo: boolean }>,
                      finish: (responses: string[]) => void
                    ) => {
                      finish(prompts.map(() => this.config.password || ''));
                    }
                  );
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
            if (connectOpts.password) {
              connectOpts.tryKeyboard = true;
              client.on(
                'keyboard-interactive',
                (
                  _name: string,
                  _instructions: string,
                  _instructionsLang: string,
                  prompts: Array<{ prompt: string; echo: boolean }>,
                  finish: (responses: string[]) => void
                ) => {
                  finish(prompts.map(() => connectOpts.password));
                }
              );
            }
            await client.connect(connectOpts as any);
            if (this.client && this.client !== client) {
              try {
                this.client.removeListener('close', this.onLifecycleCleanup);
                this.client.removeListener('end', this.onLifecycleCleanup);
                this.client.removeListener('error', this.onLifecycleCleanup);
              } catch { /* ignore */ }
            }
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
        if (lastErr) {
          const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
          if (msg.includes('All configured authentication methods failed')) {
            if (this.config.authType === 'agent') {
              throw new Error(
                'SSH agent authentication failed: The server rejected the agent key, or the agent has no identities loaded (run "ssh-add").'
              );
            }
            throw new Error(
              'Authentication failed: The server rejected the login. Check that the password is correct, or use an SSH key.'
            );
          }
          if (msg.includes('read ECONNRESET')) {
            throw new Error(
              'Connection reset by remote server (read ECONNRESET). The SSH server may have closed the connection or dropped it due to authentication failures.'
            );
          }
          if (msg.includes('getConnection')) {
            const clean = msg.replace(/^getConnection:?\s*/i, '').trim();
            throw new Error(
              `Could not connect to SFTP: ${clean || 'Connection failed'}`
            );
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

  private isConnectionDropError(err: any): boolean {
    if (!err) return false;
    const msg = String(err.message || err);
    const code = err.code;
    return (
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'ECONNABORTED' ||
      code === 'ENOTCONN' ||
      msg.includes('ECONNRESET') ||
      msg.includes('EPIPE') ||
      msg.includes('Not connected') ||
      msg.includes('No SFTP connection')
    );
  }

  private async executeWithReconnect<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureConnected();
    try {
      return await fn();
    } catch (err: any) {
      if (this.isConnectionDropError(err)) {
        this.isConnected = false;
        await this.ensureConnected();
        return await fn();
      }
      throw err;
    }
  }

  public async getHomeDir(): Promise<string> {
    if (this.cachedHomeDir) {
      return this.cachedHomeDir;
    }
    await this.ensureConnected();
    try {
      if (typeof (this.client as any).realPath === 'function') {
        const real = await (this.client as any).realPath('.');
        if (real && real.startsWith('/')) {
          this.cachedHomeDir = real;
          return real;
        }
      }
    } catch {
      // Fallback
    }
    const fallback =
      this.config.username === 'root' ? '/root' : `/home/${this.config.username || 'user'}`;
    this.cachedHomeDir = fallback;
    return fallback;
  }

  public async resolveRemotePath(remotePath: string): Promise<string> {
    const p = (remotePath || '').replace(/\\/g, '/').trim();
    if (p === '~' || p === '' || p === '.') {
      return await this.getHomeDir();
    }
    if (p.startsWith('~/')) {
      const home = await this.getHomeDir();
      return path.posix.join(home, p.slice(2));
    }
    if (p.startsWith('~')) {
      const home = await this.getHomeDir();
      return path.posix.join(home, p.slice(1));
    }
    return path.posix.normalize(p);
  }

  async list(remotePath: string): Promise<FileEntry[]> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);
      const fileList = await this.client.list(resolved);
      const results: FileEntry[] = [];

      for (const item of fileList) {
        const isDir = item.type === 'd' || (item as any).isDirectory === true;
        const entryPath = path.posix.join(resolved, item.name);
        const mtime = parseModifyTime(item);
        const mtimeMs = parseModifyTimeMs(item);

        results.push({
          name: item.name,
          path: entryPath,
          size: item.size,
          isDirectory: isDir,
          mtime,
          mtimeMs,
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
    });
  }

  async stat(remotePath: string): Promise<FileEntry> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);
      const stats = await this.client.stat(resolved);
      const isDir = Boolean(stats.isDirectory);
      const name = path.posix.basename(resolved) || resolved;
      const mtime = parseModifyTime(stats);
      const mtimeMs = parseModifyTimeMs(stats);

      return {
        name,
        path: resolved,
        size: stats.size,
        isDirectory: isDir,
        mtime,
        mtimeMs,
        mimeType: isDir ? undefined : getMimeType(name),
        permissions: extractPermissions(stats),
      };
    });
  }

  async createFolder(remotePath: string): Promise<void> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);
      await this.client.mkdir(resolved, true);
    });
  }

  async delete(remotePath: string, isDirectory: boolean): Promise<void> {
    const resolved = await this.resolveRemotePath(remotePath);
    if (
      resolved === '/' ||
      resolved === '.' ||
      resolved === '..' ||
      remotePath.trim() === '/' ||
      remotePath.trim() === ''
    ) {
      throw new Error(`Cannot delete root directory: ${remotePath}`);
    }

    return this.executeWithReconnect(async () => {
      if (isDirectory) {
        await this.client.rmdir(resolved, true);
      } else {
        await this.client.delete(resolved);
      }
    });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return this.executeWithReconnect(async () => {
      const resolvedOld = await this.resolveRemotePath(oldPath);
      const resolvedNew = await this.resolveRemotePath(newPath);

      // Try posixRename first (OpenSSH extension: atomic rename overwriting destination)
      if (typeof (this.client as any).posixRename === 'function') {
        try {
          await (this.client as any).posixRename(resolvedOld, resolvedNew);
          return;
        } catch {
          // Fall back if server doesn't support the OpenSSH extension
        }
      }

      try {
        await this.client.rename(resolvedOld, resolvedNew);
      } catch (renameErr) {
        // Standard SFTP v3 rename fails if destination exists.
        // Attempt delete of destination and retry rename.
        try {
          await this.client.delete(resolvedNew);
          await this.client.rename(resolvedOld, resolvedNew);
        } catch {
          throw renameErr;
        }
      }
    });
  }

  async createReadStream(
    remotePath: string,
    start?: number,
    end?: number,
  ): Promise<NodeJS.ReadableStream> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);

      if (typeof start === 'number' || typeof end === 'number') {
        const options: { start?: number; end?: number } = {};
        if (typeof start === 'number') options.start = start;
        if (typeof end === 'number') options.end = end;
        return this.client.createReadStream(resolved, options);
      }

      return this.client.createReadStream(resolved);
    });
  }

  async createWriteStream(
    remotePath: string,
    options?: WriteStreamOptions,
  ): Promise<NodeJS.WritableStream> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);

      if (options) {
        return this.client.createWriteStream(resolved, options as any);
      }
      return this.client.createWriteStream(resolved);
    });
  }

  async writeFile(
    remotePath: string,
    data: Buffer | Uint8Array,
    options?: WriteStreamOptions,
  ): Promise<void> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);
      await this.client.put(Buffer.isBuffer(data) ? data : Buffer.from(data), resolved, {
        mode: options?.mode,
      } as any);
    });
  }

  async readFile(remotePath: string): Promise<Buffer> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);
      const res = await this.client.get(resolved);
      return Buffer.isBuffer(res) ? res : Buffer.from(res as any);
    });
  }

  async chmod(remotePath: string, mode: number | string): Promise<void> {
    const numericMode = typeof mode === 'string' ? parseInt(mode, 8) : mode;
    if (Number.isNaN(numericMode)) {
      throw new Error(`Invalid chmod mode: ${mode}`);
    }
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);
      await this.client.chmod(resolved, numericMode);
    });
  }

  async setModifiedTime(remotePath: string, mtimeMs: number): Promise<void> {
    return this.executeWithReconnect(async () => {
      const resolved = await this.resolveRemotePath(remotePath);
      const rawSftp = (this.client as any).sftp;
      if (!rawSftp || typeof rawSftp.setstat !== 'function') {
        throw new Error('setModifiedTime is not supported by this SFTP connection');
      }
      const epochSeconds = Math.floor(mtimeMs / 1000);
      await new Promise<void>((resolve, reject) => {
        rawSftp.setstat(resolved, { atime: epochSeconds, mtime: epochSeconds }, (err: Error | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
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
      if (this.privateAgentPid !== undefined) {
        // Evict just this card first — killPrivateAgent() is a no-op on Windows
        // (the socket is the shared system agent service, not a process we own).
        if (this.config.agentPath && this.config.pkcs11LibPath) {
          void AgentLifecycleManager.unloadCard(this.config.agentPath, this.config.pkcs11LibPath);
        }
        AgentLifecycleManager.killPrivateAgent(this.privateAgentPid);
        this.privateAgentPid = undefined;
      }
      this.isConnected = false;
    }
  }
}
