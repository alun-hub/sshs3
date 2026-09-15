import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export type AskpassPromptHandler = (prompt: string) => Promise<string> | string;

export interface AskpassServerOptions {
  promptHandler?: AskpassPromptHandler;
  token?: string;
}

export class AskpassServer extends EventEmitter {
  private server: net.Server | null = null;
  private port: number = 0;
  private token: string;
  private promptHandler?: AskpassPromptHandler;
  private tempDir: string | null = null;
  private scriptPath: string | null = null;
  private activeSockets: Set<net.Socket> = new Set();
  private running: boolean = false;

  constructor(options?: AskpassServerOptions) {
    super();
    this.promptHandler = options?.promptHandler;
    this.token = options?.token ?? crypto.randomBytes(16).toString('hex');
  }

  /**
   * Sets or updates the prompt callback handler.
   */
  public setPromptHandler(handler: AskpassPromptHandler): void {
    this.promptHandler = handler;
  }

  /**
   * Starts the local TCP Askpass server and creates the executable wrapper script.
   */
  public async start(): Promise<{ port: number; scriptPath: string }> {
    if (this.running && this.scriptPath) {
      return { port: this.port, scriptPath: this.scriptPath };
    }

    // 1. Start TCP Server on localhost
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      server.once('error', reject);

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
          this.server = server;
          resolve();
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });
    });

    // 2. Create temporary directory and askpass script
    this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-askpass-'));
    this.scriptPath = await this.generateAskpassScript(this.tempDir, this.port, this.token);
    this.running = true;

    return { port: this.port, scriptPath: this.scriptPath };
  }

  /**
   * Returns environment variables required for OpenSSH to invoke this Askpass server.
   */
  public getEnv(): Record<string, string> {
    if (!this.scriptPath) {
      throw new Error('AskpassServer is not started');
    }

    return {
      SSH_ASKPASS: this.scriptPath,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY || ':0',
    };
  }

  /**
   * Returns the listening TCP port.
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Returns the path to the executable askpass script.
   */
  public getScriptPath(): string {
    if (!this.scriptPath) {
      throw new Error('AskpassServer is not started');
    }
    return this.scriptPath;
  }

  /**
   * Returns whether the server is currently running.
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Stops the server, terminates open sockets, and removes temporary script files.
   */
  public async stop(): Promise<void> {
    this.running = false;

    // Close all open client sockets
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    // Close TCP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }

    // Clean up temporary files
    if (this.tempDir) {
      try {
        await fs.rm(this.tempDir, { recursive: true, force: true });
      } catch {
        // Ignore deletion errors on cleanup
      }
      this.tempDir = null;
      this.scriptPath = null;
    }
  }

  private handleConnection(socket: net.Socket): void {
    this.activeSockets.add(socket);

    socket.on('close', () => {
      this.activeSockets.delete(socket);
    });

    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const req = JSON.parse(line.trim());
          if (req.token !== this.token) {
            socket.write(JSON.stringify({ error: 'Unauthorized token' }) + '\n');
            socket.end();
            return;
          }

          const prompt = req.prompt || '';
          const pin = await this.resolvePin(prompt);
          socket.write(JSON.stringify({ pin }) + '\n');
        } catch (err: any) {
          socket.write(JSON.stringify({ error: err.message || 'Internal error' }) + '\n');
        } finally {
          socket.end();
        }
      }
    });
  }

  private async resolvePin(prompt: string): Promise<string> {
    if (this.promptHandler) {
      return await this.promptHandler(prompt);
    }

    if (this.listenerCount('prompt') > 0) {
      return new Promise<string>((resolve) => {
        this.emit('prompt', prompt, (response: string) => {
          resolve(response);
        });
      });
    }

    return '';
  }

  private async generateAskpassScript(dir: string, port: number, token: string): Promise<string> {
    const isWindows = process.platform === 'win32';
    const jsPath = path.join(dir, 'askpass-worker.cjs');

    const jsContent = `
const net = require('net');
const prompt = process.argv[2] || '';
const port = ${port};
const token = ${JSON.stringify(token)};

const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
  client.write(JSON.stringify({ token, prompt }) + '\\n');
});

let response = '';
client.on('data', (chunk) => {
  response += chunk.toString();
  if (response.includes('\\n')) {
    try {
      const data = JSON.parse(response.trim());
      if (data.error) {
        process.exit(1);
      }
      if (data.pin !== undefined && data.pin !== null) {
        process.stdout.write(String(data.pin));
      }
      client.end();
      process.exit(0);
    } catch {
      process.stdout.write(response.trim());
      client.end();
      process.exit(0);
    }
  }
});

client.on('error', () => {
  process.exit(1);
});
`;

    await fs.writeFile(jsPath, jsContent, 'utf-8');

    if (isWindows) {
      const batPath = path.join(dir, 'askpass.bat');
      const batContent = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${jsPath}" %*\r\n`;
      await fs.writeFile(batPath, batContent, 'utf-8');
      return batPath;
    } else {
      const shPath = path.join(dir, 'askpass.sh');
      const shContent = `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${process.execPath}" "${jsPath}" "$@"\n`;
      await fs.writeFile(shPath, shContent, { mode: 0o755 });
      await fs.chmod(shPath, 0o755);
      return shPath;
    }
  }
}
