import crypto from 'node:crypto';
import path from 'node:path';
import { SFTPStorageProvider } from '../storage/SFTPStorageProvider';
import type { SshHostVerifierFn } from '../ssh/HostKeyVerifier';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { DotfileDiffEntry, DotfilePool, DotfilePoolFile } from '../../shared/types/dotfiles';

function hash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Resolves a remote path (e.g. "~/.bashrc" or ".bashrc") against the remote user's home directory.
 *
 * A dotfile pool's entries can arrive from remote profile sync (a
 * compromised sync target, paired device, or leaked master password), so a
 * home-relative remotePath containing "../" segments must not be able to
 * escape homeDir via path.posix.join's normalization (e.g.
 * "../../../etc/cron.d/x") — that would let a malicious pool entry write to
 * an arbitrary path on the connected SSH server. An explicitly *absolute*
 * remotePath (starting with "/") is left as the caller's deliberate choice
 * and is not subject to this guard.
 */
export function resolveRemotePath(remotePath: string, homeDir: string): string {
  const p = (remotePath || '').replace(/\\/g, '/').trim();
  if (p === '~' || p === '' || p === '.') {
    return homeDir;
  }
  if (p.startsWith('/')) {
    return path.posix.normalize(p);
  }

  let resolved: string;
  if (p.startsWith('~/')) {
    resolved = path.posix.join(homeDir, p.slice(2));
  } else if (p.startsWith('~')) {
    resolved = path.posix.join(homeDir, p.slice(1));
  } else {
    resolved = path.posix.join(homeDir, p);
  }

  const homeWithSep = homeDir.endsWith('/') ? homeDir : `${homeDir}/`;
  if (resolved !== homeDir && !resolved.startsWith(homeWithSep)) {
    // "../" segments walked the resolved path outside homeDir - clamp to a
    // flat filename inside it instead of ever touching the escaped path.
    return path.posix.join(homeDir, path.posix.basename(p) || 'unnamed-file');
  }
  return resolved;
}

async function readRemoteFile(provider: SFTPStorageProvider, remotePath: string): Promise<Buffer> {
  const stream = await provider.createReadStream(remotePath);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

import { DotfileCliTransport } from './DotfileCliTransport';

export interface IDotfileTransport {
  getHomeDir(): Promise<string>;
  readRemoteFile(remotePath: string): Promise<Buffer>;
  writeRemoteFile(remotePath: string, content: string, mode?: string): Promise<void>;
  disconnect?(): Promise<void>;
}

export class SftpDotfileTransport implements IDotfileTransport {
  constructor(public readonly provider: SFTPStorageProvider) {}

  public async getHomeDir(): Promise<string> {
    await this.provider.ensureConnected?.();
    return this.provider.getHomeDir();
  }

  public async readRemoteFile(remotePath: string): Promise<Buffer> {
    return readRemoteFile(this.provider, remotePath);
  }

  public async writeRemoteFile(remotePath: string, content: string, mode?: string): Promise<void> {
    const dir = path.posix.dirname(remotePath);
    if (dir && dir !== '.' && dir !== '/') {
      try {
        await this.provider.createFolder(dir);
      } catch {
        // Directory likely already exists.
      }
    }

    const tmpPath = `${remotePath}.sshs3.tmp`;
    try {
      const writeStream = await this.provider.createWriteStream(tmpPath);
      await new Promise<void>((resolve, reject) => {
        writeStream.on('error', reject);
        writeStream.on('close', resolve);
        writeStream.end(content, 'utf-8');
      });
      await this.provider.rename(tmpPath, remotePath);

      if (mode) {
        try {
          await this.provider.chmod(remotePath, mode);
        } catch {
          // Non-fatal: content is correct even if the mode couldn't be set.
        }
      }
    } catch (err) {
      try {
        await this.provider.delete(tmpPath, false);
      } catch {
        // Ignore cleanup error
      }
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    await this.provider.disconnect?.().catch(() => {});
  }
}

export interface ComputeDiffOptions {
  hostVerifier?: SshHostVerifierFn;
  pinPromptHandler?: (prompt: string) => Promise<string> | string;
  controlPath?: string;
  onPresence?: () => void;
  onPresenceCleared?: () => void;
  transport?: IDotfileTransport;
}

/**
 * Checks a dotfiles pool against a live host and, on request, applies the
 * pool's files. Prefers OpenSSH CLI (multiplexed via ControlMaster on Unix or
 * direct CLI on Windows) for FIDO2 and speed, falling back to SFTP when needed.
 */
export class DotfileSyncService {
  public async computeDiff(
    config: SSHConnectionConfig,
    pool: DotfilePool,
    optionsOrHostVerifier?: SshHostVerifierFn | ComputeDiffOptions,
    pinPromptHandler?: (prompt: string) => Promise<string> | string,
    controlPath?: string,
    onPresence?: () => void,
    onPresenceCleared?: () => void
  ): Promise<{ provider: IDotfileTransport; entries: DotfileDiffEntry[] }> {
    let options: ComputeDiffOptions;
    if (
      typeof optionsOrHostVerifier === 'object' &&
      optionsOrHostVerifier !== null &&
      !('length' in optionsOrHostVerifier)
    ) {
      options = optionsOrHostVerifier as ComputeDiffOptions;
    } else {
      options = {
        hostVerifier: optionsOrHostVerifier as SshHostVerifierFn | undefined,
        pinPromptHandler,
        controlPath,
        onPresence,
        onPresenceCleared,
      };
    }

    let transport: IDotfileTransport;
    if (options.transport) {
      transport = options.transport;
    } else if (
      (this as any).createProvider !== (DotfileSyncService.prototype as any).createProvider
    ) {
      // Honors mockProvider in tests
      const sftpProvider = this.createProvider(config, options.hostVerifier, options.pinPromptHandler);
      transport = new SftpDotfileTransport(sftpProvider);
    } else {
      transport = new DotfileCliTransport(
        config,
        options.controlPath,
        options.onPresence,
        options.onPresenceCleared
      );
    }

    const homeDir = await transport.getHomeDir();
    const entries: DotfileDiffEntry[] = [];
    for (const file of pool.files) {
      const targetPath = resolveRemotePath(file.remotePath, homeDir);
      try {
        const remoteBuf = await transport.readRemoteFile(targetPath);
        if (hash(remoteBuf.toString('utf-8')) !== hash(file.content)) {
          entries.push({ fileId: file.id, remotePath: file.remotePath, reason: 'different' });
        }
      } catch {
        // Missing, unreadable, or permission-denied: treat as needing an upload.
        entries.push({ fileId: file.id, remotePath: file.remotePath, reason: 'missing' });
      }
    }

    return { provider: transport, entries };
  }

  /**
   * Writes each file to a temp path and renames it over the target so a
   * dropped connection never leaves a half-written dotfile behind.
   */
  public async applyFiles(providerOrTransport: any, files: DotfilePoolFile[]): Promise<void> {
    const transport: IDotfileTransport =
      typeof providerOrTransport.writeRemoteFile === 'function'
        ? providerOrTransport
        : new SftpDotfileTransport(providerOrTransport);

    const homeDir = await transport.getHomeDir();
    for (const file of files) {
      const targetPath = resolveRemotePath(file.remotePath, homeDir);
      await transport.writeRemoteFile(targetPath, file.content, file.mode);
    }
  }

  private createProvider(
    config: SSHConnectionConfig,
    hostVerifier?: SshHostVerifierFn,
    pinPromptHandler?: (prompt: string) => Promise<string> | string
  ): SFTPStorageProvider {
    return new SFTPStorageProvider(
      {
        id: `dotfiles-${crypto.randomUUID()}`,
        name: `Dotfiles sync: ${config.name}`,
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
        authType: config.authType,
        password: config.password,
        privateKeyPath: config.privateKeyPath,
        passphrase: config.passphrase,
        agentPath: config.agentPath,
        pkcs11LibPath: config.pkcs11LibPath,
        proxy: config.proxy,
        serverAliveInterval: config.serverAliveInterval,
        ciphers: config.ciphers,
        kexAlgorithms: config.kexAlgorithms,
        macs: config.macs,
      },
      undefined,
      hostVerifier,
      pinPromptHandler
    );
  }
}
