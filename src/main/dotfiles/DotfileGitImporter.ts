import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DotfilePool, DotfilePoolFile } from '../../shared/types/dotfiles';
import type { DotfilesImportFromGitRequest, DotfilesImportFromGitResult } from '../../shared/types/git';
import type { DotfilePoolStore } from './DotfilePoolStore';
import { safeGitConfigArgs, safeGitEnv } from '../git/gitSafety';
import { isValidGitCloneUrl } from '../git/RemoteGitService';

const execFileAsync = promisify(execFile);

function resolveGitBinary(): string {
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

const COMMON_DOTFILES = new Set([
  '.bashrc',
  '.bash_profile',
  '.bash_aliases',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.vimrc',
  '.tmux.conf',
  '.gitconfig',
  '.gitignore_global',
  '.inputrc',
  '.profile',
  '.nanorc',
  'bashrc',
  'zshrc',
  'vimrc',
  'tmux.conf',
  'gitconfig',
]);

const IGNORED_NAMES = new Set([
  '.git',
  '.github',
  '.gitlab',
  'readme.md',
  'readme',
  'license',
  'license.md',
  'install.sh',
  'bootstrap.sh',
  'makefile',
]);

export function parseGitUrl(rawInput: string): { cloneUrl: string; defaultPoolName: string } {
  const trimmed = rawInput.trim();
  // e.g. "user/repo" -> https://github.com/user/repo.git
  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    const [owner, repo] = trimmed.split('/');
    return {
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      defaultPoolName: `${repo}-dotfiles`,
    };
  }

  if (!isValidGitCloneUrl(trimmed)) {
    throw new Error('Invalid Git repository URL or GitHub user/repo format');
  }

  // Derive repo name from URL
  const repoName = trimmed.split('/').pop()?.replace(/\.git$/, '') || 'git';
  return {
    cloneUrl: trimmed,
    defaultPoolName: `${repoName}-dotfiles`,
  };
}

export class DotfileGitImporter {
  public static async importFromGit(
    request: DotfilesImportFromGitRequest,
    poolStore: DotfilePoolStore
  ): Promise<DotfilesImportFromGitResult> {
    const input = request.urlOrRepo?.trim();
    if (!input) {
      return { success: false, error: 'Repository URL or username/repo is required' };
    }

    let cloneUrl: string;
    let poolName: string;
    try {
      const parsed = parseGitUrl(input);
      cloneUrl = parsed.cloneUrl;
      poolName = request.poolName?.trim() || parsed.defaultPoolName;
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-git-dotfiles-'));

    try {
      const gitBin = resolveGitBinary();
      await execFileAsync(gitBin, [...safeGitConfigArgs(), 'clone', '--depth', '1', '--', cloneUrl, tempDir], {
        timeout: 60000,
        env: safeGitEnv(),
      });

      // Walk tempDir to collect matching dotfiles
      const files: DotfilePoolFile[] = [];

      async function scanDir(currentDir: string, relPathPrefix = '') {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const lowerName = entry.name.toLowerCase();
          if (IGNORED_NAMES.has(lowerName)) continue;

          const fullPath = path.join(currentDir, entry.name);
          const relPath = relPathPrefix ? `${relPathPrefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            // Only recurse into config-like directories
            if (entry.name === '.config' || relPathPrefix.startsWith('.config')) {
              await scanDir(fullPath, relPath);
            }
          } else if (entry.isFile()) {
            let remoteTarget: string | null = null;
            if (relPath.startsWith('.config/')) {
              remoteTarget = `~/${relPath}`;
            } else if (COMMON_DOTFILES.has(entry.name)) {
              remoteTarget = entry.name.startsWith('.') ? `~/${entry.name}` : `~/.${entry.name}`;
            }

            if (remoteTarget) {
              const stat = await fs.stat(fullPath);
              if (stat.size <= 512 * 1024) {
                // Max 512 KB per file
                const content = await fs.readFile(fullPath, 'utf-8');
                files.push({
                  id: crypto.randomUUID(),
                  remotePath: remoteTarget,
                  content,
                  mode: remoteTarget.includes('.ssh') ? '600' : '644',
                });
              }
            }
          }
        }
      }

      await scanDir(tempDir);

      if (files.length === 0) {
        return {
          success: false,
          error: 'No typical dotfiles (.bashrc, .zshrc, .tmux.conf, .config/*) found in repository',
        };
      }

      const poolId = crypto.randomUUID();
      const pool: DotfilePool = {
        id: poolId,
        name: poolName,
        files,
      };

      await poolStore.savePool(pool);

      return {
        success: true,
        poolId,
        importedFilesCount: files.length,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to import dotfiles from repository: ${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
