import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { app as electronApp } from 'electron';
import type { XServerStatus } from '../../shared/types/ssh';

const execFileAsync = promisify(execFile);

const ALLOWED_X_BINARIES = new Set(['vcxsrv.exe', 'xming.exe', 'xwin.exe']);

export class XServerManager {
  private static xProcess: ChildProcess | null = null;
  private static managedPid: number | null = null;

  /**
   * Discovers the VcXsrv / Xming / XWin executable on Windows.
   */
  public static async detectExecutable(customPath?: string): Promise<string | null> {
    if (process.platform !== 'win32') {
      return null;
    }

    if (customPath) {
      const normalized = customPath.replace(/\\/g, '/');
      const base = path.posix.basename(normalized).toLowerCase();
      if (ALLOWED_X_BINARIES.has(base) && fs.existsSync(customPath)) {
        return customPath;
      }
      return null;
    }

    // 1. Check bundled extraResources
    try {
      const bundledPaths = [
        path.join(process.resourcesPath || '', 'vcxsrv', 'vcxsrv.exe'),
        path.join(electronApp.getAppPath(), 'extraResources', 'vcxsrv', 'vcxsrv.exe'),
      ];
      for (const p of bundledPaths) {
        if (fs.existsSync(p)) return p;
      }
    } catch {
      // ignore
    }

    // 2. Standard Windows installation paths
    const standardPaths = [
      'C:\\Program Files\\VcXsrv\\vcxsrv.exe',
      'C:\\Program Files (x86)\\VcXsrv\\vcxsrv.exe',
      'C:\\tools\\vcxsrv\\vcxsrv.exe',
      'C:\\Program Files\\Xming\\Xming.exe',
      'C:\\Program Files (x86)\\Xming\\Xming.exe',
      'C:\\cygwin64\\bin\\XWin.exe',
      'C:\\msys64\\usr\\bin\\XWin.exe',
    ];

    const progFiles = process.env.ProgramFiles;
    const progFilesX86 = process.env['ProgramFiles(x86)'];
    if (progFiles) {
      standardPaths.push(path.join(progFiles, 'VcXsrv', 'vcxsrv.exe'));
      standardPaths.push(path.join(progFiles, 'Xming', 'Xming.exe'));
    }
    if (progFilesX86) {
      standardPaths.push(path.join(progFilesX86, 'VcXsrv', 'vcxsrv.exe'));
      standardPaths.push(path.join(progFilesX86, 'Xming', 'Xming.exe'));
    }

    for (const p of standardPaths) {
      if (fs.existsSync(p)) return p;
    }

    // 3. Search PATH via `where`
    const binaries = ['vcxsrv.exe', 'xming.exe', 'XWin.exe'];
    for (const bin of binaries) {
      try {
        const { stdout } = await execFileAsync('where', [bin]);
        const first = stdout.split(/\r?\n/)[0]?.trim();
        if (first && fs.existsSync(first)) {
          return first;
        }
      } catch {
        // not found on PATH
      }
    }

    return null;
  }

  /**
   * Checks if an X11 server is listening on the given display (default 127.0.0.1:0.0).
   */
  public static async isListening(displayStr?: string): Promise<{ running: boolean; display: string; platform?: string }> {
    const def = process.platform === 'win32' ? '127.0.0.1:0.0' : (process.env.DISPLAY || ':0');
    const d = (displayStr && displayStr.trim()) || def;
    let host = '127.0.0.1';
    let port = 6000;
    let socketPath: string | undefined;

    if (d.startsWith(':')) {
      const m = d.match(/^:(\d+)/);
      const num = m ? parseInt(m[1], 10) : 0;
      port = 6000 + num;
      socketPath = `/tmp/.X11-unix/X${num}`;
    } else {
      const m = d.match(/^([^:]+):(\d+)/);
      if (m) {
        host = m[1] === 'localhost' ? '127.0.0.1' : m[1];
        port = 6000 + parseInt(m[2], 10);
      }
    }

    if (process.platform !== 'win32' && socketPath) {
      try {
        if (fs.existsSync(socketPath)) {
          return { running: true, display: d, platform: process.platform };
        }
      } catch {
        // ignore
      }
    }

    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout: 500 });
      socket.once('connect', () => {
        socket.destroy();
        resolve({ running: true, display: d, platform: process.platform });
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve({ running: false, display: d, platform: process.platform });
      });
      socket.once('error', () => {
        socket.destroy();
        resolve({ running: false, display: d, platform: process.platform });
      });
    });
  }

  /**
   * Retrieves overall X server status.
   */
  public static async getStatus(customPath?: string, display?: string): Promise<XServerStatus> {
    const exe = await this.detectExecutable(customPath);
    const { running, display: targetDisplay } = await this.isListening(display);

    if (this.xProcess && this.managedPid) {
      try {
        process.kill(this.managedPid, 0);
      } catch {
        this.xProcess = null;
        this.managedPid = null;
      }
    }

    return {
      available: Boolean(exe),
      executablePath: exe || undefined,
      running,
      managedByApp: Boolean(this.xProcess && this.managedPid),
      pid: this.managedPid || undefined,
      display: targetDisplay,
      platform: process.platform,
    };
  }

  /**
   * Starts the managed X server process (typically VcXsrv with multiwindow).
   */
  public static async startServer(options?: {
    customPath?: string;
    customArgs?: string;
    display?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const check = await this.isListening(options?.display);
    if (check.running) {
      return { success: true };
    }

    const exe = await this.detectExecutable(options?.customPath);
    if (!exe) {
      return {
        success: false,
        error: 'No X server executable found on system. Install VcXsrv or specify path in Settings.',
      };
    }

    // SECURITY: deliberately no `-ac` here. That flag disables VcXsrv's X11
    // access control entirely, so *any* host that can reach this TCP port —
    // including, via the installer's firewall rule, other devices on the
    // same network — could connect with no authentication at all: keylog
    // every forwarded window, screenshot them, or inject synthetic input.
    // SSH X11 forwarding doesn't need that: it relies on the normal
    // MIT-MAGIC-COOKIE xauth exchange ssh already performs for -X/-Y, which
    // this server enforces as long as `-ac` is absent. Do not reintroduce it.
    const defaultArgs = [':0', '-multiwindow', '-clipboard', '-wgl'];
    const rawArgs = options?.customArgs?.trim()
      ? options.customArgs.trim().split(/\s+/)
      : defaultArgs;
    const args = rawArgs.filter((arg) => arg.toLowerCase() !== '-ac');

    try {
      const proc = spawn(exe, args, {
        detached: true,
        stdio: 'ignore',
      });

      proc.unref();

      this.xProcess = proc;
      this.managedPid = proc.pid ?? null;

      proc.on('exit', () => {
        if (this.xProcess === proc) {
          this.xProcess = null;
          this.managedPid = null;
        }
      });

      // Poll up to 3000ms for server to start listening
      const startTime = Date.now();
      while (Date.now() - startTime < 3000) {
        await new Promise((r) => setTimeout(r, 200));
        const status = await this.isListening(options?.display);
        if (status.running) {
          return { success: true };
        }
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to spawn X server' };
    }
  }

  /**
   * Stops the managed X server if started by sshs3.
   */
  public static async stopServer(): Promise<{ success: boolean }> {
    if (this.managedPid) {
      try {
        process.kill(this.managedPid, 'SIGTERM');
      } catch {
        // ignore
      }
      this.managedPid = null;
      this.xProcess = null;
    }
    return { success: true };
  }

  /**
   * Ensures an X server is running if needed.
   */
  public static async ensureRunning(options?: {
    customPath?: string;
    customArgs?: string;
    display?: string;
  }): Promise<boolean> {
    const check = await this.isListening(options?.display);
    if (check.running) return true;
    const res = await this.startServer(options);
    return res.success;
  }
}
