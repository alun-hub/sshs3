import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  GitCloneRequest,
  GitOperationResult,
  TestRemoteGitAccessRequest,
  TestRemoteGitAccessResult,
} from '../../shared/types/git';
import type { SSHConnectionConfig } from '../../shared/types/ssh';
import { runSshCommand } from '../ssh/KeyInstallService';
import { hasControlChars, safeGitConfigArgs, safeGitEnv, shellQuote } from './gitSafety';

const execFileAsync = promisify(execFile);

function resolveGitBinary(): string {
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

/** Sanitize clone URL: only allows valid http(s), ssh, or git protocols without shell metacharacters. */
export function isValidGitCloneUrl(rawUrl: string): boolean {
  const url = rawUrl.trim();
  if (!url || url.length > 2000) return false;
  // Disallow shell characters
  if (/[\r\n\t;`$&|><"']/.test(url) || url.startsWith('-')) return false;
  // Check standard git URLs
  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('ssh://') || url.startsWith('git://')) {
    return true;
  }
  // Check scp-like ssh syntax: git@host:owner/repo(.git)?
  const colonIdx = url.indexOf(':');
  if (colonIdx > 0) {
    const userHost = url.slice(0, colonIdx);
    const pathPart = url.slice(colonIdx + 1);
    if (
      /^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+$/.test(userHost) &&
      pathPart.length > 0 &&
      !/[\s;`$&|><"'\\*?~]/.test(pathPart)
    ) {
      return true;
    }
  }
  return false;
}

export class RemoteGitService {
  /**
   * Executes git clone locally or remotely via SSH.
   */
  public static async clone(request: GitCloneRequest): Promise<GitOperationResult> {
    const url = request.url?.trim();
    if (!url || !isValidGitCloneUrl(url)) {
      return { success: false, error: 'Invalid Git repository URL' };
    }

    const targetDir = typeof request.targetDirectory === 'string' ? request.targetDirectory.trim() : '';
    if (!targetDir) {
      return { success: false, error: 'Target directory is required' };
    }
    if (hasControlChars(targetDir)) {
      return { success: false, error: 'Invalid target directory' };
    }

    const dirName = request.directoryName?.trim();
    const args = ['clone'];
    if (request.depth !== undefined && request.depth !== null) {
      if (!Number.isInteger(request.depth) || request.depth < 0) {
        return { success: false, error: 'Invalid clone depth' };
      }
      if (request.depth > 0) args.push('--depth', String(request.depth));
    }
    args.push('--', url);
    if (dirName) {
      if (
        dirName.startsWith('-') ||
        /[\r\n\t;`$&|><"']/.test(dirName) ||
        dirName.includes('/') ||
        dirName.includes('\\')
      ) {
        return { success: false, error: 'Invalid directory name' };
      }
      args.push(dirName);
    }

    // Local clone
    if (!request.providerId || request.providerId === 'local') {
      try {
        const gitBin = resolveGitBinary();
        const { stdout, stderr } = await execFileAsync(gitBin, [...safeGitConfigArgs(), ...args], {
          cwd: targetDir,
          timeout: 120000, // 2 minutes max
          env: safeGitEnv(),
        });
        return { success: true, output: (stdout + '\n' + stderr).trim() };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const msg = (e.stderr || e.stdout || e.message || String(err)).trim();
        return { success: false, error: msg };
      }
    }

    // Remote SFTP clone over SSH
    if (request.sftpConfig) {
      const remoteCmd = `cd -- ${shellQuote(targetDir)} && git ${[...safeGitConfigArgs('/dev/null'), ...args].map(shellQuote).join(' ')}`;
      try {
        const res = await runSshCommand(request.sftpConfig, remoteCmd);
        if (res.code === 0) {
          return { success: true, output: (res.stdout + '\n' + res.stderr).trim() };
        }
        return { success: false, error: (res.stderr || res.stdout || `Process exited with code ${res.code}`).trim() };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'No connection configuration provided for remote clone' };
  }

  /**
   * Executes git pull in the given repository directory.
   */
  public static async pull(
    directoryPath: string,
    providerId?: string,
    sftpConfig?: SSHConnectionConfig
  ): Promise<GitOperationResult> {
    if (!directoryPath || typeof directoryPath !== 'string') {
      return { success: false, error: 'Directory path is required' };
    }
    const dir = directoryPath.trim();
    if (!dir || hasControlChars(dir)) return { success: false, error: 'Directory path is required' };

    // Local pull
    if (!providerId || providerId === 'local') {
      try {
        const gitBin = resolveGitBinary();
        const { stdout, stderr } = await execFileAsync(gitBin, [...safeGitConfigArgs(), 'pull'], {
          cwd: dir,
          timeout: 60000,
          env: safeGitEnv(),
        });
        return { success: true, output: (stdout + '\n' + stderr).trim() };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const msg = (e.stderr || e.stdout || e.message || String(err)).trim();
        return { success: false, error: msg };
      }
    }

    // Remote SFTP pull over SSH
    if (sftpConfig) {
      const remoteCmd = `cd -- ${shellQuote(dir)} && git ${safeGitConfigArgs('/dev/null').map(shellQuote).join(' ')} pull`;
      try {
        const res = await runSshCommand(sftpConfig, remoteCmd);
        if (res.code === 0) {
          return { success: true, output: (res.stdout + '\n' + res.stderr).trim() };
        }
        return { success: false, error: (res.stderr || res.stdout || `Process exited with code ${res.code}`).trim() };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'No connection configuration provided for remote pull' };
  }

  /**
   * Tests remote SSH access to GitHub or GitLab from a remote server using the server's SSH keys / forwarded agent.
   */
  public static async testRemoteAccess(request: TestRemoteGitAccessRequest): Promise<TestRemoteGitAccessResult> {
    const provider = request.provider || 'github';
    const targetHost = provider === 'gitlab' ? 'git@gitlab.com' : 'git@github.com';
    const remoteCmd = `ssh -T -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 ${targetHost}`;

    try {
      const res = await runSshCommand(request.config, remoteCmd);
      const combined = (res.stderr + '\n' + res.stdout).trim();

      // GitHub: "Hi <username>! You've successfully authenticated..."
      const ghMatch = /Hi\s+([a-zA-Z0-9_.-]+)!/i.exec(combined);
      if (ghMatch) {
        return {
          success: true,
          authenticatedUser: ghMatch[1],
          rawOutput: combined,
        };
      }

      // GitLab: "Welcome to GitLab, @<username>!"
      const glMatch = /Welcome to GitLab,\s*@?([a-zA-Z0-9_.-]+)!/i.exec(combined);
      if (glMatch) {
        return {
          success: true,
          authenticatedUser: glMatch[1],
          rawOutput: combined,
        };
      }

      // Check if permission denied
      if (/permission denied/i.test(combined)) {
        return {
          success: false,
          rawOutput: combined,
          error: `Authentication failed: Permission denied (publickey) on ${provider}. The server cannot access ${provider} with current keys/agent.`,
        };
      }

      return {
        success: res.code === 0,
        rawOutput: combined,
        error: res.code !== 0 ? combined : undefined,
      };
    } catch (err) {
      return {
        success: false,
        rawOutput: '',
        error: `Failed to test remote access: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
