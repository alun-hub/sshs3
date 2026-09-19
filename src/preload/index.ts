import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IPC_CHANNELS,
  type MultiSSHApi,
  type StorageConnectConfig,
  type HostKeyPromptEvent,
  type TransferConflictPromptEvent,
  type TransferConflictResolution,
  type SshAgentStatus,
  type FileReadResult,
  type ExternalFileStatusEvent,
  type AwsSsoPromptEvent,
} from '../shared/types/ipc';
import type { AwsSsoAccount, AwsSsoAccountRole, AwsSsoLoginResult } from '../shared/types/aws';
import type {
  DotfileImportedFile,
  DotfilePool,
  DotfilesSyncPromptEvent,
  DotfilesSyncResolution,
  DotfilesSyncStatusEvent,
} from '../shared/types/dotfiles';
import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
  DetectedSmartcardLib,
  CachedSmartcardAgent,
  XServerStatus,
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
import type { ProfileSyncStatus, ProfileSyncPullResult, SyncComparisonResult } from '../shared/types/sync';

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

  terminalReconnect: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RECONNECT, sessionId),

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

  onTerminalReconnecting: (
    callback: (sessionId: string, event: { attempt: number; maxAttempts: number }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      sessionId: string,
      event: { attempt: number; maxAttempts: number }
    ) => callback(sessionId, event);
    ipcRenderer.on(IPC_CHANNELS.TERMINAL_RECONNECTING, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_RECONNECTING, listener);
    };
  },

  // Smartcard
  smartcardDetect: (): Promise<DetectedSmartcardLib[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SMARTCARD_DETECT),

  smartcardValidate: (path: string): Promise<{ valid: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SMARTCARD_VALIDATE, path),

  smartcardLockAll: (): Promise<{ locked: number }> => ipcRenderer.invoke(IPC_CHANNELS.SMARTCARD_LOCK_ALL),

  smartcardListCached: (): Promise<CachedSmartcardAgent[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SMARTCARD_LIST_CACHED),

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

  storageList: (providerId: string, remotePath: string, force?: boolean): Promise<FileEntry[]> =>
    force !== undefined
      ? ipcRenderer.invoke(IPC_CHANNELS.STORAGE_LIST, providerId, remotePath, force)
      : ipcRenderer.invoke(IPC_CHANNELS.STORAGE_LIST, providerId, remotePath),

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

  storageGetPresignedUrl: (providerId: string, remotePath: string, expiresInSeconds: number): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.STORAGE_GET_PRESIGNED_URL, providerId, remotePath, expiresInSeconds),

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

  getPathForFile: (file: File): string => {
    try {
      return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file as any)?.path || '';
    } catch {
      return (file as any)?.path || '';
    }
  },

  startDrag: (options: { file: string; icon?: string }): void => {
    ipcRenderer.send(IPC_CHANNELS.START_DRAG, options);
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

  // Remote profile sync
  profileSyncSetup: (payload: { target: StorageConnectConfig; remoteBasePath?: string }): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_SETUP, payload),

  profileSyncEnable: (passwords: {
    topologyPassword: string;
    credentialsPassword: string;
  }): Promise<ProfileSyncStatus> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_ENABLE, passwords),

  profileSyncPush: (): Promise<ProfileSyncStatus> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_PUSH),

  profileSyncPull: (passwords?: {
    topologyPassword?: string;
    credentialsPassword?: string;
  }): Promise<ProfileSyncPullResult & ProfileSyncStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_PULL, passwords),

  profileSyncStatus: (): Promise<ProfileSyncStatus> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_STATUS),
  profileSyncCompare: (): Promise<SyncComparisonResult> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_COMPARE),
  profileSyncSetAutoSync: (enabled: boolean): Promise<ProfileSyncStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_SET_AUTO_SYNC, enabled),
  profileSyncUnlockSmartcard: (options?: { pkcs11LibPath?: string; pin?: string }): Promise<ProfileSyncStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_UNLOCK_SMARTCARD, options),
  profileSyncLinkSmartcard: (options: {
    pkcs11LibPath: string;
    pin?: string;
    passwords?: { topologyPassword: string; credentialsPassword: string };
  }): Promise<ProfileSyncStatus> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_LINK_SMARTCARD, options),
  profileSyncUnlinkSmartcard: (): Promise<ProfileSyncStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SYNC_UNLINK_SMARTCARD),
  onProfileSyncStatus: (callback: (status: ProfileSyncStatus) => void): (() => void) => {
    const subscription = (_event: any, status: ProfileSyncStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.PROFILE_SYNC_STATUS, subscription);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PROFILE_SYNC_STATUS, subscription);
  },

  // Connection Testing
  testSSHConnection: (config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_TEST_SSH, config),

  testS3Connection: (config: S3Config): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.CONNECTION_TEST_S3, config),

  // AWS SSO login (device-authorization flow)
  awsSsoLogin: (startUrl: string, region: string): Promise<AwsSsoLoginResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.AWS_SSO_LOGIN, startUrl, region),

  awsSsoCancelLogin: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AWS_SSO_LOGIN_CANCEL, id),

  onAwsSsoPrompt: (callback: (event: AwsSsoPromptEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: AwsSsoPromptEvent) => callback(event);
    ipcRenderer.on(IPC_CHANNELS.AWS_SSO_PROMPT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AWS_SSO_PROMPT, listener);
    };
  },

  awsSsoListAccounts: (accessToken: string, region: string): Promise<AwsSsoAccount[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS, accessToken, region),

  awsSsoListRoles: (accessToken: string, region: string, accountId: string): Promise<AwsSsoAccountRole[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.AWS_SSO_LIST_ROLES, accessToken, region, accountId),

  // SSH Agent
  getSshAgentStatus: (): Promise<SshAgentStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.SSH_AGENT_STATUS),

  // Dotfiles pools
  dotfilePoolsGet: (): Promise<DotfilePool[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOTFILES_POOLS_GET),

  dotfilePoolsSave: (pool: DotfilePool): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOTFILES_POOLS_SAVE, pool),

  dotfilePoolsDelete: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOTFILES_POOLS_DELETE, id),

  dotfilePoolOpenFolder: (poolId: string): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOTFILES_OPEN_FOLDER, poolId),

  dotfilePoolSelectFiles: (): Promise<DotfileImportedFile[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOTFILES_SELECT_FILES),

  dotfilePoolAddFromStorage: (options: {
    poolId: string;
    providerId: string;
    filePath: string;
    targetRemotePath?: string;
  }): Promise<DotfilePool> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOTFILES_ADD_FROM_STORAGE, options),

  onDotfilesSyncPrompt: (callback: (event: DotfilesSyncPromptEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DotfilesSyncPromptEvent) => callback(event);
    ipcRenderer.on(IPC_CHANNELS.DOTFILES_SYNC_PROMPT, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DOTFILES_SYNC_PROMPT, listener);
    };
  },

  respondDotfilesSyncPrompt: (id: string, resolution: DotfilesSyncResolution): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOTFILES_SYNC_RESPOND, id, resolution),

  onDotfilesSyncStatus: (callback: (event: DotfilesSyncStatusEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DotfilesSyncStatusEvent) => callback(event);
    ipcRenderer.on(IPC_CHANNELS.DOTFILES_SYNC_STATUS, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DOTFILES_SYNC_STATUS, listener);
    };
  },

  // File Editor
  fileRead: (providerId: string, remotePath: string, maxBytes?: number): Promise<FileReadResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, providerId, remotePath, maxBytes),

  fileSave: (providerId: string, remotePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, providerId, remotePath, content),

  fileOpenExternal: (
    providerId: string,
    remotePath: string
  ): Promise<{ sessionToken: string; localPath: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_OPEN_EXTERNAL, providerId, remotePath),

  fileCloseExternal: (sessionToken: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_CLOSE_EXTERNAL, sessionToken),

  onExternalFileStatus: (callback: (event: ExternalFileStatusEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: ExternalFileStatusEvent) =>
      callback(event);
    ipcRenderer.on(IPC_CHANNELS.FILE_EXTERNAL_STATUS, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FILE_EXTERNAL_STATUS, listener);
    };
  },

  // Window / General
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),

  getHomeDir: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_HOMEDIR),

  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),

  detectLocalShells: (): Promise<{ pwsh: boolean; wsl: boolean; wslDistros: string[] }> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_DETECT_LOCAL_SHELLS),

  checkX11Server: (display?: string): Promise<{ running: boolean; display: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_CHECK_X11_SERVER, display),

  x11GetStatus: (customPath?: string, display?: string): Promise<XServerStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.X11_GET_STATUS, customPath, display),

  x11StartServer: (options?: { customPath?: string; customArgs?: string; display?: string }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.X11_START_SERVER, options),

  x11StopServer: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.X11_STOP_SERVER),

  dialogOpenFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, options),

  dialogOpenFolder: (options?: { title?: string }): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER, options),
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
