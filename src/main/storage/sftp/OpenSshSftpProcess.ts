import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { SmartcardDetector } from '../../smartcard/SmartcardDetector';
import { AskpassServer } from '../../smartcard/AskpassServer';
import { SftpPacketProtocol } from './SftpPacketProtocol';
import type { HostKeyPromptInfo } from '../../ssh/HostKeyVerifier';
import type { SFTPConfig } from '../../../shared/types/storage';
import type { SSHConnectionConfig } from '../../../shared/types/ssh';

export interface OpenSshProcessOptions {
  config: SFTPConfig;
  controlPath?: string;
  onPresence?: (prompt: string) => void;
  onPresenceCleared?: () => void;
  pinPromptHandler?: (prompt: string) => Promise<string> | string;
  /** Asked when OpenSSH wants to trust an unknown host key. Absent => rejected (fail closed). */
  hostKeyPromptHandler?: (info: HostKeyPromptInfo) => Promise<boolean>;
}

/** SFTPConfig är en delmängd av SSHConnectionConfig; OpenSSH-argumentbyggaren kräver id/name. */
function toSshConfig(config: SFTPConfig): SSHConnectionConfig {
  return { ...config, id: config.id ?? '', name: config.name ?? config.host } as unknown as SSHConnectionConfig;
}

const HOST_KEY_CONFIRM_RE = /are you sure you want to continue connecting/i;

export function parseHostKeyPrompt(prompt: string, config: SFTPConfig): HostKeyPromptInfo {
  const m = /(\S+) key fingerprint is (\S+?)\.?(?:\s|$)/i.exec(prompt);
  return {
    host: config.host,
    port: config.port ?? 22,
    keyType: m?.[1] ?? 'unknown',
    fingerprint: m?.[2] ?? 'unknown',
    status: 'unknown',
  };
}

export function resolveSshBinary(): string {
  if (process.platform === 'win32') {
    const winDefault = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
    if (fs.existsSync(winDefault)) {
      return winDefault;
    }
    return 'ssh.exe';
  }
  return 'ssh';
}

export class OpenSshSftpProcess {
  private child?: ChildProcess;
  private askpassServer?: AskpassServer;
  private protocol?: SftpPacketProtocol;
  private isClosed = false;
  private stderrBuffer = '';
  private controlPath?: string;
  private controlDir?: string;
  private host: string = '';
  private config?: SFTPConfig;

  public async start(options: OpenSshProcessOptions): Promise<SftpPacketProtocol> {
    const { config, pinPromptHandler, onPresence, onPresenceCleared, hostKeyPromptHandler } = options;
    this.config = config;
    this.host = config.host;

    // Use or generate controlPath on POSIX
    if (process.platform !== 'win32') {
      if (options.controlPath) {
        this.controlPath = options.controlPath;
      } else {
        // Private 0700 directory + unguessable name, so other local users can't pre-create
        // or reach the multiplexing socket.
        this.controlDir = fs.mkdtempSync(path.join(os.tmpdir(), 's3m-sftp-'));
        fs.chmodSync(this.controlDir, 0o700);
        this.controlPath = path.join(this.controlDir, `${crypto.randomBytes(8).toString('hex')}.sock`);
      }
    }

    // Determine if AskpassServer is needed
    const needsAskpass =
      config.authType === 'smartcard' ||
      config.authType === 'fido2' ||
      config.authType === 'password' ||
      Boolean(config.password) ||
      Boolean(config.passphrase);

    let askpassEnv: Record<string, string> = {};

    if (needsAskpass) {
      this.askpassServer = new AskpassServer({
        onPresence: (prompt: string) => {
          if (onPresence) onPresence(prompt);
        },
        promptHandler: async (rawPrompt: string) => {
          if (HOST_KEY_CONFIRM_RE.test(rawPrompt)) {
            // Never answer a trust question with a password; ask the user, fail closed otherwise.
            if (!hostKeyPromptHandler) return 'no';
            const info = parseHostKeyPrompt(rawPrompt, config);
            return (await hostKeyPromptHandler(info)) ? 'yes' : 'no';
          }
          if (config.authType === 'password' && config.password) {
            return config.password;
          }
          if (config.passphrase) {
            return config.passphrase;
          }
          if (pinPromptHandler) {
            return await pinPromptHandler(rawPrompt);
          }
          return config.passphrase || config.password || '';
        },
      });

      await this.askpassServer.start();
      askpassEnv = this.askpassServer.getEnv();
    }

    // Build SSH arguments
    const sshArgs = SmartcardDetector.buildSSHArguments(toSshConfig(config), this.controlPath);
    // buildSSHArguments ends with `-- [user@]host`; options must go before that pair,
    // and `-s` makes the trailing word a subsystem name: `ssh ... -s -- user@host sftp`.
    const destination = sshArgs.splice(-2);
    sshArgs.push('-o', 'BatchMode=no', '-s', ...destination, 'sftp');

    const sshBinary = resolveSshBinary();

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...askpassEnv,
      ...SmartcardDetector.buildProxyEnv(toSshConfig(config)),
    };

    if (config.agentPath) {
      env.SSH_AUTH_SOCK = config.agentPath;
    }

    console.log(`[sftp] spawning ${sshBinary} ${sshArgs.join(' ')}`);
    const child = spawn(sshBinary, sshArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    this.child = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      this.stderrBuffer = (this.stderrBuffer + text).slice(-4096);
      console.log(`[sftp] ssh stderr: ${JSON.stringify(text.slice(0, 500))}`);

      if (/confirm user presence|touch (your )?security key/i.test(text)) {
        if (onPresence) onPresence(text.trim());
      }
    });

    const exitPromise = new Promise<never>((_, reject) => {
      child.once('error', (err) => {
        console.log(`[sftp] ssh spawn error: ${err.message}`);
        reject(err);
      });
      child.once('exit', (code, signal) => {
        console.log(`[sftp] ssh exited code=${code} signal=${signal}`);
        const detail = this.stderrBuffer.trim() || `exit code ${code}${signal ? `, signal ${signal}` : ''}`;
        reject(new Error(`OpenSSH process terminated: ${detail}`));
      });
    });

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to spawn OpenSSH process with stdio pipes');
    }

    const protocol = new SftpPacketProtocol(child.stdout, child.stdin);
    this.protocol = protocol;

    // Race between protocol handshake and early process death
    try {
      await Promise.race([protocol.init(), exitPromise]);
      console.log('[sftp] SFTP subsystem ready (protocol version negotiated)');
      onPresenceCleared?.();
    } catch (err: any) {
      // If ssh died first, the protocol only sees a closed pipe; surface ssh's own stderr instead.
      const stderrText = this.stderrBuffer.trim();
      onPresenceCleared?.();
      await this.close();
      if (stderrText && /SFTP stream closed/.test(String(err?.message))) {
        throw new Error(`OpenSSH process terminated: ${stderrText}`, { cause: err });
      }
      throw err;
    }

    return protocol;
  }

  public getProtocol(): SftpPacketProtocol {
    if (!this.protocol) {
      throw new Error('OpenSshSftpProcess is not started');
    }
    return this.protocol;
  }

  public getControlPath(): string | undefined {
    return this.controlPath;
  }

  public async exec(cmd: string): Promise<{ stdout: Buffer; stderr: string }> {
    const sshBinary = resolveSshBinary();

    // If ControlPath is available, use multiplexed master (fastest)
    if (this.controlPath && fs.existsSync(this.controlPath)) {
      return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
        execFile(
          sshBinary,
          ['-S', this.controlPath!, '-o', 'BatchMode=yes', '--', this.host, cmd],
          { maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err) return reject(err);
            resolve({ stdout: Buffer.from(stdout), stderr: stderr.toString() });
          }
        );
      });
    }

    // Fallback: spawn independent command
    if (!this.config) {
      throw new Error('Cannot run exec: process configuration not available');
    }
    const args = SmartcardDetector.buildSSHArguments(toSshConfig(this.config));
    args.push(cmd); // builder already ended with `-- [user@]host`

    return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
      execFile(
        sshBinary,
        args,
        { maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve({ stdout: Buffer.from(stdout), stderr: stderr.toString() });
        }
      );
    });
  }

  public createExecStream(cmd: string): NodeJS.ReadableStream {
    const sshBinary = resolveSshBinary();
    let childProc: ChildProcess;

    if (this.controlPath && fs.existsSync(this.controlPath)) {
      childProc = spawn(sshBinary, ['-S', this.controlPath, '-o', 'BatchMode=yes', '--', this.host, cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else if (this.config) {
      const args = SmartcardDetector.buildSSHArguments(toSshConfig(this.config));
      args.push(cmd);
      childProc = spawn(sshBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      const errStream = new Readable({ read() {} });
      errStream.destroy(new Error('Process not initialized'));
      return errStream;
    }

    return childProc.stdout!;
  }

  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.child) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // Ignore
      }
      this.child = undefined;
    }

    if (this.askpassServer) {
      try {
        await this.askpassServer.stop();
      } catch {
        // Ignore
      }
      this.askpassServer = undefined;
    }

    if (this.controlPath && fs.existsSync(this.controlPath)) {
      try {
        fs.unlinkSync(this.controlPath);
      } catch {
        // Ignore
      }
    }

    if (this.controlDir) {
      try {
        fs.rmSync(this.controlDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
      this.controlDir = undefined;
    }
  }
}
