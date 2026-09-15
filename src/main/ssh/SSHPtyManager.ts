import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { SmartcardDetector } from '../smartcard/SmartcardDetector';
import { AskpassServer } from '../smartcard/AskpassServer';
import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
  SSHPtySession,
} from '../../shared/types/ssh';

function getSpawn(): typeof nodePty.spawn {
  if (typeof (nodePty as any).spawn === 'function') {
    return (nodePty as any).spawn;
  }
  if ((nodePty as any).default && typeof (nodePty as any).default.spawn === 'function') {
    return (nodePty as any).default.spawn;
  }
  throw new Error('node-pty spawn function not found');
}

export interface SSHPtyManagerEvents {
  data: (event: { sessionId: string; data: string }) => void;
  exit: (event: { sessionId: string; exitCode: number; signal?: number }) => void;
  askpass: (event: {
    sessionId: string;
    prompt: string;
    callback: (pin: string) => void;
  }) => void;
}

class InternalSSHPtySession implements SSHPtySession {
  public sessionId: string;
  public config: SSHConnectionConfig;
  public pid: number;
  public cols: number;
  public rows: number;

  private pty: IPty;
  private askpassServer?: AskpassServer;
  private manager: SSHPtyManager;
  private dataListeners: Set<(data: string) => void> = new Set();
  private exitListeners: Set<(event: SSHPtyExitEvent) => void> = new Set();
  private disposed: boolean = false;

  constructor(params: {
    sessionId: string;
    config: SSHConnectionConfig;
    pty: IPty;
    cols: number;
    rows: number;
    manager: SSHPtyManager;
    askpassServer?: AskpassServer;
  }) {
    this.sessionId = params.sessionId;
    this.config = params.config;
    this.pty = params.pty;
    this.pid = params.pty.pid;
    this.cols = params.cols;
    this.rows = params.rows;
    this.manager = params.manager;
    this.askpassServer = params.askpassServer;

    this.pty.onData((data: string) => {
      for (const listener of this.dataListeners) {
        listener(data);
      }
      this.manager.emit('data', { sessionId: this.sessionId, data });
    });

    this.pty.onExit((event: { exitCode: number; signal?: number }) => {
      for (const listener of this.exitListeners) {
        listener(event);
      }
      this.manager.emit('exit', {
        sessionId: this.sessionId,
        exitCode: event.exitCode,
        signal: event.signal,
      });
      void this.cleanup();
    });
  }

  public write(data: string): void {
    if (!this.disposed) {
      this.pty.write(data);
    }
  }

  public resize(cols: number, rows: number): void {
    if (!this.disposed) {
      this.cols = cols;
      this.rows = rows;
      this.pty.resize(cols, rows);
    }
  }

  public kill(signal?: string): void {
    if (!this.disposed) {
      this.pty.kill(signal);
    }
  }

  public onData(listener: (data: string) => void): { dispose: () => void } {
    this.dataListeners.add(listener);
    return {
      dispose: () => {
        this.dataListeners.delete(listener);
      },
    };
  }

  public onExit(listener: (event: SSHPtyExitEvent) => void): { dispose: () => void } {
    this.exitListeners.add(listener);
    return {
      dispose: () => {
        this.exitListeners.delete(listener);
      },
    };
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    try {
      this.pty.kill();
    } catch {
      // Ignore error if process already terminated
    }
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    if (this.askpassServer) {
      try {
        await this.askpassServer.stop();
      } catch {
        // Ignore cleanup errors
      }
      this.askpassServer = undefined;
    }

    this.dataListeners.clear();
    this.exitListeners.clear();
    this.manager.removeSessionInternal(this.sessionId);
  }
}

export class SSHPtyManager extends EventEmitter {
  private sessions: Map<string, SSHPtySession> = new Map();

  /**
   * Creates and spawns an OpenSSH PTY session with the given connection configuration.
   */
  public async createSession(
    config: SSHConnectionConfig,
    options?: PtyOptions
  ): Promise<SSHPtySession> {
    const sessionId = config.id || `ssh-${crypto.randomUUID()}`;
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;
    const cwd = options?.cwd ?? (process.env.HOME || process.cwd());

    let askpassServer: AskpassServer | undefined;
    let askpassEnv: Record<string, string> = {};

    // If Smartcard PKCS#11 authentication is requested, start Askpass server
    if (config.authType === 'smartcard') {
      askpassServer = new AskpassServer({
        promptHandler: async (prompt: string) => {
          if (this.listenerCount('askpass') > 0) {
            return new Promise<string>((resolve) => {
              this.emit('askpass', {
                sessionId,
                prompt,
                callback: (pin: string) => resolve(pin),
              });
            });
          }
          return config.passphrase || config.password || '';
        },
      });

      await askpassServer.start();
      askpassEnv = askpassServer.getEnv();
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      ...askpassEnv,
      ...(options?.env || {}),
    };

    if (config.agentPath) {
      env.SSH_AUTH_SOCK = config.agentPath;
    }

    const sshArgs = SmartcardDetector.buildSSHArguments(config);
    const sshBinary = process.platform === 'win32' ? 'ssh.exe' : 'ssh';

    let ptyProcess: IPty;
    try {
      const spawn = getSpawn();
      ptyProcess = spawn(sshBinary, sshArgs, {
        cols,
        rows,
        cwd,
        env,
      });
    } catch (err) {
      if (askpassServer) {
        await askpassServer.stop();
      }
      throw err;
    }

    const session = new InternalSSHPtySession({
      sessionId,
      config,
      pty: ptyProcess,
      cols,
      rows,
      manager: this,
      askpassServer,
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Spawns a local shell PTY session (e.g. bash or powershell/cmd).
   */
  public async createShellSession(options?: PtyOptions): Promise<SSHPtySession> {
    const sessionId = `shell-${crypto.randomUUID()}`;
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;
    const cwd = options?.cwd ?? (process.env.HOME || process.cwd());

    const shellBinary =
      process.platform === 'win32'
        ? (process.env.COMSPEC || 'cmd.exe')
        : (process.env.SHELL || '/bin/bash');

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      ...(options?.env || {}),
    };

    const config: SSHConnectionConfig = {
      id: sessionId,
      name: 'Local Shell',
      host: 'localhost',
      username: process.env.USER || 'local',
      authType: 'password',
    };

    const spawn = getSpawn();
    const ptyProcess = spawn(shellBinary, [], {
      cols,
      rows,
      cwd,
      env,
    });

    const session = new InternalSSHPtySession({
      sessionId,
      config,
      pty: ptyProcess,
      cols,
      rows,
      manager: this,
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Retrieves an active session by ID.
   */
  public getSession(sessionId: string): SSHPtySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Returns all active sessions.
   */
  public getAllSessions(): SSHPtySession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Writes data to an active session.
   */
  public write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.write(data);
    }
  }

  /**
   * Resizes an active session.
   */
  public resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.resize(cols, rows);
    }
  }

  /**
   * Kills an active session.
   */
  public kill(sessionId: string, signal?: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.kill(signal);
    }
  }

  /**
   * Terminates all active sessions.
   */
  public async killAll(): Promise<void> {
    const activeSessions = Array.from(this.sessions.values());
    for (const session of activeSessions) {
      await session.dispose();
    }
    this.sessions.clear();
  }

  /**
   * Internal removal from session map.
   */
  public removeSessionInternal(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
