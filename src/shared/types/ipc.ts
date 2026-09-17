import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
  DetectedSmartcardLib,
} from './ssh';
import type {
  FileEntry,
  ObjectMetadata,
  TransferProgress,
  SFTPConfig,
  S3Config,
  S3Tag,
  BucketVersioningInfo,
  ObjectVersionEntry,
} from './storage';
import type { SessionData } from './session';
import type { AppSettings } from './settings';
import type {
  DotfileImportedFile,
  DotfilePool,
  DotfilesSyncPromptEvent,
  DotfilesSyncResolution,
  DotfilesSyncStatusEvent,
} from './dotfiles';

export const IPC_CHANNELS = {
  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_RECONNECT: 'terminal:reconnect',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_RECONNECTING: 'terminal:reconnecting',

  // Smartcard
  SMARTCARD_DETECT: 'smartcard:detect',
  SMARTCARD_VALIDATE: 'smartcard:validate',
  ASKPASS_PROMPT: 'askpass:prompt',
  ASKPASS_SUBMIT_PIN: 'askpass:submit-pin',

  // SFTP host key verification (TOFU)
  HOSTKEY_PROMPT: 'hostkey:prompt',
  HOSTKEY_RESPOND: 'hostkey:respond',

  // Storage
  STORAGE_CONNECT: 'storage:connect',
  STORAGE_DISCONNECT: 'storage:disconnect',
  STORAGE_LIST: 'storage:list',
  STORAGE_STAT: 'storage:stat',
  STORAGE_CREATE_FOLDER: 'storage:create-folder',
  STORAGE_DELETE: 'storage:delete',
  STORAGE_RENAME: 'storage:rename',
  STORAGE_CHMOD: 'storage:chmod',
  STORAGE_SET_METADATA: 'storage:set-metadata',
  STORAGE_GET_TAGS: 'storage:get-tags',
  STORAGE_SET_TAGS: 'storage:set-tags',
  STORAGE_GET_BUCKET_POLICY: 'storage:get-bucket-policy',
  STORAGE_SET_BUCKET_POLICY: 'storage:set-bucket-policy',
  STORAGE_GET_BUCKET_CORS: 'storage:get-bucket-cors',
  STORAGE_SET_BUCKET_CORS: 'storage:set-bucket-cors',
  STORAGE_GET_BUCKET_VERSIONING: 'storage:get-bucket-versioning',
  STORAGE_SET_BUCKET_VERSIONING: 'storage:set-bucket-versioning',
  STORAGE_LIST_OBJECT_VERSIONS: 'storage:list-object-versions',
  STORAGE_DELETE_OBJECT_VERSION: 'storage:delete-object-version',
  STORAGE_RESTORE_OBJECT_VERSION: 'storage:restore-object-version',

  // Transfer
  TRANSFER_ADD: 'transfer:add',
  TRANSFER_PAUSE: 'transfer:pause',
  TRANSFER_RESUME: 'transfer:resume',
  TRANSFER_CANCEL: 'transfer:cancel',
  TRANSFER_GET_JOBS: 'transfer:get-jobs',
  TRANSFER_CLEAR_COMPLETED: 'transfer:clear-completed',
  TRANSFER_PROGRESS: 'transfer:progress',
  TRANSFER_CONFLICT_PROMPT: 'transfer:conflict-prompt',
  TRANSFER_CONFLICT_RESPOND: 'transfer:conflict-respond',

  // Profiles
  PROFILES_GET: 'profiles:get',
  PROFILES_SAVE_SSH: 'profiles:save-ssh',
  PROFILES_DELETE_SSH: 'profiles:delete-ssh',
  PROFILES_SAVE_S3: 'profiles:save-s3',
  PROFILES_DELETE_S3: 'profiles:delete-s3',

  // Session & Tabs
  SESSION_GET: 'session:get',
  SESSION_SAVE: 'session:save',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',

  // Connection Testing
  CONNECTION_TEST_SSH: 'connection:test-ssh',
  CONNECTION_TEST_S3: 'connection:test-s3',

  // SSH Agent
  SSH_AGENT_STATUS: 'ssh:agent-status',

  // Dotfiles pools (opt-in, see AppSettings.dotfilesPoolEnabled)
  DOTFILES_POOLS_GET: 'dotfiles:pools-get',
  DOTFILES_POOLS_SAVE: 'dotfiles:pools-save',
  DOTFILES_POOLS_DELETE: 'dotfiles:pools-delete',
  DOTFILES_OPEN_FOLDER: 'dotfiles:open-folder',
  DOTFILES_SELECT_FILES: 'dotfiles:select-files',
  DOTFILES_ADD_FROM_STORAGE: 'dotfiles:add-from-storage',
  DOTFILES_SYNC_PROMPT: 'dotfiles:sync-prompt',
  DOTFILES_SYNC_RESPOND: 'dotfiles:sync-respond',
  DOTFILES_SYNC_STATUS: 'dotfiles:sync-status',

  // General
  APP_GET_VERSION: 'app:get-version',
  APP_GET_HOMEDIR: 'app:get-homedir',
  APP_GET_PLATFORM: 'app:get-platform',
  DIALOG_OPEN_FILE: 'dialog:open-file',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface HostKeyPromptEvent {
  id: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  /** 'unknown' = first time connecting to this host. 'mismatch' = the presented key differs from a previously trusted one. */
  status: 'unknown' | 'mismatch';
}

export type TransferConflictResolution = 'overwrite' | 'skip' | 'rename';

export interface TransferConflictPromptEvent {
  id: string;
  sourcePath: string;
  targetPath: string;
  fileName: string;
  isDirectory: boolean;
}

export interface StorageConnectConfig {
  id: string;
  name: string;
  type: 'local' | 'sftp' | 's3';
  localBasePath?: string;
  sftpConfig?: SFTPConfig;
  s3Config?: S3Config;
}

export interface MultiSSHApi {
  // Terminal
  terminalCreate(options: {
    config?: SSHConnectionConfig;
    local?: boolean;
    ptyOptions?: PtyOptions;
  }): Promise<{ sessionId: string }>;
  terminalWrite(sessionId: string, data: string): Promise<void>;
  terminalResize(sessionId: string, cols: number, rows: number): Promise<void>;
  terminalKill(sessionId: string): Promise<void>;
  terminalReconnect(sessionId: string): Promise<boolean>;
  onTerminalData(callback: (sessionId: string, data: string) => void): () => void;
  onTerminalExit(callback: (sessionId: string, event: SSHPtyExitEvent) => void): () => void;
  onTerminalReconnecting?(callback: (sessionId: string, event: { attempt: number; maxAttempts: number }) => void): () => void;

  // Smartcard
  smartcardDetect(): Promise<DetectedSmartcardLib[]>;
  smartcardValidate(path: string): Promise<{ valid: boolean; error?: string }>;
  onAskpassPrompt(callback: (event: { id: string; prompt: string; sessionId?: string }) => void): () => void;
  submitAskpassPin(id: string, pin: string): Promise<void>;

  // SFTP host key verification (TOFU)
  onHostKeyPrompt(callback: (event: HostKeyPromptEvent) => void): () => void;
  respondHostKeyPrompt(id: string, trust: boolean): Promise<void>;

  // Transfer conflict resolution
  onTransferConflictPrompt(callback: (event: TransferConflictPromptEvent) => void): () => void;
  respondTransferConflict(id: string, resolution: TransferConflictResolution, applyToAll: boolean): Promise<void>;

  // Storage
  connectStorage(config: StorageConnectConfig): Promise<{ id: string }>;
  disconnectStorage(providerId: string): Promise<void>;
  storageList(providerId: string, remotePath: string, force?: boolean): Promise<FileEntry[]>;
  storageStat(providerId: string, remotePath: string): Promise<FileEntry>;
  storageCreateFolder(providerId: string, remotePath: string): Promise<void>;
  storageDelete(providerId: string, remotePath: string, isDirectory: boolean): Promise<void>;
  storageRename(providerId: string, oldPath: string, newPath: string): Promise<void>;
  storageChmod(providerId: string, remotePath: string, mode: number | string): Promise<void>;
  storageSetMetadata(providerId: string, remotePath: string, metadata: ObjectMetadata): Promise<void>;
  storageGetTags(providerId: string, remotePath: string): Promise<S3Tag[]>;
  storageSetTags(providerId: string, remotePath: string, tags: S3Tag[]): Promise<void>;
  storageGetBucketPolicy(providerId: string, bucketPath: string): Promise<string | null>;
  storageSetBucketPolicy(providerId: string, bucketPath: string, policy: string | null): Promise<void>;
  storageGetBucketCors(providerId: string, bucketPath: string): Promise<string | null>;
  storageSetBucketCors(providerId: string, bucketPath: string, corsJson: string | null): Promise<void>;
  storageGetBucketVersioning(providerId: string, bucketPath: string): Promise<BucketVersioningInfo>;
  storageSetBucketVersioning(providerId: string, bucketPath: string, enabled: boolean): Promise<void>;
  storageListObjectVersions(providerId: string, remotePath: string): Promise<ObjectVersionEntry[]>;
  storageDeleteObjectVersion(providerId: string, remotePath: string, versionId: string): Promise<void>;
  storageRestoreObjectVersion(providerId: string, remotePath: string, versionId: string): Promise<void>;

  // Transfer
  transferAdd(options: {
    sourceProviderId: string;
    sourcePath: string;
    targetProviderId: string;
    targetPath: string;
    conflictPolicy?: TransferConflictResolution;
  }): Promise<{ jobId: string | null; skipped?: boolean; resolvedPolicy?: TransferConflictResolution; appliedToAll?: boolean }>;
  transferPause(jobId: string): Promise<void>;
  transferResume(jobId: string): Promise<void>;
  transferCancel(jobId: string): Promise<void>;
  transferGetJobs(): Promise<TransferProgress[]>;
  transferClearCompleted(): Promise<void>;
  onTransferProgress(callback: (progress: TransferProgress) => void): () => void;

  // Profiles
  profilesGet(): Promise<{ ssh: SSHConnectionConfig[]; s3: S3Config[] }>;
  profilesSaveSSH(config: SSHConnectionConfig): Promise<void>;
  profilesDeleteSSH(id: string): Promise<void>;
  profilesSaveS3(config: S3Config): Promise<void>;
  profilesDeleteS3(id: string): Promise<void>;

  // Session
  sessionGet(): Promise<SessionData | null>;
  sessionSave(data: SessionData): Promise<void>;

  // Settings
  settingsGet(): Promise<AppSettings>;
  settingsSave(settings: Partial<AppSettings>): Promise<AppSettings>;

  // Connection Testing
  testSSHConnection(config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }>;
  testS3Connection(config: S3Config): Promise<{ success: boolean; error?: string }>;

  // SSH Agent
  getSshAgentStatus(): Promise<SshAgentStatus>;

  // Dotfiles pools
  dotfilePoolsGet(): Promise<DotfilePool[]>;
  dotfilePoolsSave(pool: DotfilePool): Promise<void>;
  dotfilePoolsDelete(id: string): Promise<void>;
  dotfilePoolOpenFolder(poolId: string): Promise<string>;
  dotfilePoolSelectFiles(): Promise<DotfileImportedFile[]>;
  dotfilePoolAddFromStorage(options: {
    poolId: string;
    providerId: string;
    filePath: string;
    targetRemotePath?: string;
  }): Promise<DotfilePool>;
  onDotfilesSyncPrompt(callback: (event: DotfilesSyncPromptEvent) => void): () => void;
  respondDotfilesSyncPrompt(id: string, resolution: DotfilesSyncResolution): Promise<void>;
  onDotfilesSyncStatus(callback: (event: DotfilesSyncStatusEvent) => void): () => void;

  // Window / General
  getVersion(): Promise<string>;
  getHomeDir(): Promise<string>;
  getPlatform(): Promise<'win32' | 'darwin' | 'linux' | string>;
  dialogOpenFile(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
}

export interface SshAgentStatus {
  isRunning: boolean;
  socketPath?: string;
  isManaged: boolean;
  platform: string;
  instructions?: string;
  error?: string;
}

export type SSHS3Api = MultiSSHApi;

declare global {
  interface Window {
    sshs3: MultiSSHApi;
    multissh: MultiSSHApi;
  }
}
