import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import net from 'node:net';

const execFileAsync = promisify(execFile);

export interface AgentStatus {
  isRunning: boolean;
  socketPath?: string;
  isManaged: boolean;
  platform: string;
  instructions?: string;
  error?: string;
}

export class AgentLifecycleManager {
  private static spawnedPid: number | null = null;
  private static spawnedSocket: string | null = null;
  private static isEnsuring = false;

  /**
   * Probes a Windows named pipe or Unix socket to check if it accepts connections.
   */
  public static async probeSocket(socketPath: string, timeoutMs = 300): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(socketPath);
      let settled = false;

      const finish = (result: boolean) => {
        if (!settled) {
          settled = true;
          try {
            socket.destroy();
          } catch {
            // Ignore
          }
          resolve(result);
        }
      };

      socket.on('connect', () => finish(true));
      socket.on('error', () => finish(false));
      socket.setTimeout(timeoutMs, () => finish(false));
    });
  }

  /**
   * Checks the status of the SSH agent without attempting to spawn one.
   */
  public static async getStatus(): Promise<AgentStatus> {
    const platform = process.platform;

    // 1. Check if we already manage a spawned agent
    if (this.spawnedPid && this.spawnedSocket) {
      if (platform !== 'win32' && !fs.existsSync(this.spawnedSocket)) {
        this.spawnedPid = null;
        this.spawnedSocket = null;
      } else {
        return {
          isRunning: true,
          socketPath: this.spawnedSocket,
          isManaged: true,
          platform,
        };
      }
    }

    // 2. Check process.env.SSH_AUTH_SOCK
    if (process.env.SSH_AUTH_SOCK) {
      const sock = process.env.SSH_AUTH_SOCK;
      if (platform !== 'win32') {
        if (fs.existsSync(sock)) {
          return {
            isRunning: true,
            socketPath: sock,
            isManaged: false,
            platform,
          };
        }
      } else {
        return {
          isRunning: true,
          socketPath: sock,
          isManaged: false,
          platform,
        };
      }
    }

    // 3. Windows named pipes
    if (platform === 'win32') {
      const openSshPipe = '\\\\.\\pipe\\openssh-ssh-agent';
      const pageantPipe = '\\\\.\\pipe\\pageant';

      if (await this.probeSocket(openSshPipe)) {
        return {
          isRunning: true,
          socketPath: openSshPipe,
          isManaged: false,
          platform,
        };
      }

      if (await this.probeSocket(pageantPipe)) {
        return {
          isRunning: true,
          socketPath: pageantPipe,
          isManaged: false,
          platform,
        };
      }

      return {
        isRunning: false,
        isManaged: false,
        platform,
        instructions:
          'Windows OpenSSH Authentication Agent service is not running. To enable it, run in Administrator PowerShell: Set-Service ssh-agent -StartupType Manual; Start-Service ssh-agent',
      };
    }

    return {
      isRunning: false,
      isManaged: false,
      platform,
      instructions: 'No active ssh-agent detected in SSH_AUTH_SOCK.',
    };
  }

  /**
   * Ensures an SSH agent is available. If none is found, attempts to spawn one on Linux/macOS.
   */
  public static async ensureAgent(): Promise<AgentStatus> {
    if (this.isEnsuring) {
      return this.getStatus();
    }
    this.isEnsuring = true;

    try {
      const current = await this.getStatus();
      if (current.isRunning) {
        return current;
      }

      if (process.platform === 'win32') {
        return current; // On Windows, user must start the service
      }

      // On Linux/macOS: spawn ssh-agent -s
      try {
        const { stdout } = await execFileAsync('ssh-agent', ['-s']);
        const sockMatch = stdout.match(/SSH_AUTH_SOCK=([^;]+);/);
        const pidMatch = stdout.match(/SSH_AGENT_PID=(\d+);/);

        if (sockMatch && sockMatch[1]) {
          const socketPath = sockMatch[1].trim();
          const pid = pidMatch ? parseInt(pidMatch[1].trim(), 10) : null;

          process.env.SSH_AUTH_SOCK = socketPath;
          if (pid) {
            process.env.SSH_AGENT_PID = String(pid);
            this.spawnedPid = pid;
          }
          this.spawnedSocket = socketPath;

          return {
            isRunning: true,
            socketPath,
            isManaged: true,
            platform: process.platform,
          };
        }
      } catch (spawnErr) {
        const errorMsg = spawnErr instanceof Error ? spawnErr.message : String(spawnErr);
        return {
          isRunning: false,
          isManaged: false,
          platform: process.platform,
          error: `Failed to spawn ssh-agent: ${errorMsg}`,
          instructions: 'Ensure openssh-client (ssh-agent) is installed in PATH.',
        };
      }

      return await this.getStatus();
    } finally {
      this.isEnsuring = false;
    }
  }

  /**
   * Stops the managed ssh-agent process if one was spawned by this app.
   */
  public static async stopManagedAgent(): Promise<void> {
    if (this.spawnedPid) {
      const pid = this.spawnedPid;
      this.spawnedPid = null;
      this.spawnedSocket = null;

      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already dead or permission denied
      }

      if (process.env.SSH_AGENT_PID === String(pid)) {
        delete process.env.SSH_AGENT_PID;
        delete process.env.SSH_AUTH_SOCK;
      }
    }
  }

  /**
   * For testing: resets internal state.
   */
  public static _reset(): void {
    this.spawnedPid = null;
    this.spawnedSocket = null;
    this.isEnsuring = false;
  }
}
