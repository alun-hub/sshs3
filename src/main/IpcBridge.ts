import crypto from 'node:crypto';
import { ipcMain as electronIpcMain, app as electronApp, dialog as electronDialog } from 'electron';
import type { IpcMain } from 'electron';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { SSHPtyManager } from './ssh/SSHPtyManager';
import { SmartcardDetector } from './smartcard/SmartcardDetector';
import { StorageRegistry } from './storage/StorageRegistry';
import { SFTPStorageProvider } from './storage/SFTPStorageProvider';
import { S3StorageProvider } from './storage/S3StorageProvider';
import { TransferQueue } from './transfer/TransferQueue';
import {
  getBaseName,
  isDirectoryPath,
  joinPaths,
} from './transfer/TransferPipeline';
import { ProfileStore } from './profile/ProfileStore';
import {
  IPC_CHANNELS,
  type StorageConnectConfig,
} from '../shared/types/ipc';
import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
} from '../shared/types/ssh';
import type {
  FileEntry,
  TransferProgress,
  S3Config,
} from '../shared/types/storage';

interface PendingAskpassPrompt {
  sessionId?: string;
  callback: (pin: string) => void;
}

export interface IpcBridgeOptions {
  ipcMain?: IpcMain;
  sshPtyManager?: SSHPtyManager;
  storageRegistry?: StorageRegistry;
  transferQueue?: TransferQueue;
  profileStore?: ProfileStore;
  getWebContents?: () => Electron.WebContents | null | undefined;
}

export class IpcBridge {
  private ipcMain: IpcMain;
  public readonly sshPtyManager: SSHPtyManager;
  public readonly storageRegistry: StorageRegistry;
  public readonly transferQueue: TransferQueue;
  public readonly profileStore: ProfileStore;
  private getWebContents: () => Electron.WebContents | null | undefined;

  private pendingAskpass = new Map<string, PendingAskpassPrompt>();
  private handlers = new Set<string>();

  // Event listener references for clean teardown
  private onPtyData?: (event: { sessionId: string; data: string }) => void;
  private onPtyExit?: (event: { sessionId: string; exitCode: number; signal?: number }) => void;
  private onPtyAskpass?: (event: { sessionId: string; prompt: string; callback: (pin: string) => void }) => void;
  private onTransferProgress?: (progress: TransferProgress) => void;

  constructor(options: IpcBridgeOptions = {}) {
    this.ipcMain = options.ipcMain ?? electronIpcMain;
    this.sshPtyManager = options.sshPtyManager ?? new SSHPtyManager();
    this.storageRegistry = options.storageRegistry ?? new StorageRegistry();
    this.transferQueue = options.transferQueue ?? new TransferQueue();
    this.profileStore = options.profileStore ?? new ProfileStore();
    this.getWebContents = options.getWebContents ?? (() => null);
  }

  public setWebContentsGetter(getter: () => Electron.WebContents | null | undefined): void {
    this.getWebContents = getter;
  }

  public register(): void {
    this.registerTerminalHandlers();
    this.registerSmartcardHandlers();
    this.registerStorageHandlers();
    this.registerTransferHandlers();
    this.registerProfileHandlers();
    this.registerConnectionTestHandlers();
    this.registerGeneralHandlers();
    this.setupEventListeners();
  }

  private registerHandler(channel: string, handler: (...args: any[]) => any): void {
    this.ipcMain.handle(channel, handler);
    this.handlers.add(channel);
  }

  private registerTerminalHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.TERMINAL_CREATE,
      async (_event, options: { config: SSHConnectionConfig; ptyOptions?: PtyOptions }) => {
        if (!options || !options.config) {
          throw new Error('Connection config is required to create terminal');
        }
        const session = await this.sshPtyManager.createSession(options.config, options.ptyOptions);
        return { sessionId: session.sessionId };
      }
    );

    this.registerHandler(
      IPC_CHANNELS.TERMINAL_WRITE,
      async (_event, sessionId: string, data: string) => {
        this.sshPtyManager.write(sessionId, data);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.TERMINAL_RESIZE,
      async (_event, sessionId: string, cols: number, rows: number) => {
        this.sshPtyManager.resize(sessionId, cols, rows);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.TERMINAL_KILL,
      async (_event, sessionId: string) => {
        this.sshPtyManager.kill(sessionId);
      }
    );
  }

  private registerSmartcardHandlers(): void {
    this.registerHandler(IPC_CHANNELS.SMARTCARD_DETECT, async () => {
      return await SmartcardDetector.detectAvailableLibraries();
    });

    this.registerHandler(
      IPC_CHANNELS.SMARTCARD_VALIDATE,
      async (_event, libPath: string) => {
        const valid = await SmartcardDetector.validateLibraryPath(libPath);
        if (valid) {
          return { valid: true };
        }
        return { valid: false, error: 'Library file not found or invalid' };
      }
    );

    this.registerHandler(
      IPC_CHANNELS.ASKPASS_SUBMIT_PIN,
      async (_event, id: string, pin: string) => {
        const prompt = this.pendingAskpass.get(id);
        if (!prompt) {
          throw new Error(`Askpass prompt with id "${id}" not found or expired`);
        }
        this.pendingAskpass.delete(id);
        prompt.callback(pin);
      }
    );
  }

  private registerStorageHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.STORAGE_CONNECT,
      async (_event, config: StorageConnectConfig) => {
        await this.storageRegistry.getOrCreate(config);
        return { id: config.id };
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_DISCONNECT,
      async (_event, providerId: string) => {
        await this.storageRegistry.disconnect(providerId);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_LIST,
      async (_event, providerId: string, remotePath: string): Promise<FileEntry[]> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        return await provider.list(remotePath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_STAT,
      async (_event, providerId: string, remotePath: string): Promise<FileEntry> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        return await provider.stat(remotePath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_CREATE_FOLDER,
      async (_event, providerId: string, remotePath: string): Promise<void> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        await provider.createFolder(remotePath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_DELETE,
      async (_event, providerId: string, remotePath: string, isDirectory: boolean): Promise<void> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        await provider.delete(remotePath, isDirectory);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_RENAME,
      async (_event, providerId: string, oldPath: string, newPath: string): Promise<void> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        await provider.rename(oldPath, newPath);
      }
    );
  }

  private registerTransferHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.TRANSFER_ADD,
      async (
        _event,
        options: {
          sourceProviderId: string;
          sourcePath: string;
          targetProviderId: string;
          targetPath: string;
        }
      ) => {
        if (!options?.sourceProviderId || !options?.targetProviderId) {
          throw new Error('sourceProviderId and targetProviderId are required for transfer');
        }
        const sourceProvider = this.storageRegistry.get(options.sourceProviderId);
        if (!sourceProvider) {
          throw new Error(`Source storage provider not found: ${options.sourceProviderId}`);
        }
        const targetProvider = this.storageRegistry.get(options.targetProviderId);
        if (!targetProvider) {
          throw new Error(`Target storage provider not found: ${options.targetProviderId}`);
        }

        let isDirectory = false;
        let totalBytes: number | undefined;
        try {
          const srcStat = await sourceProvider.stat(options.sourcePath);
          isDirectory = Boolean(srcStat.isDirectory);
          totalBytes = srcStat.size;
        } catch {
          // ignore error if stat not available
        }

        let resolvedTargetPath = options.targetPath;
        const sourceBaseName = getBaseName(options.sourcePath);
        if (sourceBaseName && (await isDirectoryPath(targetProvider, resolvedTargetPath))) {
          resolvedTargetPath = joinPaths(targetProvider.type, resolvedTargetPath, sourceBaseName);
        }

        const job = this.transferQueue.addJob({
          sourceProvider,
          sourcePath: options.sourcePath,
          targetProvider,
          targetPath: resolvedTargetPath,
          isDirectory,
          totalBytes,
        });

        return { jobId: job.id };
      }
    );

    this.registerHandler(IPC_CHANNELS.TRANSFER_PAUSE, async (_event, jobId: string) => {
      this.transferQueue.pauseJob(jobId);
    });

    this.registerHandler(IPC_CHANNELS.TRANSFER_RESUME, async (_event, jobId: string) => {
      this.transferQueue.resumeJob(jobId);
    });

    this.registerHandler(IPC_CHANNELS.TRANSFER_CANCEL, async (_event, jobId: string) => {
      this.transferQueue.cancelJob(jobId);
    });

    this.registerHandler(IPC_CHANNELS.TRANSFER_GET_JOBS, async (): Promise<TransferProgress[]> => {
      return this.transferQueue.getJobs().map((j) => j.progress);
    });

    this.registerHandler(IPC_CHANNELS.TRANSFER_CLEAR_COMPLETED, async (): Promise<void> => {
      this.transferQueue.clearCompleted();
    });
  }

  private registerProfileHandlers(): void {
    this.registerHandler(IPC_CHANNELS.PROFILES_GET, async () => {
      return await this.profileStore.getProfiles();
    });

    this.registerHandler(
      IPC_CHANNELS.PROFILES_SAVE_SSH,
      async (_event, config: SSHConnectionConfig) => {
        await this.profileStore.saveSSH(config);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_DELETE_SSH,
      async (_event, id: string) => {
        await this.profileStore.deleteSSH(id);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_SAVE_S3,
      async (_event, config: S3Config) => {
        await this.profileStore.saveS3(config);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_DELETE_S3,
      async (_event, id: string) => {
        await this.profileStore.deleteS3(id);
      }
    );
  }

  private registerConnectionTestHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.CONNECTION_TEST_SSH,
      async (_event, config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }> => {
        if (!config || !config.host?.trim()) {
          return { success: false, error: 'Värdnamn / IP saknas' };
        }
        if (!config.username?.trim()) {
          return { success: false, error: 'Användarnamn saknas' };
        }

        if (config.authType === 'smartcard') {
          if (!config.pkcs11LibPath?.trim()) {
            return { success: false, error: 'PKCS#11-bibliotekssökväg saknas' };
          }
          const valid = await SmartcardDetector.validateLibraryPath(config.pkcs11LibPath);
          if (!valid) {
            return { success: false, error: `Smartcard-biblioteket finns inte: ${config.pkcs11LibPath}` };
          }
          return { success: true };
        }

        try {
          const provider = new SFTPStorageProvider({
            id: `test-${crypto.randomUUID()}`,
            name: 'Test SSH',
            host: config.host,
            port: config.port ?? 22,
            username: config.username,
            authType: config.authType,
            password: config.password,
            privateKeyPath: config.privateKeyPath,
            passphrase: config.passphrase,
            agentPath: config.agentPath,
            pkcs11LibPath: config.pkcs11LibPath,
          });
          await provider.ensureConnected();
          await provider.disconnect?.();
          return { success: true };
        } catch (err: any) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    );

    this.registerHandler(
      IPC_CHANNELS.CONNECTION_TEST_S3,
      async (_event, config: S3Config): Promise<{ success: boolean; error?: string }> => {
        if (!config || !config.region?.trim() || !config.accessKeyId?.trim() || !config.secretAccessKey?.trim()) {
          return { success: false, error: 'Region, Access Key ID och Secret Access Key krävs' };
        }
        try {
          const provider = new S3StorageProvider({
            ...config,
            id: `test-${crypto.randomUUID()}`,
            name: 'Test S3',
          });
          await provider.client.send(new ListBucketsCommand({}));
          return { success: true };
        } catch (err: any) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    );
  }

  private registerGeneralHandlers(): void {
    this.registerHandler(IPC_CHANNELS.APP_GET_VERSION, async () => {
      try {
        return electronApp.getVersion();
      } catch {
        return '0.1.0';
      }
    });

    this.registerHandler(
      IPC_CHANNELS.DIALOG_OPEN_FILE,
      async (_event, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
        const result = await electronDialog.showOpenDialog({
          title: options?.title,
          filters: options?.filters,
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        return result.filePaths[0];
      }
    );
  }

  private setupEventListeners(): void {
    this.onPtyData = ({ sessionId, data }) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.TERMINAL_DATA, sessionId, data);
      }
    };
    this.sshPtyManager.on('data', this.onPtyData);

    this.onPtyExit = ({ sessionId, exitCode, signal }) => {
      // Reject and remove any pending askpass prompts matching that sessionId
      for (const [id, prompt] of this.pendingAskpass.entries()) {
        if (prompt.sessionId === sessionId) {
          try {
            prompt.callback('');
          } catch {
            // Ignore callback error
          }
          this.pendingAskpass.delete(id);
        }
      }

      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        const event: SSHPtyExitEvent = { exitCode, signal };
        webContents.send(IPC_CHANNELS.TERMINAL_EXIT, sessionId, event);
      }
    };
    this.sshPtyManager.on('exit', this.onPtyExit);

    this.onPtyAskpass = ({ sessionId, prompt, callback }) => {
      const id = crypto.randomUUID();
      this.pendingAskpass.set(id, { sessionId, callback });

      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.ASKPASS_PROMPT, { id, prompt, sessionId });
      }
    };
    this.sshPtyManager.on('askpass', this.onPtyAskpass);

    this.onTransferProgress = (progress) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.TRANSFER_PROGRESS, progress);
      }
    };
    this.transferQueue.on('progress', this.onTransferProgress);
  }

  public async dispose(): Promise<void> {
    for (const channel of this.handlers) {
      this.ipcMain.removeHandler(channel);
    }
    this.handlers.clear();

    if (this.onPtyData) {
      this.sshPtyManager.off('data', this.onPtyData);
    }
    if (this.onPtyExit) {
      this.sshPtyManager.off('exit', this.onPtyExit);
    }
    if (this.onPtyAskpass) {
      this.sshPtyManager.off('askpass', this.onPtyAskpass);
    }
    if (this.onTransferProgress) {
      this.transferQueue.off('progress', this.onTransferProgress);
    }
    this.transferQueue?.cancelAll?.();

    for (const prompt of this.pendingAskpass.values()) {
      try {
        prompt.callback('');
      } catch {
        // Ignore
      }
    }
    this.pendingAskpass.clear();

    await this.sshPtyManager.killAll();
    await this.storageRegistry.disconnectAll();
  }
}
