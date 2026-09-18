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
import type { AwsSsoAccount, AwsSsoAccountRole, AwsSsoDevicePrompt, AwsSsoLoginResult } from './aws';
import type { SessionData } from './session';
import type { AppSettings } from './settings';
import type {
  DotfileImportedFile,
  DotfilePool,
  DotfilesSyncPromptEvent,
  DotfilesSyncResolution,
  DotfilesSyncStatusEvent,
} from './dotfiles';
import type { ProfileSyncStatus, ProfileSyncPullResult, SyncComparisonResult } from './sync';

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
  STORAGE_GET_PRESIGNED_URL: 'storage:get-presigned-url',

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
  START_DRAG: 'drag:start',

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

  // Remote profile sync ("Remote Profile Sync" — distinct from the
  // dotfiles:sync-* channels above, which deploy a dotfile pool to a remote
  // SSH server on connect. This syncs the user's own profiles/pools/settings
  // between their own machines via a Zero-Knowledge-encrypted S3/SFTP target.)
  PROFILE_SYNC_SETUP: 'profile-sync:setup',
  PROFILE_SYNC_ENABLE: 'profile-sync:enable',
  PROFILE_SYNC_PUSH: 'profile-sync:push',
  PROFILE_SYNC_PULL: 'profile-sync:pull',
  PROFILE_SYNC_STATUS: 'profile-sync:status',
  PROFILE_SYNC_COMPARE: 'profile-sync:compare',

  // Connection Testing
  CONNECTION_TEST_SSH: 'connection:test-ssh',
  CONNECTION_TEST_S3: 'connection:test-s3',

  // AWS SSO login (device-authorization flow)
  AWS_SSO_LOGIN: 'aws-sso:login',
  AWS_SSO_LOGIN_CANCEL: 'aws-sso:login-cancel',
  AWS_SSO_PROMPT: 'aws-sso:prompt',
  AWS_SSO_LIST_ACCOUNTS: 'aws-sso:list-accounts',
  AWS_SSO_LIST_ROLES: 'aws-sso:list-roles',

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

  // File Editor
  FILE_READ: 'file:read',
  FILE_SAVE: 'file:save',
  FILE_OPEN_EXTERNAL: 'file:open-external',
  FILE_CLOSE_EXTERNAL: 'file:close-external',
  FILE_EXTERNAL_STATUS: 'file:external-status',

  // General
  APP_GET_VERSION: 'app:get-version',
  APP_GET_HOMEDIR: 'app:get-homedir',
  APP_GET_PLATFORM: 'app:get-platform',
  APP_DETECT_LOCAL_SHELLS: 'app:detect-local-shells',
  DIALOG_OPEN_FILE: 'dialog:open-file',
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',
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

export interface AwsSsoPromptEvent extends AwsSsoDevicePrompt {
  id: string;
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
  storageGetPresignedUrl(providerId: string, remotePath: string, expiresInSeconds: number): Promise<string>;

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
  getPathForFile?(file: File): string;
  startDrag?(options: { file: string; icon?: string }): void;

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

  // Remote profile sync
  profileSyncSetup(payload: { target: StorageConnectConfig; remoteBasePath?: string }): Promise<void>;
  profileSyncEnable(passwords: { topologyPassword: string; credentialsPassword: string }): Promise<ProfileSyncStatus>;
  profileSyncPush(): Promise<ProfileSyncStatus>;
  profileSyncPull(passwords?: {
    topologyPassword?: string;
    credentialsPassword?: string;
  }): Promise<ProfileSyncPullResult & ProfileSyncStatus>;
  profileSyncStatus(): Promise<ProfileSyncStatus>;
  profileSyncCompare(): Promise<SyncComparisonResult>;

  // Connection Testing
  testSSHConnection(config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }>;
  testS3Connection(config: S3Config): Promise<{ success: boolean; error?: string }>;

  // AWS SSO login (device-authorization flow)
  awsSsoLogin(startUrl: string, region: string): Promise<AwsSsoLoginResult>;
  awsSsoCancelLogin(id: string): Promise<void>;
  onAwsSsoPrompt(callback: (event: AwsSsoPromptEvent) => void): () => void;
  awsSsoListAccounts(accessToken: string, region: string): Promise<AwsSsoAccount[]>;
  awsSsoListRoles(accessToken: string, region: string, accountId: string): Promise<AwsSsoAccountRole[]>;

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

  // File Editor
  fileRead(providerId: string, remotePath: string, maxBytes?: number): Promise<FileReadResult>;
  fileSave(providerId: string, remotePath: string, content: string): Promise<void>;
  fileOpenExternal(providerId: string, remotePath: string): Promise<{ sessionToken: string; localPath: string }>;
  fileCloseExternal(sessionToken: string): Promise<void>;
  onExternalFileStatus(callback: (event: ExternalFileStatusEvent) => void): () => void;

  // Window / General
  getVersion(): Promise<string>;
  getHomeDir(): Promise<string>;
  getPlatform(): Promise<'win32' | 'darwin' | 'linux' | string>;
  /** Windows only: which optional local shells (currently just PowerShell 7 / pwsh) are actually on PATH. */
  detectLocalShells(): Promise<{ pwsh: boolean }>;
  dialogOpenFile(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  dialogOpenFolder(options?: { title?: string }): Promise<string | null>;
}

export interface FileReadResult {
  content: string;
  size: number;
  isBinary: boolean;
  truncated: boolean;
}

export interface ExternalFileStatusEvent {
  sessionToken: string;
  remotePath: string;
  status: 'uploaded' | 'error';
  error?: string;
  timestamp: string;
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
