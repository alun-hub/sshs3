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
  pathExists,
  resolveNonConflictingPath,
  joinPaths,
} from './transfer/TransferPipeline';
import { ProfileStore } from './profile/ProfileStore';
import { SessionStore } from './session/SessionStore';
import { SettingsStore } from './settings/SettingsStore';
import { KnownHostsStore } from './ssh/KnownHostsStore';
import { createHostVerifier, type HostKeyPromptInfo } from './ssh/HostKeyVerifier';
import {
  IPC_CHANNELS,
  type StorageConnectConfig,
  type HostKeyPromptEvent,
  type TransferConflictPromptEvent,
  type TransferConflictResolution,
} from '../shared/types/ipc';
import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
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

interface PendingAskpassPrompt {
  sessionId?: string;
  callback: (pin: string) => void;
}

interface PendingHostKeyPrompt {
  callback: (trust: boolean) => void;
}

interface PendingTransferConflictPrompt {
  callback: (resolution: TransferConflictResolution, applyToAll: boolean) => void;
}

export interface IpcBridgeOptions {
  ipcMain?: IpcMain;
  sshPtyManager?: SSHPtyManager;
  storageRegistry?: StorageRegistry;
  transferQueue?: TransferQueue;
  profileStore?: ProfileStore;
  knownHostsStore?: KnownHostsStore;
  sessionStore?: SessionStore;
  settingsStore?: SettingsStore;
  getWebContents?: () => Electron.WebContents | null | undefined;
}

export class IpcBridge {
  private ipcMain: IpcMain;
  public readonly sshPtyManager: SSHPtyManager;
  public readonly storageRegistry: StorageRegistry;
  public readonly transferQueue: TransferQueue;
  public readonly profileStore: ProfileStore;
  public readonly knownHostsStore: KnownHostsStore;
  public readonly sessionStore: SessionStore;
  public readonly settingsStore: SettingsStore;
  private getWebContents: () => Electron.WebContents | null | undefined;

  private pendingAskpass = new Map<string, PendingAskpassPrompt>();
  private pendingHostKeyPrompts = new Map<string, PendingHostKeyPrompt>();
  private pendingTransferConflicts = new Map<string, PendingTransferConflictPrompt>();
  private handlers = new Set<string>();

  // Event listener references for clean teardown
  private onPtyData?: (event: { sessionId: string; data: string }) => void;
  private onPtyExit?: (event: { sessionId: string; exitCode: number; signal?: number }) => void;
  private onPtyAskpass?: (event: { sessionId: string; prompt: string; callback: (pin: string) => void }) => void;
  private onTransferProgress?: (progress: TransferProgress) => void;

  constructor(options: IpcBridgeOptions = {}) {
    this.ipcMain = options.ipcMain ?? electronIpcMain;
    this.sshPtyManager = options.sshPtyManager ?? new SSHPtyManager();
    this.knownHostsStore = options.knownHostsStore ?? new KnownHostsStore();
    this.storageRegistry =
      options.storageRegistry ??
      new StorageRegistry({
        sftpHostVerifierFactory: (host, port) =>
          createHostVerifier({
            host,
            port,
            knownHosts: this.knownHostsStore,
            onUnknownOrChanged: (info) => this.promptHostKeyTrust(info),
          }),
      });
    this.transferQueue = options.transferQueue ?? new TransferQueue();
    this.profileStore = options.profileStore ?? new ProfileStore();
    this.sessionStore = options.sessionStore ?? new SessionStore();
    this.settingsStore = options.settingsStore ?? new SettingsStore();
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
    this.registerSessionHandlers();
    this.registerSettingsHandlers();
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

    this.registerHandler(
      IPC_CHANNELS.HOSTKEY_RESPOND,
      async (_event, id: string, trust: boolean) => {
        const prompt = this.pendingHostKeyPrompts.get(id);
        if (!prompt) {
          throw new Error(`Host key prompt with id "${id}" not found or expired`);
        }
        this.pendingHostKeyPrompts.delete(id);
        prompt.callback(Boolean(trust));
      }
    );
  }

  /**
   * Asks the renderer to show a TOFU (trust-on-first-use) dialog for an
   * unknown or changed SFTP host key and resolves to whether the user chose
   * to trust it. Resolves to false (fail closed) if no window is available
   * to prompt.
   */
  public promptHostKeyTrust(info: HostKeyPromptInfo): Promise<boolean> {
    return new Promise((resolve) => {
      const webContents = this.getWebContents();
      if (!webContents || webContents.isDestroyed?.()) {
        resolve(false);
        return;
      }

      const id = crypto.randomUUID();
      this.pendingHostKeyPrompts.set(id, { callback: resolve });

      const event: HostKeyPromptEvent = { id, ...info };
      webContents.send(IPC_CHANNELS.HOSTKEY_PROMPT, event);
    });
  }

  /**
   * Asks the renderer to show a conflict-resolution dialog (overwrite / skip
   * / rename) for a transfer target that already exists. Resolves to 'skip'
   * (the non-destructive default) if no window is available to prompt.
   */
  public promptTransferConflict(
    info: Omit<TransferConflictPromptEvent, 'id'>
  ): Promise<{ resolution: TransferConflictResolution; applyToAll: boolean }> {
    return new Promise((resolve) => {
      const webContents = this.getWebContents();
      if (!webContents || webContents.isDestroyed?.()) {
        resolve({ resolution: 'skip', applyToAll: false });
        return;
      }

      const id = crypto.randomUUID();
      this.pendingTransferConflicts.set(id, {
        callback: (resolution, applyToAll) => resolve({ resolution, applyToAll }),
      });

      const event: TransferConflictPromptEvent = { id, ...info };
      webContents.send(IPC_CHANNELS.TRANSFER_CONFLICT_PROMPT, event);
    });
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

    this.registerHandler(
      IPC_CHANNELS.STORAGE_CHMOD,
      async (_event, providerId: string, remotePath: string, mode: number | string): Promise<void> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        if (typeof provider.chmod !== 'function') {
          throw new Error(`Storage provider "${providerId}" does not support chmod`);
        }
        await provider.chmod(remotePath, mode);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_SET_METADATA,
      async (_event, providerId: string, remotePath: string, metadata: ObjectMetadata): Promise<void> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        if (typeof provider.setMetadata !== 'function') {
          throw new Error(`Storage provider "${providerId}" does not support metadata updates`);
        }
        await provider.setMetadata(remotePath, metadata);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_GET_TAGS,
      async (_event, providerId: string, remotePath: string): Promise<S3Tag[]> => {
        const provider = this.requireS3Capability(providerId, 'getTags');
        return await provider.getTags!(remotePath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_SET_TAGS,
      async (_event, providerId: string, remotePath: string, tags: S3Tag[]): Promise<void> => {
        const provider = this.requireS3Capability(providerId, 'setTags');
        await provider.setTags!(remotePath, tags);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_GET_BUCKET_POLICY,
      async (_event, providerId: string, bucketPath: string): Promise<string | null> => {
        const provider = this.requireS3Capability(providerId, 'getBucketPolicy');
        return await provider.getBucketPolicy!(bucketPath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_SET_BUCKET_POLICY,
      async (_event, providerId: string, bucketPath: string, policy: string | null): Promise<void> => {
        const provider = this.requireS3Capability(providerId, 'setBucketPolicy');
        await provider.setBucketPolicy!(bucketPath, policy);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_GET_BUCKET_CORS,
      async (_event, providerId: string, bucketPath: string): Promise<string | null> => {
        const provider = this.requireS3Capability(providerId, 'getBucketCors');
        return await provider.getBucketCors!(bucketPath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_SET_BUCKET_CORS,
      async (_event, providerId: string, bucketPath: string, corsJson: string | null): Promise<void> => {
        const provider = this.requireS3Capability(providerId, 'setBucketCors');
        await provider.setBucketCors!(bucketPath, corsJson);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_GET_BUCKET_VERSIONING,
      async (_event, providerId: string, bucketPath: string): Promise<BucketVersioningInfo> => {
        const provider = this.requireS3Capability(providerId, 'getBucketVersioning');
        return await provider.getBucketVersioning!(bucketPath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_SET_BUCKET_VERSIONING,
      async (_event, providerId: string, bucketPath: string, enabled: boolean): Promise<void> => {
        const provider = this.requireS3Capability(providerId, 'setBucketVersioning');
        await provider.setBucketVersioning!(bucketPath, enabled);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_LIST_OBJECT_VERSIONS,
      async (_event, providerId: string, remotePath: string): Promise<ObjectVersionEntry[]> => {
        const provider = this.requireS3Capability(providerId, 'listObjectVersions');
        return await provider.listObjectVersions!(remotePath);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_DELETE_OBJECT_VERSION,
      async (_event, providerId: string, remotePath: string, versionId: string): Promise<void> => {
        const provider = this.requireS3Capability(providerId, 'deleteObjectVersion');
        await provider.deleteObjectVersion!(remotePath, versionId);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_RESTORE_OBJECT_VERSION,
      async (_event, providerId: string, remotePath: string, versionId: string): Promise<void> => {
        const provider = this.requireS3Capability(providerId, 'restoreObjectVersion');
        await provider.restoreObjectVersion!(remotePath, versionId);
      }
    );
  }

  private requireS3Capability<K extends keyof import('../shared/types/storage').IStorageProvider>(
    providerId: string,
    capability: K
  ): import('../shared/types/storage').IStorageProvider {
    const provider = this.storageRegistry.get(providerId);
    if (!provider) {
      throw new Error(`Storage provider not found: ${providerId}`);
    }
    if (typeof provider[capability] !== 'function') {
      throw new Error(`Storage provider "${providerId}" does not support "${String(capability)}"`);
    }
    return provider;
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
          conflictPolicy?: TransferConflictResolution;
        }
      ): Promise<{
        jobId: string | null;
        skipped?: boolean;
        resolvedPolicy?: TransferConflictResolution;
        appliedToAll?: boolean;
      }> => {
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

        let resolvedPolicy: TransferConflictResolution | undefined;
        let appliedToAll = false;

        if (await pathExists(targetProvider, resolvedTargetPath)) {
          const requestedPolicy = options.conflictPolicy ?? 'ask';
          if (requestedPolicy === 'ask') {
            const response = await this.promptTransferConflict({
              sourcePath: options.sourcePath,
              targetPath: resolvedTargetPath,
              fileName: sourceBaseName || resolvedTargetPath,
              isDirectory,
            });
            resolvedPolicy = response.resolution;
            appliedToAll = response.applyToAll;
          } else {
            resolvedPolicy = requestedPolicy;
          }

          if (resolvedPolicy === 'skip') {
            return { jobId: null, skipped: true, resolvedPolicy, appliedToAll };
          }
          if (resolvedPolicy === 'rename') {
            resolvedTargetPath = await resolveNonConflictingPath(
              targetProvider,
              targetProvider.type,
              resolvedTargetPath
            );
          }
          // 'overwrite' proceeds with resolvedTargetPath unchanged.
        }

        const job = this.transferQueue.addJob({
          sourceProvider,
          sourcePath: options.sourcePath,
          targetProvider,
          targetPath: resolvedTargetPath,
          isDirectory,
          totalBytes,
        });

        return { jobId: job.id, resolvedPolicy, appliedToAll };
      }
    );

    this.registerHandler(
      IPC_CHANNELS.TRANSFER_CONFLICT_RESPOND,
      async (_event, id: string, resolution: TransferConflictResolution, applyToAll: boolean) => {
        const prompt = this.pendingTransferConflicts.get(id);
        if (!prompt) {
          throw new Error(`Transfer conflict prompt with id "${id}" not found or expired`);
        }
        this.pendingTransferConflicts.delete(id);
        prompt.callback(resolution, Boolean(applyToAll));
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

  private registerSessionHandlers(): void {
    this.registerHandler(IPC_CHANNELS.SESSION_GET, async (): Promise<SessionData | null> => {
      return await this.sessionStore.getSession();
    });

    this.registerHandler(
      IPC_CHANNELS.SESSION_SAVE,
      async (_event, data: SessionData): Promise<void> => {
        await this.sessionStore.saveSession(data);
      }
    );
  }

  private registerSettingsHandlers(): void {
    this.registerHandler(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
      return await this.settingsStore.getSettings();
    });

    this.registerHandler(
      IPC_CHANNELS.SETTINGS_SAVE,
      async (_event, settings: Partial<AppSettings>): Promise<AppSettings> => {
        return await this.settingsStore.saveSettings(settings);
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
          const port = config.port ?? 22;
          const provider = new SFTPStorageProvider(
            {
              id: `test-${crypto.randomUUID()}`,
              name: 'Test SSH',
              host: config.host,
              port,
              username: config.username,
              authType: config.authType,
              password: config.password,
              privateKeyPath: config.privateKeyPath,
              passphrase: config.passphrase,
              agentPath: config.agentPath,
              pkcs11LibPath: config.pkcs11LibPath,
              proxy: config.proxy,
            },
            undefined,
            createHostVerifier({
              host: config.host,
              port,
              knownHosts: this.knownHostsStore,
              onUnknownOrChanged: (info) => this.promptHostKeyTrust(info),
            })
          );
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

    for (const prompt of this.pendingHostKeyPrompts.values()) {
      try {
        prompt.callback(false);
      } catch {
        // Ignore
      }
    }
    this.pendingHostKeyPrompts.clear();

    for (const prompt of this.pendingTransferConflicts.values()) {
      try {
        prompt.callback('skip', false);
      } catch {
        // Ignore
      }
    }
    this.pendingTransferConflicts.clear();

    await this.sshPtyManager.killAll();
    await this.storageRegistry.disconnectAll();
  }
}
