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
  private static ensuringPromise: Promise<AgentStatus> | null = null;
  private static activePrivateAgents = new Set<number>();
  private static exitHandlersInstalled = false;

  private static installExitHandlers(): void {
    if (this.exitHandlersInstalled) return;
    this.exitHandlersInstalled = true;

    process.once('exit', () => {
      this.killAllPrivateAgents();
    });

    const signalHandler = (sig: string) => {
      this.killAllPrivateAgents();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };

    // In non-test environments, catch process termination signals
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      process.once('SIGINT', () => signalHandler('SIGINT'));
      process.once('SIGTERM', () => signalHandler('SIGTERM'));
    }
  }

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
   *
   * Concurrent callers (e.g. the app's own startup call racing a local shell
   * tab being restored/opened immediately after) all await the *same*
   * in-flight attempt rather than each getting an independent, possibly
   * stale getStatus() snapshot taken before the spawn finished — otherwise a
   * caller that raced the first invocation could see isRunning:false and
   * silently skip setting SSH_AUTH_SOCK, even though the agent this method
   * was already in the middle of spawning came up moments later.
   */
  public static async ensureAgent(): Promise<AgentStatus> {
    if (this.ensuringPromise) {
      return this.ensuringPromise;
    }

    this.ensuringPromise = this.doEnsureAgent().finally(() => {
      this.ensuringPromise = null;
    });
    return this.ensuringPromise;
  }

  private static async doEnsureAgent(): Promise<AgentStatus> {
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
  /**
   * `extraEnv` is merged into the spawned `ssh-agent` process's own
   * environment (e.g. SSH_ASKPASS/SSH_ASKPASS_REQUIRE) — needed for FIDO2
   * keys with `verify-required`, which prompt for PIN+touch again on every
   * future signature, not just when first loaded. Since that later prompt
   * comes from the long-lived agent process itself (not the one-off
   * `ssh-add` call that loaded the key), giving the *loader* an askpass env
   * isn't enough on its own — without this, the agent falls back to
   * whatever SSH_ASKPASS this app process itself inherited (e.g. the
   * desktop's own ksshaskpass/gnome-ssh-askpass), popping up an
   * unstyled system dialog instead of this app's own PIN modal. Ignored on
   * Windows, which reuses the shared system agent service rather than
   * spawning its own process.
   */
  public static async spawnPrivateAgent(extraEnv?: Record<string, string>): Promise<{ pid: number; socketPath: string }> {
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

    const { stdout } = await execFileAsync('ssh-agent', ['-s'], {
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    const sockMatch = stdout.match(/SSH_AUTH_SOCK=([^;]+);/);
    const pidMatch = stdout.match(/SSH_AGENT_PID=(\d+);/);

    if (!sockMatch?.[1] || !pidMatch?.[1]) {
      throw new Error('Failed to parse ssh-agent output while spawning a private agent.');
    }

    this.installExitHandlers();
    const pid = parseInt(pidMatch[1], 10);
    if (pid > 0) {
      this.activePrivateAgents.add(pid);
    }
    return { pid, socketPath: sockMatch[1].trim() };
  }

  /**
   * Terminates a private agent previously returned by spawnPrivateAgent().
   * A pid <= 0 marks a shared agent we don't own (the Windows service pipe
   * sentinel) — never kill that; use unloadCard() to evict just our card.
   */
  public static killPrivateAgent(pid: number): void {
    if (pid <= 0) return;
    this.activePrivateAgents.delete(pid);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already dead or permission denied
    }
  }

  /**
   * Terminates every private agent currently tracked as spawned by this process.
   */
  public static killAllPrivateAgents(): void {
    for (const pid of this.activePrivateAgents) {
      if (pid > 0) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {
          // Already dead or permission denied
        }
      }
    }
    this.activePrivateAgents.clear();
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
    this.killAllPrivateAgents();
    this.spawnedPid = null;
    this.spawnedSocket = null;
    this.ensuringPromise = null;
  }
}
