import crypto from 'node:crypto';
import path from 'node:path';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import type { DotfileDiffEntry, DotfilePool, DotfilePoolFile } from '../../shared/types/dotfiles';
import { DotfileCliTransport } from './DotfileCliTransport';

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

export interface IDotfileTransport {
  getHomeDir(): Promise<string>;
  readRemoteFile(remotePath: string): Promise<Buffer>;
  writeRemoteFile(remotePath: string, content: string, mode?: string): Promise<void>;
  disconnect?(): Promise<void>;
}

export interface ComputeDiffOptions {
  controlPath?: string;
  onPresence?: () => void;
  onPresenceCleared?: () => void;
  transport?: IDotfileTransport;
}

/**
 * Checks a dotfiles pool against a live host and, on request, applies the
 * pool's files, over the OpenSSH CLI (multiplexed via ControlMaster on Unix, direct
 * CLI on Windows). `ComputeDiffOptions.transport` replaces it (used by tests).
 */
export class DotfileSyncService {
  public async computeDiff(
    config: SSHConnectionConfig,
    pool: DotfilePool,
    options: ComputeDiffOptions = {}
  ): Promise<{ provider: IDotfileTransport; entries: DotfileDiffEntry[] }> {
    const transport: IDotfileTransport =
      options.transport ??
      new DotfileCliTransport(config, options.controlPath, options.onPresence, options.onPresenceCleared);

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
  public async applyFiles(transport: IDotfileTransport, files: DotfilePoolFile[]): Promise<void> {
    const homeDir = await transport.getHomeDir();
    for (const file of files) {
      const targetPath = resolveRemotePath(file.remotePath, homeDir);
      await transport.writeRemoteFile(targetPath, file.content, file.mode);
    }
  }
}
