import { app, BrowserWindow, Menu, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcBridge } from './IpcBridge';
import { SystemTrustStore } from './crypto/SystemTrustStore';
import { AgentLifecycleManager } from './ssh/AgentLifecycleManager';
import { isEncryptionAvailable } from './crypto/SecretFieldCrypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.platform === 'linux') {
  app.disableHardwareAcceleration();
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

  mainWindow.webContents.on('will-redirect', (event) => {
    event.preventDefault();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (!confirmQuitIfActiveTransfers(mainWindow)) {
      event.preventDefault();
      return;
    }
    isQuitting = true;
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
function initializeApp(): void {
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

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    if (!confirmQuitIfActiveTransfers(mainWindow)) {
      event.preventDefault();
      return;
    }
    isQuitting = true;
    if (ipcBridge) {
      event.preventDefault();
      try {
        await ipcBridge.dispose();
      } catch {
        // ignore
      }
      ipcBridge = null;
      app.quit();
    }
  }
});

app.on('window-all-closed', () => {
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
