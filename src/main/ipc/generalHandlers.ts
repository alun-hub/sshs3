import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app as electronApp, dialog as electronDialog, shell as electronShell } from 'electron';
import { AgentLifecycleManager } from '../ssh/AgentLifecycleManager';
import { isEncryptionAvailable } from '../crypto/SecretFieldCrypto';
import { XServerManager } from '../x11/XServerManager';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import type { IpcBridge } from '../IpcBridge';

/** The part of IpcBridge this handler group may use. */
export type GeneralHost = Pick<IpcBridge, 'getUpdateService' | 'registerHandler'>;

const execFileAsync = promisify(execFile);

/** Shells that may be started elevated (WSL is left out: Windows admin does not mean root in a distro). */
const ELEVATED_SHELLS: Record<string, string> = {
  cmd: 'cmd.exe',
  powershell: 'powershell.exe',
  pwsh: 'pwsh.exe',
};

export function registerGeneralHandlers(bridge: GeneralHost): void {
  bridge.registerHandler(IPC_CHANNELS.APP_GET_VERSION, async () => {
    try {
      return electronApp.getVersion();
    } catch {
      return '0.1.0';
    }
  });

  bridge.registerHandler(IPC_CHANNELS.UPDATE_GET_STATE, async () => bridge.getUpdateService().getState());
  bridge.registerHandler(IPC_CHANNELS.UPDATE_CHECK, async () => bridge.getUpdateService().check());
  bridge.registerHandler(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => bridge.getUpdateService().download());
  bridge.registerHandler(IPC_CHANNELS.UPDATE_INSTALL, async () => {
    await bridge.getUpdateService().install();
  });

  bridge.registerHandler(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://')) && electronShell?.openExternal) {
      await electronShell.openExternal(url);
    }
  });

  bridge.registerHandler(IPC_CHANNELS.APP_GET_HOMEDIR, async () => {
    return os.homedir();
  });

  bridge.registerHandler(IPC_CHANNELS.APP_GET_PLATFORM, async () => {
    return process.platform;
  });

  bridge.registerHandler(IPC_CHANNELS.APP_GET_HOSTNAME, async () => {
    return os.hostname();
  });

  bridge.registerHandler(IPC_CHANNELS.APP_GET_SECURITY_STATUS, async () => {
    return { credentialEncryptionAvailable: isEncryptionAvailable() };
  });

  bridge.registerHandler(IPC_CHANNELS.APP_DETECT_LOCAL_SHELLS, async () => {
    if (process.platform !== 'win32') {
      return { pwsh: false, wsl: false, wslDistros: [] };
    }
    let pwsh: boolean;
    let wsl: boolean;
    let wslDistros: string[];
    try {
      await execFileAsync('where', ['pwsh.exe']);
      pwsh = true;
    } catch {
      pwsh = false;
    }
    try {
      await execFileAsync('where', ['wsl.exe']);
      const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], { timeout: 2500 });
      // Strip null bytes (UTF-16LE decoding artifact in Node utf8 buffer) and BOM
      const cleaned = stdout.replace(/\0/g, '').replace(/^\uFEFF/, '');
      const distros = cleaned
        .split(/\r?\n/)
        .map((d) => d.trim())
        .filter(Boolean);
      wsl = distros.length > 0;
      wslDistros = distros;
    } catch {
      wsl = false;
      wslDistros = [];
    }
    return { pwsh, wsl, wslDistros };
  });

  // Windows: opens cmd / PowerShell in its own elevated window through the normal UAC prompt. An
  // elevated process cannot be hosted in this (non-elevated) app's terminal, so it is a separate window.
  bridge.registerHandler(
    IPC_CHANNELS.APP_OPEN_ELEVATED_SHELL,
    async (_event, shellType: string): Promise<{ started: boolean }> => {
      if (process.platform !== 'win32') {
        throw new Error('Running a shell as administrator is only available on Windows');
      }
      const exe = ELEVATED_SHELLS[shellType];
      if (!exe) {
        throw new Error(`Unsupported shell for elevation: ${String(shellType)}`);
      }
      try {
        // Fixed program and arguments only: the renderer chooses from a whitelist, never a command line.
        await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Start-Process -FilePath '${exe}' -WorkingDirectory $env:USERPROFILE -Verb RunAs`,
          ],
          { windowsHide: true }
        );
        return { started: true };
      } catch (err) {
        // Declining the UAC prompt makes Start-Process fail with "canceled by the user": not an error.
        if (/cancel/i.test(String((err as { stderr?: string }).stderr ?? err))) {
          return { started: false };
        }
        throw err;
      }
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.APP_CHECK_X11_SERVER,
    async (_event, displayStr?: string) => {
      return await XServerManager.isListening(displayStr);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.X11_GET_STATUS,
    async (_event, customPath?: string, display?: string) => {
      return await XServerManager.getStatus(customPath, display);
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.X11_START_SERVER,
    async (
      _event,
      options?: { customPath?: string; customArgs?: string; display?: string }
    ) => {
      return await XServerManager.startServer(options);
    }
  );

  bridge.registerHandler(IPC_CHANNELS.X11_STOP_SERVER, async () => {
    return await XServerManager.stopServer();
  });

  bridge.registerHandler(IPC_CHANNELS.SSH_AGENT_STATUS, async () => {
    return await AgentLifecycleManager.getStatus();
  });

  bridge.registerHandler(
    IPC_CHANNELS.DIALOG_OPEN_FILE,
    async (_event, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const result = await electronDialog.showOpenDialog({
        title: options?.title,
        filters: options?.filters,
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.DIALOG_OPEN_FOLDER,
    async (_event, options?: { title?: string }) => {
      const result = await electronDialog.showOpenDialog({
        title: options?.title,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    }
  );

  bridge.registerHandler(
    IPC_CHANNELS.DIALOG_SAVE_FILE,
    async (_event, options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const result = await electronDialog.showSaveDialog({
        title: options?.title,
        defaultPath: options?.defaultPath,
        filters: options?.filters,
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    }
  );
}
