import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type MultiSSHApi,
  type StorageConnectConfig,
  type HostKeyPromptEvent,
  type TransferConflictPromptEvent,
  type TransferConflictResolution,
} from '../shared/types/ipc';
import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
  DetectedSmartcardLib,
} from '../shared/types/ssh';
import type {
  FileEntry,
  ObjectMetadata,
  TransferProgress,
  S3Config,
  S3Tag,
  BucketVersioningInfo,
  ObjectVersionEntry,
} from '../shared/types/storage';
import type { SessionData } from '../shared/types/session';
import type { AppSettings } from '../shared/types/settings';

export const api: MultiSSHApi = {
  // Terminal
  terminalCreate: (options: {
    config?: SSHConnectionConfig;
    local?: boolean;
    ptyOptions?: PtyOptions;
  }): Promise<{ sessionId: string }> => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CREATE, options),

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

  onHostKeyPrompt: (callback: (event: HostKeyPromptEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: HostKeyPromptEvent) => callback(event);
    ipcRenderer.on(IPC_CHANNELS.HOSTKEY_PROMPT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.HOSTKEY_PROMPT, listener);
    };
  },

  respondHostKeyPrompt: (id: string, trust: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.HOSTKEY_RESPOND, id, trust),

  onTransferConflictPrompt: (callback: (event: TransferConflictPromptEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: TransferConflictPromptEvent) => callback(event);
    ipcRenderer.on(IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT, listener);
    };
  },

  respondTransferConflict: (id: string, resolution: TransferConflictResolution, applyToAll: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.TRANSFER_CONFLICT_RESPOND, id, resolution, applyToAll),

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

  storageChmod: (providerId: string, remotePath: string, mode: number | string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_CHMOD, providerId, remotePath, mode),

  storageSetMetadata: (providerId: string, remotePath: string, metadata: ObjectMetadata): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET_METADATA, providerId, remotePath, metadata),

  storageGetTags: (providerId: string, remotePath: string): Promise<S3Tag[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_TAGS, providerId, remotePath),

  storageSetTags: (providerId: string, remotePath: string, tags: S3Tag[]): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET_TAGS, providerId, remotePath, tags),

  storageGetBucketPolicy: (providerId: string, bucketPath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_BUCKET_POLICY, providerId, bucketPath),

  storageSetBucketPolicy: (providerId: string, bucketPath: string, policy: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET_BUCKET_POLICY, providerId, bucketPath, policy),

  storageGetBucketCors: (providerId: string, bucketPath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_BUCKET_CORS, providerId, bucketPath),

  storageSetBucketCors: (providerId: string, bucketPath: string, corsJson: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET_BUCKET_CORS, providerId, bucketPath, corsJson),

  storageGetBucketVersioning: (providerId: string, bucketPath: string): Promise<BucketVersioningInfo> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_BUCKET_VERSIONING, providerId, bucketPath),

  storageSetBucketVersioning: (providerId: string, bucketPath: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_SET_BUCKET_VERSIONING, providerId, bucketPath, enabled),

  storageListObjectVersions: (providerId: string, remotePath: string): Promise<ObjectVersionEntry[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_LIST_OBJECT_VERSIONS, providerId, remotePath),

  storageDeleteObjectVersion: (providerId: string, remotePath: string, versionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_DELETE_OBJECT_VERSION, providerId, remotePath, versionId),

  storageRestoreObjectVersion: (providerId: string, remotePath: string, versionId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_RESTORE_OBJECT_VERSION, providerId, remotePath, versionId),

  // Transfer
  transferAdd: (options: {
    sourceProviderId: string;
    sourcePath: string;
    targetProviderId: string;
    targetPath: string;
    conflictPolicy?: TransferConflictResolution;
  }): Promise<{ jobId: string | null; skipped?: boolean; resolvedPolicy?: TransferConflictResolution; appliedToAll?: boolean }> =>
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

  // Session
  sessionGet: (): Promise<SessionData | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_GET),

  sessionSave: (data: SessionData): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SESSION_SAVE, data),

  // Settings
  settingsGet: (): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),

  settingsSave: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SAVE, settings),

  // Connection Testing
  testSSHConnection: (config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_TEST_SSH, config),

  testS3Connection: (config: S3Config): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_TEST_S3, config),

  // Window / General
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),

  dialogOpenFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, options),
};

export function exposePreloadApi(): void {
  try {
    contextBridge.exposeInMainWorld('sshs3', api);
    contextBridge.exposeInMainWorld('multissh', api);
  } catch {
    // Safely ignore when run outside electron preload environment
  }
}

exposePreloadApi();
