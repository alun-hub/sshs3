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
 */
export function resolveRemotePath(remotePath: string, homeDir: string): string {
  const p = (remotePath || '').replace(/\\/g, '/').trim();
  if (p === '~' || p === '' || p === '.') {
    return homeDir;
  }
  if (p.startsWith('~/')) {
    return path.posix.join(homeDir, p.slice(2));
  }
  if (p.startsWith('~')) {
    return path.posix.join(homeDir, p.slice(1));
  }
  if (!p.startsWith('/')) {
    return path.posix.join(homeDir, p);
  }
  return path.posix.normalize(p);
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

/**
 * Checks a dotfiles pool against a live host and, on request, applies the
 * pool's files. Runs over a short-lived SFTP connection separate from the
 * interactive PTY session, so it never competes with or blocks the terminal.
 */
export class DotfileSyncService {
  public async computeDiff(
    config: SSHConnectionConfig,
    pool: DotfilePool,
    hostVerifier?: SshHostVerifierFn
  ): Promise<{ provider: SFTPStorageProvider; entries: DotfileDiffEntry[] }> {
    const provider = this.createProvider(config, hostVerifier);
    await provider.ensureConnected();

    const homeDir = await provider.getHomeDir();
    const entries: DotfileDiffEntry[] = [];
    for (const file of pool.files) {
      const targetPath = resolveRemotePath(file.remotePath, homeDir);
      try {
        const remoteBuf = await readRemoteFile(provider, targetPath);
        if (hash(remoteBuf.toString('utf-8')) !== hash(file.content)) {
          entries.push({ fileId: file.id, remotePath: file.remotePath, reason: 'different' });
        }
      } catch {
        // Missing, unreadable, or permission-denied: treat as needing an upload.
        entries.push({ fileId: file.id, remotePath: file.remotePath, reason: 'missing' });
      }
    }

    return { provider, entries };
  }

  /**
   * Writes each file to a temp path and renames it over the target so a
   * dropped connection never leaves a half-written dotfile behind.
   */
  public async applyFiles(provider: SFTPStorageProvider, files: DotfilePoolFile[]): Promise<void> {
    const homeDir = await provider.getHomeDir();
    for (const file of files) {
      const targetPath = resolveRemotePath(file.remotePath, homeDir);
      const dir = path.posix.dirname(targetPath);
      if (dir && dir !== '.' && dir !== '/') {
        try {
          await provider.createFolder(dir);
        } catch {
          // Directory likely already exists.
        }
      }

      const tmpPath = `${targetPath}.sshs3.tmp`;
      try {
        const writeStream = await provider.createWriteStream(tmpPath);
        await new Promise<void>((resolve, reject) => {
          writeStream.on('error', reject);
          writeStream.on('close', resolve);
          writeStream.end(file.content, 'utf-8');
        });
        await provider.rename(tmpPath, targetPath);

        if (file.mode) {
          try {
            await provider.chmod(targetPath, file.mode);
          } catch {
            // Non-fatal: content is correct even if the mode couldn't be set.
          }
        }
      } catch (err) {
        // Clean up temporary file if write or rename failed
        try {
          await provider.delete(tmpPath, false);
        } catch {
          // Ignore cleanup error
        }
        throw err;
      }
    }
  }

  private createProvider(config: SSHConnectionConfig, hostVerifier?: SshHostVerifierFn): SFTPStorageProvider {
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
      hostVerifier
    );
  }
}
