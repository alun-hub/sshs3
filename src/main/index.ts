import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcBridge } from './IpcBridge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let ipcBridge: IpcBridge | null = null;
let isQuitting = false;

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
  if (!isQuitting && ipcBridge) {
    event.preventDefault();
    isQuitting = true;
    try {
      await ipcBridge.dispose();
    } catch {
      // ignore
    }
    ipcBridge = null;
    app.quit();
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
