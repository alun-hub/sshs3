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
  LocalShellType,
} from '../../shared/types/ssh';

/**
 * Resolves the local shell binary to spawn for `createShellSession`.
 * On Windows this honors the user's `shellType` choice (cmd/powershell/pwsh);
 * on macOS/Linux we always launch the user's own login shell ($SHELL), since
 * that's the one place there's no equivalent "which shell" choice to make.
 */
function resolveLocalShellBinary(shellType?: LocalShellType): string {
  if (process.platform !== 'win32') {
    return process.env.SHELL || '/bin/bash';
  }
  switch (shellType) {
    case 'powershell':
      return 'powershell.exe';
    case 'pwsh':
      return 'pwsh.exe';
    case 'wsl':
      return 'wsl.exe';
    case 'cmd':
      return 'cmd.exe';
    default:
      return process.env.COMSPEC || 'cmd.exe';
  }
}

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
  reconnecting: (event: { sessionId: string; attempt: number; maxAttempts: number }) => void;
  reconnected: (event: { sessionId: string }) => void;
  askpass: (event: {
    sessionId: string;
    prompt: string;
    callback: (pin: string) => void;
  }) => void;
}

export class InternalSSHPtySession implements SSHPtySession {
  public sessionId: string;
  public config: SSHConnectionConfig;
  public pid: number;
  public cols: number;
  public rows: number;

  private pty: IPty;
  public askpassServer?: AskpassServer;
  private manager: SSHPtyManager;
  private dataListeners: Set<(data: string) => void> = new Set();
  private exitListeners: Set<(event: SSHPtyExitEvent) => void> = new Set();
  private disposed: boolean = false;
  private reconnecting: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer?: NodeJS.Timeout;

  private scrollbackChunks: string[] = [];
  private scrollbackLength: number = 0;
  private static readonly MAX_SCROLLBACK_BYTES = 128 * 1024; // 128 KB

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

    this.bindPty(params.pty);
  }

  private appendScrollback(data: string): void {
    this.scrollbackChunks.push(data);
    this.scrollbackLength += data.length;
    while (this.scrollbackLength > InternalSSHPtySession.MAX_SCROLLBACK_BYTES && this.scrollbackChunks.length > 1) {
      const removed = this.scrollbackChunks.shift();
      if (removed) this.scrollbackLength -= removed.length;
    }
  }

  public getScrollbackBuffer(): string {
    return this.scrollbackChunks.join('');
  }

  public isReconnecting(): boolean {
    return this.reconnecting;
  }

  public bindPty(newPty: IPty): void {
    this.pty = newPty;
    this.pid = newPty.pid;

    newPty.onData((data: string) => {
      this.appendScrollback(data);
      for (const listener of this.dataListeners) {
        listener(data);
      }
      this.manager.emit('data', { sessionId: this.sessionId, data });
    });

    newPty.onExit((event: { exitCode: number; signal?: number }) => {
      this.handlePtyExit(event);
    });
  }

  private handlePtyExit(event: { exitCode: number; signal?: number }): void {
    const shouldReconnect =
      !this.disposed &&
      Boolean(this.config.autoReconnect) &&
      (event.exitCode !== 0 || event.signal !== undefined) &&
      this.reconnectAttempts < (this.config.maxReconnectAttempts ?? 3);

    if (shouldReconnect) {
      this.reconnecting = true;
      this.reconnectAttempts++;
      const attempt = this.reconnectAttempts;
      const maxAttempts = this.config.maxReconnectAttempts ?? 3;
      const delay = this.config.reconnectDelayMs ?? 1000;

      this.manager.emit('reconnecting', { sessionId: this.sessionId, attempt, maxAttempts });
      const msg = `\r\n\x1b[33m[sshs3: connection dropped, reconnecting (${attempt}/${maxAttempts})...]\x1b[0m\r\n`;
      this.appendScrollback(msg);
      for (const listener of this.dataListeners) listener(msg);
      this.manager.emit('data', { sessionId: this.sessionId, data: msg });

      this.reconnectTimer = setTimeout(async () => {
        if (this.disposed) return;
        try {
          const success = await this.manager.reconnectSession(this);
          if (success) {
            this.reconnecting = false;
            this.reconnectAttempts = 0;
            const okMsg = `\r\n\x1b[32m[sshs3: reconnected successfully]\x1b[0m\r\n`;
            this.appendScrollback(okMsg);
            for (const listener of this.dataListeners) listener(okMsg);
            this.manager.emit('data', { sessionId: this.sessionId, data: okMsg });
            this.manager.emit('reconnected', { sessionId: this.sessionId });
            return;
          }
        } catch {
          // Fall through to retry or exit
        }

        if (this.reconnectAttempts >= maxAttempts) {
          this.reconnecting = false;
          for (const listener of this.exitListeners) {
            listener(event);
          }
          this.manager.emit('exit', {
            sessionId: this.sessionId,
            exitCode: event.exitCode,
            signal: event.signal,
          });
          void this.cleanup();
        }
      }, delay);
      return;
    }

    for (const listener of this.exitListeners) {
      listener(event);
    }
    this.manager.emit('exit', {
      sessionId: this.sessionId,
      exitCode: event.exitCode,
      signal: event.signal,
    });
    void this.cleanup();
  }

  public async reconnect(): Promise<boolean> {
    return this.manager.reconnectSession(this);
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnecting = false;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnecting = false;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

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
  private sessionOptions: Map<string, PtyOptions | undefined> = new Map();

  /**
   * Asks the UI (via the same 'askpass' channel used for in-session smartcard
   * prompts) for a PIN/passphrase, e.g. to load a smartcard into a private
   * ssh-agent ahead of or independently of a PTY login. Resolves to '' if
   * nothing is listening.
   */
  public async promptForPin(sessionId: string, prompt: string): Promise<string> {
    if (this.listenerCount('askpass') === 0) {
      return '';
    }
    return new Promise<string>((resolve) => {
      this.emit('askpass', { sessionId, prompt, callback: (pin: string) => resolve(pin) });
    });
  }

  /**
   * Reconnects an existing session by spawning a new underlying SSH process.
   */
  public async reconnectSession(session: InternalSSHPtySession): Promise<boolean> {
    const config = session.config;
    const options = this.sessionOptions.get(session.sessionId);
    const cols = session.cols;
    const rows = session.rows;
    const cwd = options?.cwd ?? (process.env.HOME || process.cwd());

    const askpassEnv = session.askpassServer ? session.askpassServer.getEnv() : {};
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      ...askpassEnv,
      ...SmartcardDetector.buildProxyEnv(config),
      ...(options?.env || {}),
    };

    if (config.agentPath) {
      env.SSH_AUTH_SOCK = config.agentPath;
    } else if (config.authType === 'smartcard') {
      delete env.SSH_AUTH_SOCK;
    }

    if (config.x11Forwarding) {
      env.DISPLAY =
        config.x11Display ||
        process.env.DISPLAY ||
        (process.platform === 'win32' ? '127.0.0.1:0.0' : ':0');
    }

    const sshArgs = SmartcardDetector.buildSSHArguments(config);
    const sshBinary = process.platform === 'win32' ? 'ssh.exe' : 'ssh';

    try {
      const spawn = getSpawn();
      const ptyProcess = spawn(sshBinary, sshArgs, {
        cols,
        rows,
        cwd,
        env,
      });

      session.bindPty(ptyProcess);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates and spawns an OpenSSH PTY session with the given connection configuration.
   */
  public async createSession(
    config: SSHConnectionConfig,
    options?: PtyOptions
  ): Promise<SSHPtySession> {
    const sessionId = config.id || `ssh-${crypto.randomUUID()}`;
    this.sessionOptions.set(sessionId, options);
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;
    const cwd = options?.cwd ?? (process.env.HOME || process.cwd());

    let askpassServer: AskpassServer | undefined;
    let askpassEnv: Record<string, string> = {};

    // Start Askpass server if Smartcard is used, or if a saved password or private-key passphrase is provided
    const needsAskpass =
      config.authType === 'smartcard' ||
      (config.authType === 'password' && Boolean(config.password)) ||
      Boolean(config.passphrase);

    if (needsAskpass) {
      askpassServer = new AskpassServer({
        promptHandler: async () => {
          if (config.authType === 'password' && config.password) {
            return config.password;
          }
          if (config.passphrase) {
            return config.passphrase;
          }
          // The two branches above cover 'password'/passphrase — by elimination
          // this is always the smartcard PIN prompt (see needsAskpass above).
          if (this.listenerCount('askpass') > 0) {
            return new Promise<string>((resolve) => {
              this.emit('askpass', {
                sessionId,
                prompt: `Enter your smartcard PIN to connect via SSH to ${config.name || config.host}:`,
                callback: (resolvedPin: string) => resolve(resolvedPin),
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
      ...SmartcardDetector.buildProxyEnv(config),
      ...(options?.env || {}),
    };

    if (config.agentPath) {
      env.SSH_AUTH_SOCK = config.agentPath;
    } else if (config.authType === 'smartcard') {
      delete env.SSH_AUTH_SOCK;
    }

    if (config.x11Forwarding) {
      env.DISPLAY =
        config.x11Display ||
        process.env.DISPLAY ||
        (process.platform === 'win32' ? '127.0.0.1:0.0' : ':0');
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
    const cwd = options?.cwd ?? (process.env.HOME || process.env.USERPROFILE || process.cwd());

    const shellBinary = resolveLocalShellBinary(options?.shellType);
    const args: string[] = [];
    if (process.platform === 'win32' && options?.shellType === 'wsl' && options?.wslDistro) {
      args.push('-d', options.wslDistro);
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      ...(options?.env || {}),
    };

    const sessionName =
      options?.shellType === 'wsl'
        ? options?.wslDistro
          ? `WSL: ${options.wslDistro}`
          : 'WSL'
        : 'Local Shell';

    const config: SSHConnectionConfig = {
      id: sessionId,
      name: sessionName,
      host: 'localhost',
      username: process.env.USER || process.env.USERNAME || 'local',
      authType: 'password',
    };

    const spawn = getSpawn();
    const ptyProcess = spawn(shellBinary, args, {
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
    this.sessionOptions.delete(sessionId);
  }
}
