import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitRepoStatus } from '../../shared/types/git';
import type { StorageRegistry } from '../storage/StorageRegistry';
import { safeGitConfigArgs, safeGitEnv } from './gitSafety';

const execFileAsync = promisify(execFile);

function resolveGitBinary(): string {
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

/** Parses branch and commit from .git/HEAD file content. */
export function parseHeadBranch(headContent: string): string | undefined {
  const trimmed = headContent.trim();
  if (trimmed.startsWith('ref: refs/heads/')) {
    return trimmed.slice('ref: refs/heads/'.length).trim();
  }
  if (trimmed.startsWith('ref: refs/')) {
    return trimmed.slice('ref: refs/'.length).trim();
  }
  if (/^[0-9a-fA-F]{40}$/.test(trimmed)) {
    return trimmed.slice(0, 7); // Detached HEAD at commit SHA
  }
  return undefined;
}

/** Extracts the remote origin URL from a .git/config file content. */
export function parseOriginUrl(gitConfigContent: string): string | undefined {
  const match = /\[remote\s+"origin"\][^[]*url\s*=\s*([^\r\n]+)/i.exec(gitConfigContent);
  return match ? match[1].trim() : undefined;
}

/** Converts git@ or https url to browser web URL for GitHub/GitLab/Bitbucket. */
export function toWebRepoUrl(gitUrl: string): string | undefined {
  const trimmed = gitUrl.trim();
  // git@github.com:owner/repo.git
  const scpMatch = /^git@([^:]+):([^/]+)\/(.+?)(\.git)?$/.exec(trimmed);
  if (scpMatch) {
    const [, host, owner, repo] = scpMatch;
    return `https://${host}/${owner}/${repo}`;
  }
  // https://github.com/owner/repo.git
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed.replace(/\.git$/, '');
  }
  return undefined;
}

export class GitStatusService {
  /**
   * Discovers and queries Git status for a directory.
   */
  public static async getStatus(
    directoryPath: string,
    providerId?: string,
    storageRegistry?: StorageRegistry
  ): Promise<GitRepoStatus> {
    if (!directoryPath || typeof directoryPath !== 'string') {
      return { isRepo: false };
    }

    // Remote SFTP handling via storage provider
    if (providerId && providerId !== 'local' && storageRegistry) {
      return this.getRemoteSftpStatus(directoryPath, providerId, storageRegistry);
    }

    return this.getLocalStatus(directoryPath);
  }

  private static async getLocalStatus(directoryPath: string): Promise<GitRepoStatus> {
    try {
      let currentDir = path.resolve(directoryPath);
      let gitDir: string | null = null;
      let rootPath: string | null = null;

      // Search up to 10 directory levels for .git
      for (let i = 0; i < 10; i++) {
        const check = path.join(currentDir, '.git');
        try {
          const stat = await fs.stat(check);
          if (stat.isDirectory()) {
            gitDir = check;
            rootPath = currentDir;
            break;
          } else if (stat.isFile()) {
            // Worktree or submodule reference: "gitdir: <path>"
            const content = await fs.readFile(check, 'utf-8');
            const match = /gitdir:\s*([^\r\n]+)/i.exec(content);
            if (match) {
              const rel = match[1].trim();
              const resolved = path.isAbsolute(rel) ? rel : path.resolve(currentDir, rel);
              // Only accept worktree/submodule pointers into a .git directory; arbitrary targets are untrusted.
              if (/[\\/]\.git[\\/](worktrees|modules)[\\/]/.test(resolved + path.sep)) {
                gitDir = resolved;
                rootPath = currentDir;
                break;
              }
            }
          }
        } catch {
          // not found at this level
        }

        const parent = path.dirname(currentDir);
        if (parent === currentDir) break;
        currentDir = parent;
      }

      if (!gitDir || !rootPath) {
        return { isRepo: false };
      }

      // Fast read of HEAD and config directly from filesystem
      let branch: string | undefined;
      let remoteOriginUrl: string | undefined;

      try {
        const headContent = await fs.readFile(path.join(gitDir, 'HEAD'), 'utf-8');
        branch = parseHeadBranch(headContent);
      } catch {
        // HEAD unreadable
      }

      try {
        const configContent = await fs.readFile(path.join(gitDir, 'config'), 'utf-8');
        remoteOriginUrl = parseOriginUrl(configContent);
      } catch {
        // config unreadable
      }

      // Try running git status for detailed counts and ahead/behind info
      let isClean = true;
      let ahead = 0;
      let behind = 0;
      let untrackedCount = 0;
      let modifiedCount = 0;

      try {
        const gitBin = resolveGitBinary();
        const { stdout } = await execFileAsync(
          gitBin,
          [...safeGitConfigArgs(), '--no-optional-locks', 'status', '--porcelain=v1', '-b'],
          { cwd: rootPath, timeout: 2500, env: safeGitEnv() }
        );

        const lines = stdout.split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          if (line.startsWith('## ')) {
            // e.g. "## main...origin/main [ahead 1, behind 2]"
            const aheadMatch = /ahead\s+(\d+)/.exec(line);
            if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
            const behindMatch = /behind\s+(\d+)/.exec(line);
            if (behindMatch) behind = parseInt(behindMatch[1], 10);
          } else if (line.startsWith('??')) {
            untrackedCount++;
          } else {
            modifiedCount++;
          }
        }
        isClean = untrackedCount === 0 && modifiedCount === 0;
      } catch {
        // git command failed or not installed, fallback to static info
      }

      return {
        isRepo: true,
        branch,
        rootPath,
        remoteOriginUrl,
        isClean,
        ahead,
        behind,
        untrackedCount,
        modifiedCount,
      };
    } catch {
      return { isRepo: false };
    }
  }

  private static async getRemoteSftpStatus(
    directoryPath: string,
    providerId: string,
    storageRegistry: StorageRegistry
  ): Promise<GitRepoStatus> {
    try {
      const provider = storageRegistry.get(providerId);
      if (!provider) return { isRepo: false };

      const cleanPath = directoryPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const headPath = `${cleanPath}/.git/HEAD`;
      const configPath = `${cleanPath}/.git/config`;

      let branch: string | undefined;
      let remoteOriginUrl: string | undefined;

      try {
        const stream = await provider.createReadStream(headPath);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          if (chunks.reduce((acc, c) => acc + c.length, 0) > 4096) break;
        }
        const text = Buffer.concat(chunks).toString('utf-8');
        branch = parseHeadBranch(text);
      } catch {
        return { isRepo: false };
      }

      try {
        const stream = await provider.createReadStream(configPath);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          if (chunks.reduce((acc, c) => acc + c.length, 0) > 8192) break;
        }
        const text = Buffer.concat(chunks).toString('utf-8');
        remoteOriginUrl = parseOriginUrl(text);
      } catch {
        // config not readable
      }

      return {
        isRepo: true,
        branch,
        rootPath: cleanPath,
        remoteOriginUrl,
      };
    } catch {
      return { isRepo: false };
    }
  }
}
