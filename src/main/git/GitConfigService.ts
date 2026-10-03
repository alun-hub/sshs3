import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ConfigureGitSigningRequest, ConfigureGitSigningResult, GitSigningConfig } from '../../shared/types/git';

const execFileAsync = promisify(execFile);

function resolveGitBinary(): string {
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

/** Converts Windows backslashes to forward slashes for Git config compatibility. */
export function normalizeGitConfigPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export class GitConfigService {
  /** Reads global Git signing configuration. */
  public static async getSigningConfig(): Promise<GitSigningConfig> {
    const gitBin = resolveGitBinary();
    try {
      const getVal = async (key: string): Promise<string | undefined> => {
        try {
          const { stdout } = await execFileAsync(gitBin, ['config', '--global', '--get', key], {
            timeout: 5000,
          });
          return stdout.trim() || undefined;
        } catch {
          return undefined;
        }
      };

      const [format, signingKey, gpgsign, allowedSignersFile, email] = await Promise.all([
        getVal('gpg.format'),
        getVal('user.signingkey'),
        getVal('commit.gpgsign'),
        getVal('gpg.ssh.allowedSignersFile'),
        getVal('user.email'),
      ]);

      const enabled = format === 'ssh' && gpgsign === 'true' && !!signingKey;
      return {
        enabled,
        format,
        signingKey,
        allowedSignersFile,
        email,
      };
    } catch {
      return { enabled: false };
    }
  }

  /**
   * Configures Git to use SSH signing with the given key and updates `allowed_signers`.
   */
  public static async configureSigning(request: ConfigureGitSigningRequest): Promise<ConfigureGitSigningResult> {
    const gitBin = resolveGitBinary();
    const signingKey = request.signingKey?.trim();
    if (!signingKey) {
      return { success: false, error: 'A signing key is required' };
    }

    try {
      // 1. Get user email if not provided
      let email = request.email?.trim();
      if (!email) {
        try {
          const { stdout } = await execFileAsync(gitBin, ['config', '--global', '--get', 'user.email'], {
            timeout: 5000,
          });
          email = stdout.trim();
        } catch {
          // No email configured
        }
      }

      // 2. Setup allowed_signers file in ~/.ssh/allowed_signers
      const sshDir = path.join(os.homedir(), '.ssh');
      await fs.mkdir(sshDir, { recursive: true });
      const allowedSignersPath = path.join(sshDir, 'allowed_signers');

      let allowedSignersUpdated = false;
      if (email && (signingKey.startsWith('ssh-') || signingKey.startsWith('ecdsa-') || signingKey.startsWith('sk-'))) {
        const parts = signingKey.split(/\s+/);
        const keyData = parts.slice(0, 2).join(' '); // "<type> <base64>"
        const entryLine = `${email} namespaces="git" ${keyData}`;

        let existingContent = '';
        try {
          existingContent = await fs.readFile(allowedSignersPath, 'utf-8');
        } catch {
          // File does not exist yet
        }

        const lines = existingContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (!lines.includes(entryLine)) {
          // Filter out previous entries for this email and key if updating
          const updatedLines = [...lines, entryLine];
          await fs.writeFile(allowedSignersPath, updatedLines.join('\n') + '\n', {
            mode: 0o644,
          });
          allowedSignersUpdated = true;
        }
      }

      // 3. Configure Git global settings
      const normalizedPath = normalizeGitConfigPath(allowedSignersPath);
      await execFileAsync(gitBin, ['config', '--global', 'gpg.format', 'ssh'], { timeout: 5000 });
      await execFileAsync(gitBin, ['config', '--global', 'user.signingkey', signingKey], { timeout: 5000 });
      await execFileAsync(gitBin, ['config', '--global', 'commit.gpgsign', 'true'], { timeout: 5000 });
      await execFileAsync(gitBin, ['config', '--global', 'gpg.ssh.allowedSignersFile', normalizedPath], { timeout: 5000 });

      return {
        success: true,
        allowedSignersUpdated,
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to configure Git signing: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Toggles Git commit.gpgsign on or off globally.
   */
  public static async setSigningEnabled(enabled: boolean): Promise<ConfigureGitSigningResult> {
    const gitBin = resolveGitBinary();
    try {
      await execFileAsync(gitBin, ['config', '--global', 'commit.gpgsign', enabled ? 'true' : 'false'], {
        timeout: 5000,
      });
      if (enabled) {
        await execFileAsync(gitBin, ['config', '--global', 'gpg.format', 'ssh'], { timeout: 5000 });
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: `Failed to update commit.gpgsign: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
