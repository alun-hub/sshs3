import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
  DetectedSmartcardLib,
} from './ssh';
import type {
  FileEntry,
  TransferProgress,
  SFTPConfig,
  S3Config,
} from './storage';

export const IPC_CHANNELS = {
  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  // Smartcard
  SMARTCARD_DETECT: 'smartcard:detect',
  SMARTCARD_VALIDATE: 'smartcard:validate',
  ASKPASS_PROMPT: 'askpass:prompt',
  ASKPASS_SUBMIT_PIN: 'askpass:submit-pin',

  // Storage
  STORAGE_CONNECT: 'storage:connect',
  STORAGE_DISCONNECT: 'storage:disconnect',
  STORAGE_LIST: 'storage:list',
  STORAGE_STAT: 'storage:stat',
  STORAGE_CREATE_FOLDER: 'storage:create-folder',
  STORAGE_DELETE: 'storage:delete',
  STORAGE_RENAME: 'storage:rename',

  // Transfer
  TRANSFER_ADD: 'transfer:add',
  TRANSFER_PAUSE: 'transfer:pause',
  TRANSFER_RESUME: 'transfer:resume',
  TRANSFER_CANCEL: 'transfer:cancel',
  TRANSFER_GET_JOBS: 'transfer:get-jobs',
  TRANSFER_CLEAR_COMPLETED: 'transfer:clear-completed',
  TRANSFER_PROGRESS: 'transfer:progress',

  // Profiles
  PROFILES_GET: 'profiles:get',
  PROFILES_SAVE_SSH: 'profiles:save-ssh',
  PROFILES_DELETE_SSH: 'profiles:delete-ssh',
  PROFILES_SAVE_S3: 'profiles:save-s3',
  PROFILES_DELETE_S3: 'profiles:delete-s3',

  // General
  APP_GET_VERSION: 'app:get-version',
  DIALOG_OPEN_FILE: 'dialog:open-file',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

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
  terminalCreate(options: { config: SSHConnectionConfig; ptyOptions?: PtyOptions }): Promise<{ sessionId: string }>;
  terminalWrite(sessionId: string, data: string): Promise<void>;
  terminalResize(sessionId: string, cols: number, rows: number): Promise<void>;
  terminalKill(sessionId: string): Promise<void>;
  onTerminalData(callback: (sessionId: string, data: string) => void): () => void;
  onTerminalExit(callback: (sessionId: string, event: SSHPtyExitEvent) => void): () => void;

  // Smartcard
  smartcardDetect(): Promise<DetectedSmartcardLib[]>;
  smartcardValidate(path: string): Promise<{ valid: boolean; error?: string }>;
  onAskpassPrompt(callback: (event: { id: string; prompt: string; sessionId?: string }) => void): () => void;
  submitAskpassPin(id: string, pin: string): Promise<void>;

  // Storage
  connectStorage(config: StorageConnectConfig): Promise<{ id: string }>;
  disconnectStorage(providerId: string): Promise<void>;
  storageList(providerId: string, remotePath: string): Promise<FileEntry[]>;
  storageStat(providerId: string, remotePath: string): Promise<FileEntry>;
  storageCreateFolder(providerId: string, remotePath: string): Promise<void>;
  storageDelete(providerId: string, remotePath: string, isDirectory: boolean): Promise<void>;
  storageRename(providerId: string, oldPath: string, newPath: string): Promise<void>;

  // Transfer
  transferAdd(options: { sourceProviderId: string; sourcePath: string; targetProviderId: string; targetPath: string }): Promise<{ jobId: string }>;
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

  // Window / General
  getVersion(): Promise<string>;
  dialogOpenFile(options?: { title?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
}

declare global {
  interface Window {
    multissh: MultiSSHApi;
  }
}
