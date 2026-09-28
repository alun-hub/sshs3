import { app, BrowserWindow, Menu, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcBridge } from './IpcBridge';
import { SystemTrustStore } from './crypto/SystemTrustStore';
import { AgentLifecycleManager } from './ssh/AgentLifecycleManager';
import { applyLoginShellEnv } from './ssh/LoginShellEnv';
import { configureRegistryDir } from './ssh/AgentRegistry';
import { isEncryptionAvailable } from './crypto/SecretFieldCrypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Some Linux GPU drivers crash Chromium's GPU process (see the "Linux GPU crash" fix). Rather than
// disabling hardware acceleration for every Linux user unconditionally — which forces all
// compositing, including CSS blur/backdrop-filter used throughout the UI, onto the CPU and makes
// the app noticeably laggy at higher resolutions — we only disable it on machines where a GPU
// crash has actually been observed, persisted via this marker file so it survives to the next
// launch (the current session has already fallen back to software rendering on its own).
const gpuCrashMarkerPath = path.join(app.getPath('userData'), '.gpu-crash-detected');

if (process.platform === 'linux' && fs.existsSync(gpuCrashMarkerPath)) {
  app.disableHardwareAcceleration();
}

app.on('child-process-gone', (_event, details) => {
  if (details.type === 'GPU') {
    console.warn(
      `[sshs3] GPU process exited (reason: ${details.reason}, exitCode: ${details.exitCode}). Continuing with software rendering.`
    );
    if (process.platform === 'linux') {
      try {
        fs.writeFileSync(gpuCrashMarkerPath, '');
      } catch {
        // Best-effort; worst case the crash simply recurs and we try again next time.
      }
    }
  }
});

// A desktop GUI app doesn't normally receive SIGINT/SIGTERM in everyday use, but it does when
// killed from the command line (`kill`/`pkill`), by a process manager, or during a session/system
// shutdown script. Without an explicit handler here, Node's default disposition for an unhandled
// SIGINT/SIGTERM is immediate termination — bypassing Electron's entire app-quit lifecycle, so
// `before-quit`/`will-quit` never fire and nothing gets a chance to clean up: standalone SSH
// tunnels, private ssh-agents, Kubernetes port-forwards, and any other spawned child process are
// all left running as orphans. Routing the signal through `app.quit()` instead reuses the exact
// same graceful shutdown path (including the `before-quit` handler's `ipcBridge.dispose()`) a
// normal window-close or Cmd+Q already goes through.
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  const handleTerminationSignal = (): void => {
    app.quit();
  };
  process.once('SIGINT', handleTerminationSignal);
  process.once('SIGTERM', handleTerminationSignal);
}

process.on('uncaughtException', (err) => {
  // Gracefully log undici/HTTP2 stream termination and transient socket aborts
  // instead of crashing Electron with an unexpected error dialog.
  if (err instanceof TypeError && err.message === 'terminated') {
    console.warn('[sshs3] Ignored stream termination error:', err);
    return;
  }
  if (err && typeof err === 'object' && 'code' in err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) {
    console.warn('[sshs3] Ignored transient socket error:', err);
    return;
  }
  console.error('[sshs3] Uncaught exception in main process:', err);
});

let mainWindow: BrowserWindow | null = null;
let ipcBridge: IpcBridge | null = null;
let isQuitting = false;
// Set once the user has cleared any quit confirmation, so a quit that was
// confirmed via the window's 'close' handler doesn't get asked about again
// when the resulting app.quit() call reaches 'before-quit' below.
let quitConfirmed = false;

function confirmQuitIfActiveTransfers(parentWindow?: BrowserWindow | null): boolean {
  const activeCount = ipcBridge?.transferQueue.getActiveTransferCount() ?? 0;
  if (activeCount > 0) {
    const options: Electron.MessageBoxSyncOptions = {
      type: 'warning',
      buttons: ['Cancel', 'Quit Anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Transfers in progress',
      message: `There ${activeCount === 1 ? 'is' : 'are'} ${activeCount} file transfer(s) in progress.`,
      detail: 'If you quit now, the transfers will be cancelled and files may be left incomplete.',
    };
    const choice = parentWindow
      ? dialog.showMessageBoxSync(parentWindow, options)
      : dialog.showMessageBoxSync(options);
    if (choice === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Resolves whether it's OK to proceed with quitting: always confirms if
 * transfers are active, and additionally asks a plain "are you sure?"
 * question when the user has opted into `confirmBeforeQuit` in settings.
 * Cached via `quitConfirmed` so the same quit attempt is never asked twice
 * across the 'close' -> app.quit() -> 'before-quit' chain below.
 */
async function confirmQuit(parentWindow?: BrowserWindow | null): Promise<boolean> {
  if (quitConfirmed) return true;

  if (!confirmQuitIfActiveTransfers(parentWindow)) {
    return false;
  }

  try {
    const settings = await ipcBridge?.settingsStore.getSettings();
    if (settings?.confirmBeforeQuit) {
      const options: Electron.MessageBoxSyncOptions = {
        type: 'question',
        buttons: ['Cancel', 'Quit'],
        defaultId: 0,
        cancelId: 0,
        title: 'Quit sshs3?',
        message: 'Are you sure you want to quit?',
        detail: 'Any open SSH sessions and tunnels will be closed.',
      };
      const choice = parentWindow
        ? dialog.showMessageBoxSync(parentWindow, options)
        : dialog.showMessageBoxSync(options);
      if (choice === 0) {
        return false;
      }
    }
  } catch {
    // If settings can't be read, don't block quitting over it.
  }

  quitConfirmed = true;
  return true;
}

function createWindow(): BrowserWindow {
  const iconPath = process.env.VITE_DEV_SERVER_URL
    ? path.join(__dirname, '../../build/icon.png')
    : path.join(__dirname, '../build/icon.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (process.env.VITE_DEV_SERVER_URL && navigationUrl.startsWith(process.env.VITE_DEV_SERVER_URL)) {
      return;
    }
    event.preventDefault();
  });

  mainWindow.webContents.on('will-redirect', (event, navigationUrl) => {
    // Same dev-server carve-out as will-navigate above (LOW finding, code
    // review) — blocking every redirect unconditionally has no effect today
    // (nothing in the app currently redirects), but would silently break a
    // future redirect-based flow (e.g. an in-window OAuth callback) even in
    // dev, where Vite's own HMR/dev-server traffic should be allowed through.
    if (process.env.VITE_DEV_SERVER_URL && navigationUrl.startsWith(process.env.VITE_DEV_SERVER_URL)) {
      return;
    }
    event.preventDefault();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    // Always defer to app.quit() (handled by 'before-quit' below) instead of
    // letting the window close on its own, so a plain window-close ("X" the
    // window) goes through the same graceful shutdown — ipcBridge.dispose(),
    // killing SSH tunnels/agents — as Cmd+Q or the app menu, rather than
    // tearing everything down hard.
    event.preventDefault();
    void (async () => {
      if (!(await confirmQuit(mainWindow))) return;
      app.quit();
    })();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return mainWindow;
}

// Initialize IPC bridge before or when app is ready
async function initializeApp(): Promise<void> {
  // Recover ssh-agent processes and askpass socket dirs left behind by a
  // previous launch that never exited gracefully (crash, SIGKILL, OOM-kill).
  // Must run before ensureAgent()/anything else spawns new ones below.
  configureRegistryDir(path.join(app.getPath('userData'), 'runtime-agents'));
  await AgentLifecycleManager.cleanupOrphanedResources();

  if (!isEncryptionAvailable()) {
    // No OS keyring backend (safeStorage) available — SecretFieldCrypto falls
    // back to storing saved SSH/S3 passwords and passphrases in plaintext on
    // disk rather than silently losing them. Surfaced to the renderer via
    // APP_GET_SECURITY_STATUS so the UI can warn the user; logged here too
    // since this is otherwise invisible.
    console.warn(
      '[sshs3] No OS keyring available (safeStorage.isEncryptionAvailable() === false): ' +
        'saved credentials will be stored in PLAINTEXT on disk instead of encrypted.'
    );
  }

  // GUI/.desktop launches bypass .bashrc/.zshrc/.profile, so shell-exported
  // trust settings (e.g. a custom CA bundle path) a terminal launch would
  // have are otherwise invisible to processes we spawn (oc, ssh, ...).
  await applyLoginShellEnv();
  void SystemTrustStore.init();
  void AgentLifecycleManager.ensureAgent();
  // The app has its own UI for every action (tabs, connections, transfers);
  // Electron's default File/Edit/View/Window/Help menu bar has no wiring to
  // any of it, so it just sits there as dead chrome. Remove it.
  Menu.setApplicationMenu(null);

  ipcBridge = new IpcBridge({
    getWebContents: () => mainWindow?.webContents,
  });
  ipcBridge.register();

  createWindow();
}

app.whenReady().then(initializeApp);

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    void (async () => {
      if (!(await confirmQuit(mainWindow))) return;
      isQuitting = true;
      if (ipcBridge) {
        try {
          await ipcBridge.dispose();
        } catch {
          // ignore
        }
        ipcBridge = null;
        AgentLifecycleManager.killAllPrivateAgents();
        app.quit();
      } else {
        AgentLifecycleManager.killAllPrivateAgents();
        app.quit();
      }
    })();
  }
});

app.on('will-quit', () => {
  AgentLifecycleManager.killAllPrivateAgents();
});

app.on('window-all-closed', () => {
  AgentLifecycleManager.killAllPrivateAgents();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

export { createWindow, ipcBridge };
