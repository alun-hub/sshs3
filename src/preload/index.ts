import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type MultiSSHApi,
  type StorageConnectConfig,
} from '../shared/types/ipc';
import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
  DetectedSmartcardLib,
} from '../shared/types/ssh';
import type {
  FileEntry,
  TransferProgress,
  S3Config,
} from '../shared/types/storage';

export const api: MultiSSHApi = {
  // Terminal
  terminalCreate: (options: { config: SSHConnectionConfig; ptyOptions?: PtyOptions }): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CREATE, options),

  terminalWrite: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE, sessionId, data),

  terminalResize: (sessionId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESIZE, sessionId, cols, rows),

  terminalKill: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_KILL, sessionId),

  onTerminalData: (callback: (sessionId: string, data: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sessionId: string, data: string) =>
      callback(sessionId, data);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_DATA, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_DATA, listener);
    };
  },

  onTerminalExit: (callback: (sessionId: string, event: SSHPtyExitEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sessionId: string, event: SSHPtyExitEvent) =>
      callback(sessionId, event);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_EXIT, listener);
    };
  },

  // Smartcard
  smartcardDetect: (): Promise<DetectedSmartcardLib[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SMARTCARD_DETECT),

  smartcardValidate: (path: string): Promise<{ valid: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SMARTCARD_VALIDATE, path),

  onAskpassPrompt: (callback: (event: { id: string; prompt: string; sessionId?: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: { id: string; prompt: string; sessionId?: string }) =>
      callback(event);
    ipcRenderer.on(IPC_CHANNELS.ASKPASS_PROMPT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASKPASS_PROMPT, listener);
    };
  },

  submitAskpassPin: (id: string, pin: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.ASKPASS_SUBMIT_PIN, id, pin),

  // Storage
  connectStorage: (config: StorageConnectConfig): Promise<{ id: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CONNECT, config),

  disconnectStorage: (providerId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DISCONNECT, providerId),

  storageList: (providerId: string, remotePath: string): Promise<FileEntry[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_LIST, providerId, remotePath),

  storageStat: (providerId: string, remotePath: string): Promise<FileEntry> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_STAT, providerId, remotePath),

  storageCreateFolder: (providerId: string, remotePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CREATE_FOLDER, providerId, remotePath),

  storageDelete: (providerId: string, remotePath: string, isDirectory: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DELETE, providerId, remotePath, isDirectory),

  storageRename: (providerId: string, oldPath: string, newPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_RENAME, providerId, oldPath, newPath),

  // Transfer
  transferAdd: (options: {
    sourceProviderId: string;
    sourcePath: string;
    targetProviderId: string;
    targetPath: string;
  }): Promise<{ jobId: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_ADD, options),

  transferPause: (jobId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_PAUSE, jobId),

  transferResume: (jobId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_RESUME, jobId),

  transferCancel: (jobId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_CANCEL, jobId),

  transferGetJobs: (): Promise<TransferProgress[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_GET_JOBS),

  transferClearCompleted: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_CLEAR_COMPLETED),

  onTransferProgress: (callback: (progress: TransferProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TransferProgress) =>
      callback(progress);
    ipcRenderer.on(IPC_CHANNELS.TRANSFER_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TRANSFER_PROGRESS, listener);
    };
  },

  // Profiles
  profilesGet: (): Promise<{ ssh: SSHConnectionConfig[]; s3: S3Config[] }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILES_GET),

  profilesSaveSSH: (config: SSHConnectionConfig): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SAVE_SSH, config),

  profilesDeleteSSH: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILES_DELETE_SSH, id),

  profilesSaveS3: (config: S3Config): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILES_SAVE_S3, config),

  profilesDeleteS3: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILES_DELETE_S3, id),

  // Window / General
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  dialogOpenFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, options),
};

export function exposePreloadApi(): void {
  try {
    contextBridge.exposeInMainWorld('multissh', api);
  } catch {
    // Safely ignore when run outside electron preload environment
  }
}

exposePreloadApi();
