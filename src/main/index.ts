import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IpcBridge } from './IpcBridge';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let ipcBridge: IpcBridge | null = null;

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
  ipcBridge = new IpcBridge({
    getWebContents: () => mainWindow?.webContents,
  });
  ipcBridge.register();

  createWindow();
}

app.whenReady().then(initializeApp);

app.on('before-quit', async () => {
  if (ipcBridge) {
    try {
      await ipcBridge.dispose();
    } catch {
      // Ignore disposal errors on quit
    }
    ipcBridge = null;
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
