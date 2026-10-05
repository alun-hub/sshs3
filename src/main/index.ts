import { app, BrowserWindow, Menu, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IpcBridge } from './IpcBridge';
import { showSplash, type SplashController } from './splash/SplashWindow';
import { SystemTrustStore } from './crypto/SystemTrustStore';
import { AgentLifecycleManager } from './ssh/AgentLifecycleManager';
import { applyLoginShellEnv } from './ssh/LoginShellEnv';
import { configureRegistryDir } from './ssh/AgentRegistry';
import { isEncryptionAvailable } from './crypto/SecretFieldCrypto';

app.setName('sshs3');
if (process.platform === 'linux') {
  app.setDesktopName('sshs3.desktop');
}

// Redirect userData to <exe-dir>/data if running as a portable executable (set by electron-builder)
// or if a local 'data' folder exists next to the executable (e.g. portable ZIP distribution).
// This ensures true portability (data travels with the exe) and avoids collision with any installed
// sshs3 instance sharing the default %APPDATA%\sshs3 directory.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data'));
} else if (process.platform === 'win32' && !process.env.VITE_DEV_SERVER_URL) {
  const localDataDir = path.join(path.dirname(process.execPath), 'data');
  if (fs.existsSync(localDataDir)) {
    app.setPath('userData', localDataDir);
  }
}

// Enforce single-instance lock: if an instance is already running with the same userData directory,
// focus the existing window and immediately terminate the new instance.
let hasSingleInstanceLock = true;
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    });
  }
}

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
// Windows-only startup progress window (null elsewhere); see ./splash/SplashWindow.
let splash: SplashController | null = null;
let ipcBridge: IpcBridge | null = null;
let isQuitting = false;
// Set once the user has cleared any quit confirmation, so a quit that was
// confirmed via the window's 'close' handler doesn't get asked about again
// when the resulting app.quit() call reaches 'before-quit' below.
let quitConfirmed = false;

// UX audit finding #2: both confirmations below used to be native
// `dialog.showMessageBoxSync` boxes — the one part of the app that didn't
// look or behave like the rest of it (no default-focused Cancel, no themed
// styling). They now go through `ipcBridge.promptQuitConfirm`, which asks
// the renderer to show the same `ConfirmDialog` used everywhere else in the
// app and awaits its result over IPC.
async function confirmQuitIfActiveTransfers(): Promise<boolean> {
  const activeCount = ipcBridge?.transferQueue.getActiveTransferCount() ?? 0;
  if (activeCount > 0 && ipcBridge) {
    const proceed = await ipcBridge.promptQuitConfirm({
      kind: 'active-transfers',
      activeTransferCount: activeCount,
    });
    if (!proceed) return false;
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
async function confirmQuit(): Promise<boolean> {
  if (quitConfirmed) return true;

  if (!(await confirmQuitIfActiveTransfers())) {
    return false;
  }

  try {
    const settings = await ipcBridge?.settingsStore.getSettings();
    if (settings?.confirmBeforeQuit && ipcBridge) {
      const proceed = await ipcBridge.promptQuitConfirm({ kind: 'confirm-before-quit' });
      if (!proceed) return false;
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
  const appIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: appIcon,
    // On Windows the splash stays up until the renderer has loaded, so the main
    // window is created hidden instead of flashing an empty frame.
    show: process.platform !== 'win32',
    webPreferences: {
      preload: path.join(__dirname, 'index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!appIcon.isEmpty()) {
    mainWindow.setIcon(appIcon);
  }

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
      if (!(await confirmQuit())) return;
      app.quit();
    })();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.platform === 'win32') {
    const window = mainWindow;
    let revealed = false;
    const reveal = (): void => {
      if (revealed) return;
      revealed = true;
      clearTimeout(fallback);
      splash?.setProgress(100, 'Ready');
      if (!window.isDestroyed()) window.show();
      splash?.close();
      splash = null;
    };
    // Never leave the user stuck on the splash if the renderer fails to load.
    const fallback = setTimeout(reveal, 30_000);
    window.webContents.on('did-start-loading', () => splash?.setProgress(70, 'Loading interface…'));
    window.webContents.on('dom-ready', () => splash?.setProgress(85, 'Starting interface…'));
    window.webContents.once('did-finish-load', reveal);
    window.webContents.once('did-fail-load', reveal);
    window.once('closed', () => {
      clearTimeout(fallback);
      splash?.close();
      splash = null;
    });
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return mainWindow;
}

// Initialize IPC bridge before or when app is ready
async function initializeApp(): Promise<void> {
  splash?.setProgress(10, 'Starting…');

  // Loaded lazily so the splash is already on screen while the (large) service
  // layer is parsed, instead of showing nothing until it is done.
  const { IpcBridge } = await import('./IpcBridge');
  splash?.setProgress(35, 'Loading services…');

  // Set registry directory for ssh-agents
  configureRegistryDir(path.join(app.getPath('userData'), 'runtime-agents'));

  // Remove default dead application menu
  Menu.setApplicationMenu(null);

  // Initialize and register IPC bridge
  ipcBridge = new IpcBridge({
    getWebContents: () => mainWindow?.webContents,
    confirmQuit,
  });
  ipcBridge.register();
  splash?.setProgress(55, 'Creating window…');
  // A previous run may have crashed before it could empty the clipboard history on exit.
  void ipcBridge.clearClipboardHistoryIfConfigured().catch(() => {});

  // Create the main window immediately so the UI starts loading without waiting for subshells
  createWindow();
  ipcBridge.startUpdateChecks();

  // Run background tasks (orphan cleanup, login shell environment, trust store, ~/.ssh/config sync)
  // in parallel with window loading so startup time is not penalized
  void Promise.all([
    AgentLifecycleManager.cleanupOrphanedResources(),
    applyLoginShellEnv().then(() => {
      void SystemTrustStore.init();
    }),
    // Sync the managed block first, then clear any agent block a crashed run left pointing at a dead socket.
    ipcBridge.profileSyncService.autoSyncLocalSshConfig().then(() => ipcBridge?.refreshAgentSshConfig()),
  ]).catch((err) => {
    console.warn('[sshs3] Background initialization error:', err);
  });

  void AgentLifecycleManager.ensureAgent();

  if (!isEncryptionAvailable()) {
    console.warn(
      '[sshs3] No OS keyring available (safeStorage.isEncryptionAvailable() === false): ' +
        'saved credentials will be stored in PLAINTEXT on disk instead of encrypted.'
    );
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  splash = showSplash();
  return initializeApp();
});

app.on('before-quit', (event) => {
  if (!hasSingleInstanceLock) return;
  if (!isQuitting) {
    event.preventDefault();
    void (async () => {
      if (!(await confirmQuit())) return;
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
  if (!hasSingleInstanceLock) return;
  AgentLifecycleManager.killAllPrivateAgents();
});

app.on('window-all-closed', () => {
  if (!hasSingleInstanceLock) return;
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
