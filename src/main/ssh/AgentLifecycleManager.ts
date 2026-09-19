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
   * Spawns a fresh, private ssh-agent dedicated to a single caller and never
   * shared with the desktop's own agent (whatever the inherited
   * SSH_AUTH_SOCK points at). Unlike ensureAgent(), this never reuses an
   * existing agent and never mutates process.env, so loading a smartcard
   * into it cannot leak into — or fight with — the user's desktop
   * keyring/wallet agent. Callers are responsible for killing it via
   * killPrivateAgent() once done.
   *
   * Windows has no equivalent of `ssh-agent -s`: Win32-OpenSSH's ssh-agent.exe
   * only runs as the singleton "ssh-agent" Windows service bound to the fixed
   * pipe `\\.\pipe\openssh-ssh-agent` — it refuses to start a second,
   * independent instance on a caller-chosen pipe. So on win32 this reuses
   * that shared service pipe instead of spawning anything, and returns a
   * sentinel pid of 0 (not a real process we own) so killPrivateAgent()
   * knows not to kill it — see unloadCard() for how a caller actually evicts
   * just its own card from that shared agent afterwards.
   */
  public static async spawnPrivateAgent(): Promise<{ pid: number; socketPath: string }> {
    if (process.platform === 'win32') {
      const pipe = '\\\\.\\pipe\\openssh-ssh-agent';
      if (await this.probeSocket(pipe)) {
        return { pid: 0, socketPath: pipe };
      }
      throw new Error(
        'Windows OpenSSH Authentication Agent service is not running. Enable it in an Administrator ' +
          'PowerShell: Set-Service ssh-agent -StartupType Manual; Start-Service ssh-agent'
      );
    }

    const { stdout } = await execFileAsync('ssh-agent', ['-s']);
    const sockMatch = stdout.match(/SSH_AUTH_SOCK=([^;]+);/);
    const pidMatch = stdout.match(/SSH_AGENT_PID=(\d+);/);

    if (!sockMatch?.[1] || !pidMatch?.[1]) {
      throw new Error('Failed to parse ssh-agent output while spawning a private agent.');
    }

    return { pid: parseInt(pidMatch[1], 10), socketPath: sockMatch[1].trim() };
  }

  /**
   * Terminates a private agent previously returned by spawnPrivateAgent().
   * A pid <= 0 marks a shared agent we don't own (the Windows service pipe
   * sentinel) — never kill that; use unloadCard() to evict just our card.
   */
  public static killPrivateAgent(pid: number): void {
    if (pid <= 0) return;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already dead or permission denied
    }
  }

  /**
   * Removes a single PKCS#11 module's identities from the agent at
   * socketPath (`ssh-add -e`), without touching anything else the agent
   * holds. This is how callers evict just their own card from a shared
   * agent they don't own outright (e.g. the Windows service pipe returned
   * by spawnPrivateAgent()) — killPrivateAgent() can't do that there since
   * there's no owned process to terminate. Errors are swallowed: this is
   * best-effort cleanup, not something a caller should fail over.
   */
  public static async unloadCard(socketPath: string, pkcs11LibPath: string): Promise<void> {
    const sshAddBin = process.platform === 'win32' ? 'ssh-add.exe' : 'ssh-add';
    try {
      await execFileAsync(sshAddBin, ['-e', pkcs11LibPath], {
        env: { ...process.env, SSH_AUTH_SOCK: socketPath },
      });
    } catch {
      // Best-effort: nothing loaded, agent unreachable, etc.
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
