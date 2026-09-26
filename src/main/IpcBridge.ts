import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ipcMain as electronIpcMain, app as electronApp, dialog as electronDialog, shell as electronShell } from 'electron';
import type { IpcMain } from 'electron';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { SSHPtyManager } from './ssh/SSHPtyManager';
import { AgentLifecycleManager } from './ssh/AgentLifecycleManager';
import { SmartcardDetector } from './smartcard/SmartcardDetector';
import {
  loadSmartcardIntoPrivateAgent,
  loadFido2ResidentKeysIntoPrivateAgent,
  listAgentIdentities,
} from './smartcard/SmartcardAgentLoader';
import { generateFido2Key, listFido2ResidentKeys, deleteFido2ResidentKey } from './smartcard/Fido2KeyManager';
import type { AskpassPromptHandler, AskpassServer } from './smartcard/AskpassServer';
import { readSmartcardCertificates } from './smartcard/SmartcardCertificateReader';
import type { SmartcardCertificateDetails } from './smartcard/CertificateParser';
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
import { DotfilePoolStore } from './dotfiles/DotfilePoolStore';
import { DotfileSyncService } from './dotfiles/DotfileSyncService';
import { computeDiff as computeDirSyncDiff, apply as applyDirSync } from './dirsync/DirectorySyncService';
import { DirectorySyncProfileStore } from './dirsync/DirectorySyncProfileStore';
import { FileEditorService } from './editor/FileEditorService';
import { FileTailService } from './editor/FileTailService';
import { SearchOrchestrator } from './search/SearchOrchestrator';
import { K8sDiscoveryService } from './services/K8sDiscoveryService';
import { loginWithToken } from './services/K8sAuthService';
import { K8sDebugService } from './services/K8sDebugService';
import { K8sPortForwardManager } from './services/K8sPortForwardManager';
import { K8sTerminalManager } from './terminal/K8sTerminalManager';
import { K8sLogManager } from './terminal/K8sLogManager';
import { AwsSsoAuthService, AwsSsoLoginCancelledError } from './aws/AwsSsoAuthService';
import { SyncConfigStore, type SyncConfigData } from './services/SyncConfigStore';
import { SyncCryptoService, generateSalt } from './services/SyncCryptoService';
import { ProfileSyncService } from './services/ProfileSyncService';
import {
  getAgentIdentities,
  signChallengeWithAgent,
  verifyAgentSignature,
  deriveSecretFromSignature,
  getKeyAlgorithm,
  KEY_DERIVATION_MESSAGE,
} from './smartcard/SmartcardSyncService';
import { encryptSecretValue, decryptSecretValue, isEncryptionAvailable } from './crypto/SecretFieldCrypto';
import { XServerManager } from './x11/XServerManager';
import type { SearchStartOptions } from '../shared/types/search';
import {
  IPC_CHANNELS,
  type StorageConnectConfig,
  type HostKeyPromptEvent,
  type PresencePromptEvent,
  type PresenceClearEvent,
  type TransferConflictPromptEvent,
  type TransferConflictResolution,
  type AwsSsoPromptEvent,
  type DirSyncComputeDiffOptions,
  type DirSyncApplyOptions,
  type AskpassPromptKind,
} from '../shared/types/ipc';
import type { DirectoryDiffResult, DirectorySyncApplyResult, DirectorySyncProfile } from '../shared/types/dirsync';
import type {
  K8sClusterNode,
  K8sNamespaceNode,
  K8sPodNode,
  K8sTerminalTarget,
  K8sPodDescription,
  K8sPortForwardTarget,
  K8sActivePortForward,
  K8sDebugTarget,
  K8sLoginOptions,
  K8sLoginResult,
} from '../shared/types/kubernetes';
import type { AwsSsoAccount, AwsSsoAccountRole, AwsSsoLoginResult } from '../shared/types/aws';
import type { DotfilePool, DotfilesSyncPromptEvent, DotfilesSyncResolution } from '../shared/types/dotfiles';
import type {
  SSHConnectionConfig,
  PtyOptions,
  SSHPtyExitEvent,
  CachedSmartcardAgent,
  GenerateFido2KeyRequest,
  GeneratedFido2Key,
  Fido2ResidentKey,
} from '../shared/types/ssh';
import type {
  FileEntry,
  ObjectMetadata,
  TransferProgress,
  S3Config,
  S3Tag,
  BucketVersioningInfo,
  ObjectVersionEntry,
  SFTPConfig,
  StorageType,
} from '../shared/types/storage';
import type { SessionData } from '../shared/types/session';
import type { AppSettings } from '../shared/types/settings';
import type { ProfileSyncStatus, ProfileSyncPullResult, SyncComparisonResult } from '../shared/types/sync';

const execFileAsync = promisify(execFile);

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

interface PendingDotfilesSyncPrompt {
  callback: (resolution: DotfilesSyncResolution) => void;
}

interface PendingAwsSsoLogin {
  cancel: () => void;
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
  dotfilePoolStore?: DotfilePoolStore;
  dotfileSyncService?: DotfileSyncService;
  directorySyncProfileStore?: DirectorySyncProfileStore;
  fileEditorService?: FileEditorService;
  fileTailService?: FileTailService;
  searchOrchestrator?: SearchOrchestrator;
  awsSsoAuthService?: AwsSsoAuthService;
  syncConfigStore?: SyncConfigStore;
  syncCryptoService?: SyncCryptoService;
  profileSyncService?: ProfileSyncService;
  k8sDiscoveryService?: K8sDiscoveryService;
  k8sDebugService?: K8sDebugService;
  k8sTerminalManager?: K8sTerminalManager;
  k8sLogManager?: K8sLogManager;
  k8sPortForwardManager?: K8sPortForwardManager;
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
  public readonly dotfilePoolStore: DotfilePoolStore;
  public readonly dotfileSyncService: DotfileSyncService;
  public readonly directorySyncProfileStore: DirectorySyncProfileStore;
  public readonly fileEditorService: FileEditorService;
  public readonly fileTailService: FileTailService;
  public readonly searchOrchestrator: SearchOrchestrator;
  public readonly awsSsoAuthService: AwsSsoAuthService;
  public readonly syncConfigStore: SyncConfigStore;
  public readonly syncCryptoService: SyncCryptoService;
  public readonly profileSyncService: ProfileSyncService;
  public readonly k8sDiscoveryService: K8sDiscoveryService;
  public readonly k8sDebugService: K8sDebugService;
  public readonly k8sTerminalManager: K8sTerminalManager;
  public readonly k8sLogManager: K8sLogManager;
  public readonly k8sPortForwardManager: K8sPortForwardManager;
  private getWebContents: () => Electron.WebContents | null | undefined;

  private pendingAskpass = new Map<string, PendingAskpassPrompt>();
  private pendingHostKeyPrompts = new Map<string, PendingHostKeyPrompt>();
  private pendingTransferConflicts = new Map<string, PendingTransferConflictPrompt>();
  private pendingDotfilesSyncPrompts = new Map<string, PendingDotfilesSyncPrompt>();
  private pendingAwsSsoLogins = new Map<string, PendingAwsSsoLogin>();
  private handlers = new Set<string>();
  /** sessionId -> the private ssh-agent pre-loaded with a smartcard for 'agent-per-session' mode. */
  private smartcardSessionAgents = new Map<
    string,
    { pid: number; socketPath: string } & (
      | { kind: 'pkcs11'; pkcs11LibPath: string }
      | { kind: 'fido2'; askpassServer?: AskpassServer }
    )
  >();
  /** pkcs11LibPath or '__fido2__' -> the app-lifetime shared agent for 'agent-global' mode, keyed per smartcard library/fido2 so multiple different cards can each be cached independently. */
  private globalSmartcardAgents = new Map<string, { pid: number; socketPath: string; askpassServer?: AskpassServer }>();
  /** pkcs11LibPath or '__fido2__' -> in-flight load, so concurrent connections to the same card don't each spawn their own agent and prompt separately. */
  private globalSmartcardAgentLoads = new Map<string, Promise<{ pid: number; socketPath: string; askpassServer?: AskpassServer }>>();
  private globalSmartcardAgentFailures = new Map<string, number>();
  private startupUnlockPromise?: Promise<void>;
  /**
   * pkcs11LibPath -> certificate details read once, right after the card is loaded into its
   * global agent, instead of on every "cached smartcard identities" dropdown open. Re-reading on
   * every open meant opening a fresh PKCS#11 session against the token on every click, which can
   * race the already-live ssh-agent session for the same module — some PKCS#11 providers (e.g.
   * Net iD) handle that contention far worse than others and have been observed to crash the
   * whole process instead of returning a clean error. Reading once, right after `ssh-add -s`
   * already proved the card is present and responsive, avoids that race entirely.
   */
  private globalSmartcardCerts = new Map<string, Map<string, SmartcardCertificateDetails>>();
  private autoSyncTimer: NodeJS.Timeout | null = null;
  private autoPullTimer: NodeJS.Timeout | null = null;
  private lastSmartcardAutoUnlockAttempt = 0;
  private static readonly AUTO_PULL_INTERVAL_MS = 10 * 60 * 1000;
  private static readonly SMARTCARD_AUTO_UNLOCK_COOLDOWN_MS = 5 * 60 * 1000;
  private activePresenceSessions = new Set<string>();

  // Event listener references for clean teardown
  private onPtyData?: (event: { sessionId: string; data: string }) => void;
  private onPtyExit?: (event: { sessionId: string; exitCode: number; signal?: number }) => void;
  private onPtyAskpass?: (event: {
    sessionId: string;
    prompt: string;
    kind?: AskpassPromptKind;
    context?: string;
    callback: (pin: string) => void;
  }) => void;
  private onTransferProgress?: (progress: TransferProgress) => void;
  private onK8sTerminalData?: (event: { sessionId: string; data: string }) => void;
  private onK8sTerminalExit?: (event: { sessionId: string; status: string }) => void;
  private onK8sLogData?: (event: { sessionId: string; data: string }) => void;
  private onK8sLogEnd?: (event: { sessionId: string }) => void;
  private onK8sPortForwardChange?: (list: K8sActivePortForward[]) => void;
  private onK8sConfigChanged?: () => void;
  private unsubscribeK8sConfig?: () => void;

  constructor(options: IpcBridgeOptions = {}) {
    this.ipcMain = options.ipcMain ?? electronIpcMain;
    this.settingsStore = options.settingsStore ?? new SettingsStore();
    this.sshPtyManager = options.sshPtyManager ?? new SSHPtyManager({ settingsStore: this.settingsStore });
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
    this.dotfilePoolStore = options.dotfilePoolStore ?? new DotfilePoolStore();
    this.dotfileSyncService = options.dotfileSyncService ?? new DotfileSyncService();
    this.directorySyncProfileStore = options.directorySyncProfileStore ?? new DirectorySyncProfileStore();
    this.fileEditorService = options.fileEditorService ?? new FileEditorService();
    this.fileTailService = options.fileTailService ?? new FileTailService();
    this.searchOrchestrator = options.searchOrchestrator ?? new SearchOrchestrator();
    this.awsSsoAuthService = options.awsSsoAuthService ?? new AwsSsoAuthService();
    this.syncConfigStore = options.syncConfigStore ?? new SyncConfigStore();
    this.syncCryptoService = options.syncCryptoService ?? new SyncCryptoService();
    this.profileSyncService =
      options.profileSyncService ??
      new ProfileSyncService(this.profileStore, this.dotfilePoolStore, this.settingsStore, this.syncCryptoService);
    this.k8sDiscoveryService = options.k8sDiscoveryService ?? new K8sDiscoveryService();
    this.k8sDebugService = options.k8sDebugService ?? new K8sDebugService();
    this.k8sTerminalManager = options.k8sTerminalManager ?? new K8sTerminalManager();
    this.k8sLogManager = options.k8sLogManager ?? new K8sLogManager();
    this.k8sPortForwardManager = options.k8sPortForwardManager ?? new K8sPortForwardManager();
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
    this.registerDotfileHandlers();
    this.registerSessionHandlers();
    this.registerSettingsHandlers();
    this.registerSyncHandlers();
    void this.syncConfigStore
      .getConfig()
      .then((config) => {
        if (config.autoSync && config.target) {
          this.startAutoPullTimer();
        }
      })
      .catch(() => {});
    this.registerConnectionTestHandlers();
    this.registerAwsSsoHandlers();
    this.registerFileEditorHandlers();
    this.registerSearchHandlers();
    this.registerGeneralHandlers();
    this.registerDirSyncHandlers();
    this.registerK8sHandlers();
    this.setupEventListeners();

    if (process.platform === 'win32') {
      void this.settingsStore
        .getSettings()
        .then((settings) => {
          if (settings.x11ServerMode === 'always') {
            void XServerManager.ensureRunning({
              customPath: settings.x11ServerPath,
              customArgs: settings.x11ServerArgs,
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }
  }

  private registerHandler(channel: string, handler: (...args: any[]) => any): void {
    this.ipcMain.handle(channel, handler);
    this.handlers.add(channel);
  }

  private registerTerminalHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.TERMINAL_CREATE,
      async (
        _event,
        options: { config?: SSHConnectionConfig; local?: boolean; ptyOptions?: PtyOptions }
      ) => {
        if (!options || (!options.config && !options.local)) {
          throw new Error('Connection config is required to create terminal');
        }

        if (this.startupUnlockPromise) {
          try {
            await this.startupUnlockPromise;
          } catch {
            // Ignore error; terminal session proceeds and prompts if needed
          }
        }

        let config = options.config;
        if (!options.local && config) {
          config = await this.prepareSmartcardConfig(config);
          config = await this.prepareFido2Config(config);

          if (config.x11Forwarding && process.platform === 'win32') {
            try {
              const settings = await this.settingsStore.getSettings();
              if (settings.x11ServerMode !== 'manual') {
                await XServerManager.ensureRunning({
                  customPath: settings.x11ServerPath,
                  customArgs: settings.x11ServerArgs,
                  display: config.x11Display,
                });
              }
            } catch {
              // Ignore failure to launch X server; SSH will still connect
            }
          }
        }

        let ptyOptions = options.ptyOptions;
        if (options.local) {
          // Point a local shell at whichever smartcard is currently cached under
          // 'agent-global' PIN caching, so a plain `ssh`/`ssh-add` typed by hand
          // there can use the card without asking for the PIN again — matching
          // the "shared by every terminal and profile using it" promise of that
          // mode. Falls through to SSHPtyManager's own AgentLifecycleManager
          // fallback when no card is cached; an explicit caller-supplied
          // env.SSH_AUTH_SOCK (none today) would still win over both.
          const globalAgentSocket = this.globalSmartcardAgents.values().next().value?.socketPath;
          if (globalAgentSocket) {
            ptyOptions = { ...ptyOptions, env: { SSH_AUTH_SOCK: globalAgentSocket, ...ptyOptions?.env } };
          }
        }

        const session = options.local
          ? await this.sshPtyManager.createShellSession(ptyOptions)
          : await this.sshPtyManager.createSession(config!, ptyOptions);

        if (!options.local && config) {
          // Fire-and-forget: never let the dotfiles check delay or fail the
          // terminal session itself, and give the PTY a moment to become
          // interactive before a second connection competes for the network.
          const resolvedConfig = config;
          const sessionId = session.sessionId;
          setTimeout(() => {
            void this.runDotfilesSyncCheck(sessionId, resolvedConfig).catch(() => {});
          }, 1500);
        }

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

    this.registerHandler(
      IPC_CHANNELS.TERMINAL_RECONNECT,
      async (_event, sessionId: string) => {
        const session = this.sshPtyManager.getSession(sessionId);
        if (session && session.reconnect) {
          return await session.reconnect();
        }
        return false;
      }
    );
  }

  private registerSmartcardHandlers(): void {
    this.registerHandler(IPC_CHANNELS.SMARTCARD_DETECT, async () => {
      return await SmartcardDetector.detectAvailableLibraries(undefined, { onlyExisting: true });
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

    this.registerHandler(IPC_CHANNELS.SMARTCARD_LOCK_ALL, async () => {
      return { locked: this.lockAllGlobalSmartcardAgents() };
    });

    this.registerHandler(IPC_CHANNELS.SMARTCARD_LIST_CACHED, async () => {
      return this.listGlobalSmartcardAgents();
    });

    this.registerHandler(IPC_CHANNELS.SMARTCARD_UNLOCK_AT_STARTUP, async () => {
      return this.maybeUnlockSmartcardAtStartup();
    });

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

    this.registerHandler(
      IPC_CHANNELS.FIDO2_GENERATE_KEY,
      async (_event, options: GenerateFido2KeyRequest): Promise<GeneratedFido2Key> => {
        const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
          undefined,
          'Touch your security key to authorize the new SSH key'
        );
        return generateFido2Key({
          ...options,
          promptHandler: (prompt) => this.promptForPinDirect(prompt, 'fido2'),
          onPresenceRequested,
          onPresenceCleared,
        });
      }
    );

    this.registerHandler(
      IPC_CHANNELS.FIDO2_LIST_RESIDENT_KEYS,
      async (): Promise<Fido2ResidentKey[]> => {
        const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
          undefined,
          'Touch your security key to read its stored SSH keys'
        );
        return listFido2ResidentKeys(
          (prompt) => this.promptForPinDirect(prompt, 'fido2'),
          { onPresenceRequested, onPresenceCleared }
        );
      }
    );

    this.registerHandler(
      IPC_CHANNELS.FIDO2_DELETE_RESIDENT_KEY,
      async (_event, credentialId: string): Promise<void> => {
        return deleteFido2ResidentKey(credentialId, (prompt) => this.promptForPinDirect(prompt, 'fido2'));
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
   * Directly prompts the user for a PIN (e.g. during sync unlock/link, or a
   * FIDO2 key generation/discovery flow) via the standard Askpass modal in
   * the renderer. `kind` lets the modal label itself as FIDO2/security key
   * vs PIV/smartcard rather than showing generic wording — pass it whenever
   * the caller knows which credential this PIN belongs to.
   */
  public promptForPinDirect(
    prompt = 'Enter smartcard PIN:',
    kind?: AskpassPromptKind,
    context?: string
  ): Promise<string> {
    return new Promise((resolve) => {
      const webContents = this.getWebContents();
      if (!webContents || webContents.isDestroyed?.()) {
        resolve('');
        return;
      }

      const id = crypto.randomUUID();
      this.pendingAskpass.set(id, { callback: resolve });
      webContents.send(IPC_CHANNELS.ASKPASS_PROMPT, { id, prompt, kind, context });
    });
  }

  /**
   * Loads a PKCS#11 module into a private ssh-agent (see
   * `loadSmartcardIntoPrivateAgent`), additionally surfacing a
   * "touch your key" banner in the renderer for as long as the underlying
   * `ssh-add -s` looks like it's blocked waiting for a physical touch.
   * Every IpcBridge call site that spawns a private smartcard agent should
   * go through this instead of calling `loadSmartcardIntoPrivateAgent`
   * directly, so the banner appears consistently regardless of which flow
   * (interactive connect, background sync, vault unlock/link) triggered it.
   */
  private loadSmartcardIntoPrivateAgentWithPresence(
    pkcs11LibPath: string,
    promptHandler: AskpassPromptHandler,
    sessionId?: string
  ): ReturnType<typeof loadSmartcardIntoPrivateAgent> {
    const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
      sessionId,
      'Touch your YubiKey / smartcard to confirm'
    );
    return loadSmartcardIntoPrivateAgent(pkcs11LibPath, promptHandler, { onPresenceRequested, onPresenceCleared });
  }

  /**
   * Builds a fresh (id-scoped) pair of onPresenceRequested/onPresenceCleared
   * callbacks that surface a "touch your key" banner in the renderer,
   * shared by every flow that spawns a private agent for a physical
   * key/card — PIV smartcards (`loadSmartcardIntoPrivateAgentWithPresence`)
   * and FIDO2 resident-key discovery/generation alike.
   */
  private makePresenceNotifier(
    sessionId: string | undefined,
    message: string
  ): { onPresenceRequested: () => void; onPresenceCleared: () => void } {
    const id = crypto.randomUUID();
    return {
      onPresenceRequested: () => {
        if (sessionId) {
          this.activePresenceSessions.add(sessionId);
        }
        const webContents = this.getWebContents();
        if (!webContents || webContents.isDestroyed?.()) return;
        const event: PresencePromptEvent = { id, sessionId, message };
        webContents.send(IPC_CHANNELS.PRESENCE_PROMPT, event);
      },
      onPresenceCleared: () => {
        if (sessionId) {
          this.activePresenceSessions.delete(sessionId);
        }
        const webContents = this.getWebContents();
        if (!webContents || webContents.isDestroyed?.()) return;
        const event: PresenceClearEvent = { id, sessionId };
        webContents.send(IPC_CHANNELS.PRESENCE_CLEAR, event);
      },
    };
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
        let resolvedConfig = config;
        if (config.type === 'sftp' && this.startupUnlockPromise) {
          try {
            await this.startupUnlockPromise;
          } catch {
            // Ignore startup unlock errors during background connect
          }
        }
        if (config.type === 'sftp' && config.sftpConfig && !this.storageRegistry.has(config.id)) {
          let sftpConfig = await this.prepareSftpSmartcardConfig(config.sftpConfig, config.id);
          sftpConfig = await this.prepareFido2SftpConfig(sftpConfig, config.id);
          resolvedConfig = { ...config, sftpConfig };
        }
        await this.storageRegistry.getOrCreate(resolvedConfig);
        return { id: config.id };
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_DISCONNECT,
      async (_event, providerId: string) => {
        await this.storageRegistry.disconnect(providerId);
        this.cleanupSmartcardSessionAgent(providerId);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.STORAGE_LIST,
      async (_event, providerId: string, remotePath: string, force?: boolean): Promise<FileEntry[]> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        return await (provider as any).list(remotePath, { force });
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

    this.registerHandler(
      IPC_CHANNELS.STORAGE_GET_PRESIGNED_URL,
      async (_event, providerId: string, remotePath: string, expiresInSeconds: number): Promise<string> => {
        const provider = this.requireS3Capability(providerId, 'getPresignedUrl');
        return await provider.getPresignedUrl!(remotePath, expiresInSeconds);
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

    this.registerHandler(
      IPC_CHANNELS.START_DRAG,
      async (event, options: { file: string; icon?: string }) => {
        try {
          const webContents = event.sender || this.getWebContents();
          if (webContents && typeof (webContents as any).startDrag === 'function') {
            const iconPath = options.icon || path.join(__dirname, '../build/icons/32x32.png');
            (webContents as any).startDrag({
              file: options.file,
              icon: iconPath,
            });
          }
        } catch (err) {
          console.error('Failed to start native drag:', err);
        }
      }
    );
  }

  private registerProfileHandlers(): void {
    this.registerHandler(IPC_CHANNELS.PROFILES_GET, async () => {
      return await this.profileStore.getProfiles();
    });

    this.registerHandler(
      IPC_CHANNELS.PROFILES_SAVE_SSH,
      async (_event, config: SSHConnectionConfig) => {
        await this.profileStore.saveSSH(config);
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_DELETE_SSH,
      async (_event, id: string) => {
        await this.profileStore.deleteSSH(id);
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_SAVE_S3,
      async (_event, config: S3Config) => {
        await this.profileStore.saveS3(config);
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_DELETE_S3,
      async (_event, id: string) => {
        await this.profileStore.deleteS3(id);
        this.scheduleAutoSync();
      }
    );
  }

  private registerDotfileHandlers(): void {
    this.registerHandler(IPC_CHANNELS.DOTFILES_POOLS_GET, async (): Promise<DotfilePool[]> => {
      return await this.dotfilePoolStore.getPools();
    });

    this.registerHandler(IPC_CHANNELS.DOTFILES_POOLS_SAVE, async (_event, pool: DotfilePool) => {
      await this.dotfilePoolStore.savePool(pool);
      this.scheduleAutoSync();
    });

    this.registerHandler(IPC_CHANNELS.DOTFILES_POOLS_DELETE, async (_event, id: string) => {
      await this.dotfilePoolStore.deletePool(id);
      this.scheduleAutoSync();
    });

    this.registerHandler(IPC_CHANNELS.DOTFILES_OPEN_FOLDER, async (_event, poolId: string) => {
      return await this.dotfilePoolStore.openPoolFolder(poolId);
    });

    this.registerHandler(IPC_CHANNELS.DOTFILES_SELECT_FILES, async () => {
      const result = await electronDialog.showOpenDialog({
        title: 'Select dotfiles / master files',
        properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return [];
      }
      const imported = await this.dotfilePoolStore.importLocalFiles(result.filePaths);
      this.scheduleAutoSync();
      return imported;
    });

    this.registerHandler(
      IPC_CHANNELS.DOTFILES_ADD_FROM_STORAGE,
      async (
        _event,
        options: {
          poolId: string;
          providerId: string;
          filePath: string;
          targetRemotePath?: string;
        }
      ) => {
        const provider = this.storageRegistry.get(options.providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${options.providerId}`);
        }
        const stream = await provider.createReadStream(options.filePath);
        const chunks: Buffer[] = [];
        const content = await new Promise<string>((resolve, reject) => {
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          stream.on('error', reject);
        });

        let mode: string | undefined;
        try {
          const stat = await provider.stat(options.filePath);
          if (stat.permissions) {
            mode = stat.permissions;
          }
        } catch {
          // Ignore stat error
        }

        const baseName = path.posix.basename(options.filePath);
        const remotePath =
          options.targetRemotePath || (baseName.startsWith('.') ? `~/${baseName}` : `~/.${baseName}`);

        const added = await this.dotfilePoolStore.addFileToPool(options.poolId, {
          remotePath,
          content,
          mode,
        });
        this.scheduleAutoSync();
        return added;
      }
    );

    this.registerHandler(
      IPC_CHANNELS.DOTFILES_SYNC_RESPOND,
      async (_event, id: string, resolution: DotfilesSyncResolution) => {
        const prompt = this.pendingDotfilesSyncPrompts.get(id);
        if (!prompt) {
          throw new Error(`Dotfiles sync prompt with id "${id}" not found or expired`);
        }
        this.pendingDotfilesSyncPrompts.delete(id);
        prompt.callback(resolution);
      }
    );
  }

  /**
   * Resolves the effective smartcard PIN-caching mode (profile override, else
   * the global default) and stamps it onto the config so downstream code
   * (SSHPtyManager, the dotfiles-sync scheduling above) can act on it without
   * each needing their own settings lookup. A no-op for non-smartcard auth.
   */
  /**
   * For smartcard profiles in 'agent-per-session' mode, loads the card into
   * a private ssh-agent *before* the PTY is spawned (prompting for the PIN
   * once via the normal askpass UI), and returns a config pointing the PTY
   * at that agent via IdentityAgent instead of a direct -I login.
   *
   * This sequencing matters: PIV/PKCS#11 readers generally only support one
   * active transaction at a time, so if the PTY's own -I login and a
   * separately-loaded agent both talk to the card around the same moment,
   * they can collide and both fail. Loading the agent first and having the
   * PTY authenticate purely through it means only one process ever opens a
   * PKCS#11 session for a given connection.
   *
   * If loading the agent fails, this is a no-op — the PTY falls back to its
   * own direct -I login, and dotfiles sync (if any) prompts for its own PIN
   * independently.
   *
   * 'always-prompt' also goes through the per-session agent (see
   * resolveSmartcardAgentPath), on every platform: OpenSSH's
   * ssh-pkcs11-helper subprocess doesn't reliably route its PIN prompt
   * through our askpass server the way the plain account-password prompt
   * does, so a direct -I login can silently fall through to password auth
   * instead of ever asking for the card's PIN (observed on both Win32-OpenSSH
   * and Linux OpenSSH — ssh-pkcs11-helper doesn't trust our askpass chain
   * either way). Loading through ssh-add (which runs headless, with no
   * console, so askpass is used unconditionally) sidesteps that, while still
   * discarding the card the moment the session ends — a reconnect still
   * needs a fresh PIN, keeping 'always-prompt's "ask every time" contract.
   */
  private async prepareSmartcardConfig(config: SSHConnectionConfig): Promise<SSHConnectionConfig> {
    if (config.authType !== 'smartcard' || !config.pkcs11LibPath || config.agentPath) {
      return config;
    }

    // Pin the session id now so the askpass prompt below and the eventual
    // PTY session correlate to the same id.
    const sessionId = config.id || `ssh-${crypto.randomUUID()}`;
    const configWithId = { ...config, id: sessionId };

    const agentPath = await this.resolveSmartcardAgentPath(
      config.pkcs11LibPath,
      sessionId,
      `connect via SSH to ${config.name || config.host}`
    );
    return agentPath ? { ...configWithId, agentPath } : configWithId;
  }

  /**
   * For 'fido2' profiles using a discoverable/resident credential (no
   * privateKeyPath), loads every resident credential on the connected
   * security key into a private ssh-agent *before* the PTY is spawned, same
   * rationale as prepareSmartcardConfig: only one process should ever open a
   * session against the physical key at a time, and the PTY then just points
   * at that agent via IdentityAgent instead of needing a key file on disk.
   *
   * Always spawns a fresh private agent per session (no 'agent-global'-style
   * caching, unlike PIV) — resident FIDO2 credentials are rarer and the
   * caching machinery in resolveSmartcardAgentPath is keyed by PKCS#11
   * library path, which doesn't apply here. A follow-up can add caching if
   * repeated per-connection touches turn out to be annoying in practice.
   *
   * A non-resident 'fido2' profile (privateKeyPath set) is a no-op here —
   * OpenSSH's own `-i` handling already deals with `-sk` key files natively.
   */
  private async prepareFido2Config(config: SSHConnectionConfig): Promise<SSHConnectionConfig> {
    if (config.authType !== 'fido2' || !config.fido2Resident || config.agentPath) {
      return config;
    }

    const sessionId = config.id || `ssh-${crypto.randomUUID()}`;
    const configWithId = { ...config, id: sessionId };

    const agentPath = await this.resolveFido2AgentPath(
      sessionId,
      `connecting to ${config.name || config.host}`,
      'pty'
    );
    return agentPath ? { ...configWithId, agentPath } : configWithId;
  }

  /**
   * Same agent-caching logic as prepareSmartcardConfig, applied to an SFTP connection (used by
   * the file manager's own STORAGE_CONNECT, which — unlike terminals — never went through
   * prepareSmartcardConfig, so it always spawned its own ephemeral PKCS#11 agent even when a
   * terminal already held the card open under 'agent-global'/'agent-per-session' mode. Spawning a
   * second, independent PKCS#11 session against the same physical reader collides with the one
   * already open ("agent refused operation"), since most PIV/CAC readers allow only one
   * transaction at a time.
   */
  private async prepareSftpSmartcardConfig(config: SFTPConfig, providerId: string): Promise<SFTPConfig> {
    if (config.authType !== 'smartcard' || !config.pkcs11LibPath || config.agentPath) {
      return config;
    }

    // Keyed by providerId so a matching STORAGE_DISCONNECT can tear down the
    // same 'agent-per-session' agent this connection loaded.
    const agentPath = await this.resolveSmartcardAgentPath(
      config.pkcs11LibPath,
      providerId,
      `connect via SFTP to ${config.name || config.host}`
    );
    return agentPath ? { ...config, agentPath } : config;
  }

  /** Same rationale as prepareFido2Config, applied to an SFTP connection (see prepareSftpSmartcardConfig). */
  private async prepareFido2SftpConfig(config: SFTPConfig, providerId: string): Promise<SFTPConfig> {
    if (config.authType !== 'fido2' || !config.fido2Resident || config.agentPath) {
      return config;
    }

    const agentPath = await this.resolveFido2AgentPath(
      providerId,
      `connecting via SFTP to ${config.name || config.host}`,
      'direct'
    );
    return agentPath ? { ...config, agentPath } : config;
  }

  /**
   * Resolves (loading it if necessary) the ssh-agent socket to use for FIDO2 resident keys,
   * per the user's Settings > Security & Smartcard > Smartcard & Security Key PIN Caching mode.
   */
  private async resolveFido2AgentPath(
    sessionId: string,
    promptLabel: string,
    pinPromptKind: 'pty' | 'direct' = 'pty'
  ): Promise<string | undefined> {
    const settings = await this.settingsStore.getSettings();
    const mode = settings.smartcardAuthMode ?? 'always-prompt';

    if (mode === 'agent-global') {
      try {
        return await this.getOrLoadGlobalFido2Agent(sessionId, promptLabel, pinPromptKind);
      } catch (err) {
        console.warn(
          'IpcBridge: failed to load FIDO2 resident keys into the global agent, falling back to per-connection prompts:',
          err
        );
        return undefined;
      }
    }

    if (mode !== 'agent-per-session' && mode !== 'always-prompt') {
      return undefined;
    }

    console.log(`[fido2] resolveFido2AgentPath: starting shared-agent preload for session ${sessionId}`);
    const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
      sessionId,
      'Touch your security key to connect'
    );
    try {
      const promptPin = (rawPrompt: string) =>
        pinPromptKind === 'direct'
          ? this.promptForPinDirect(rawPrompt.trim(), 'fido2', promptLabel)
          : this.sshPtyManager.promptForPin(sessionId, rawPrompt.trim(), 'fido2', promptLabel);

      const { pid, socketPath, askpassServer } = await loadFido2ResidentKeysIntoPrivateAgent(
        promptPin,
        { onPresenceRequested, onPresenceCleared, keepAskpassAliveForAgentLifetime: true }
      );
      this.smartcardSessionAgents.set(sessionId, { pid, socketPath, kind: 'fido2', askpassServer });
      return socketPath;
    } catch (err) {
      console.warn('IpcBridge: failed to load FIDO2 resident keys into a private session agent:', err);
      return undefined;
    }
  }

  /**
   * Returns the socket path for the app-lifetime shared agent holding FIDO2 resident credentials,
   * loading it (prompting for the PIN once) if it isn't already cached. Concurrent callers share
   * the same in-flight load rather than each spawning their own agent.
   */
  private async getOrLoadGlobalFido2Agent(
    sessionId: string,
    promptLabel: string,
    pinPromptKind: 'pty' | 'direct' = 'pty'
  ): Promise<string> {
    const cached = this.globalSmartcardAgents.get('__fido2__');
    if (cached) {
      console.log('[fido2] getOrLoadGlobalFido2Agent: reusing cached global agent');
      return cached.socketPath;
    }

    const lastFailedAt = this.globalSmartcardAgentFailures.get('__fido2__');
    if (lastFailedAt && Date.now() - lastFailedAt < 30000) {
      console.log('[fido2] getOrLoadGlobalFido2Agent: skipping load (failed recently)');
      throw new Error('FIDO2 agent load failed recently; cooling down');
    }

    const inFlight = this.globalSmartcardAgentLoads.get('__fido2__');
    if (inFlight) {
      console.log('[fido2] getOrLoadGlobalFido2Agent: awaiting in-flight load');
      const { socketPath } = await inFlight;
      return socketPath;
    }

    console.log('[fido2] getOrLoadGlobalFido2Agent: loading global agent for FIDO2');
    const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
      sessionId,
      'Touch your security key to connect'
    );

    const promptPin = (rawPrompt: string) =>
      pinPromptKind === 'direct'
        ? this.promptForPinDirect(rawPrompt.trim(), 'fido2', promptLabel)
        : this.sshPtyManager.promptForPin(sessionId, rawPrompt.trim(), 'fido2', promptLabel);

    const loadPromise = loadFido2ResidentKeysIntoPrivateAgent(
      promptPin,
      { onPresenceRequested, onPresenceCleared, keepAskpassAliveForAgentLifetime: true }
    );
    this.globalSmartcardAgentLoads.set('__fido2__', loadPromise);

    try {
      const result = await loadPromise;
      this.globalSmartcardAgentFailures.delete('__fido2__');
      this.globalSmartcardAgents.set('__fido2__', result);
      console.log(
        `[fido2] getOrLoadGlobalFido2Agent: loaded OK, pid=${result.pid}, socket=${result.socketPath}`
      );
      return result.socketPath;
    } catch (err) {
      this.globalSmartcardAgentFailures.set('__fido2__', Date.now());
      throw err;
    } finally {
      this.globalSmartcardAgentLoads.delete('__fido2__');
    }
  }

  /**
   * Resolves (loading it if necessary) the ssh-agent socket to use for a PKCS#11 library, per the
   * user's Settings > Security > Smartcard PIN Caching mode. Returns undefined only if loading the
   * agent fails — callers should then fall back to a direct `-I` login (SSH) or their own ephemeral
   * agent (SFTP), which still prompts for the PIN on its own.
   */
  private async resolveSmartcardAgentPath(
    pkcs11LibPath: string,
    sessionId: string,
    promptLabel: string
  ): Promise<string | undefined> {
    const settings = await this.settingsStore.getSettings();
    const mode = settings.smartcardAuthMode ?? 'always-prompt';

    if (mode === 'agent-global') {
      try {
        return await this.getOrLoadGlobalSmartcardAgent(pkcs11LibPath, sessionId, promptLabel);
      } catch (err) {
        console.warn(
          'IpcBridge: failed to load smartcard into the global agent, falling back to per-connection prompts:',
          err
        );
        return undefined;
      }
    }

    // 'always-prompt' is routed through the same per-session agent as 'agent-per-session' on
    // every platform — see the doc comment on prepareSmartcardConfig for why a direct -I login
    // can't reliably prompt for the card's PIN via ssh-pkcs11-helper. It's still discarded at
    // session end (never cached across connections), so 'always-prompt's "ask every time"
    // contract is unchanged — only *how* the PIN is collected differs from a direct -I login.
    if (mode !== 'agent-per-session' && mode !== 'always-prompt') {
      return undefined;
    }

    console.log(`[smartcard] resolveSmartcardAgentPath: starting shared-agent preload for session ${sessionId}`);
    try {
      const { pid, socketPath } = await this.loadSmartcardIntoPrivateAgentWithPresence(
        pkcs11LibPath,
        () => this.sshPtyManager.promptForPin(sessionId, `Enter your smartcard PIN to ${promptLabel}:`, 'smartcard', promptLabel),
        sessionId
      );
      console.log(
        `[smartcard] resolveSmartcardAgentPath: shared agent loaded OK for session ${sessionId}, pid=${pid}, socket=${socketPath}`
      );
      this.smartcardSessionAgents.set(sessionId, { pid, socketPath, kind: 'pkcs11', pkcs11LibPath });
      return socketPath;
    } catch (err) {
      console.warn(
        'IpcBridge: failed to load smartcard into a private session agent, falling back to per-connection prompts:',
        err
      );
      return undefined;
    }
  }

  /**
   * Returns the socket path for the app-lifetime shared agent holding the
   * given PKCS#11 library, loading it (prompting for the PIN once) if it
   * isn't already cached. Concurrent callers for the same library share the
   * same in-flight load rather than each spawning their own agent.
   */
  private async getOrLoadGlobalSmartcardAgent(
    pkcs11LibPath: string,
    sessionIdOrPinPrompt: string | (() => Promise<string>),
    promptLabel?: string
  ): Promise<string> {
    const cached = this.globalSmartcardAgents.get(pkcs11LibPath);
    if (cached) {
      console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: reusing cached global agent for ${pkcs11LibPath}`);
      return cached.socketPath;
    }

    const lastFailedAt = this.globalSmartcardAgentFailures.get(pkcs11LibPath);
    if (lastFailedAt && Date.now() - lastFailedAt < 30000) {
      console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: skipping load for ${pkcs11LibPath} (failed recently)`);
      throw new Error(`Smartcard load for ${pkcs11LibPath} failed recently; cooling down`);
    }

    const inFlight = this.globalSmartcardAgentLoads.get(pkcs11LibPath);
    if (inFlight) {
      console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: awaiting in-flight load for ${pkcs11LibPath}`);
      const { socketPath } = await inFlight;
      return socketPath;
    }

    console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: loading global agent for ${pkcs11LibPath}`);
    const pinHandler =
      typeof sessionIdOrPinPrompt === 'function'
        ? sessionIdOrPinPrompt
        : () =>
            this.sshPtyManager.promptForPin(
              sessionIdOrPinPrompt,
              `Enter your smartcard PIN to ${promptLabel}:`,
              'smartcard',
              promptLabel
            );

    const loadPromise = (async () => {
      // Read the certificate details *before* handing the module to `ssh-add -s` below (see
      // the doc comment on `globalSmartcardCerts` for why we want them at all). This must run
      // strictly before, not concurrently with or fire-and-forget after: once `ssh-add -s`
      // succeeds, the private agent process keeps the PKCS#11 module initialized and the token
      // open for as long as the agent lives, and opening a second, independent PKCS#11 session
      // against the same physical token from this (separate) process while that first one is
      // live crashed the vendor's Net iD module outright (SIGTRAP inside the driver, observed
      // right at startup's auto-unlock). No PIN/session is needed to read certs (they're public
      // objects, see readSmartcardCertificates' doc comment), so doing this first is safe and
      // guarantees we're never more than one process talking to the token at a time.
      try {
        const certs = await readSmartcardCertificates(pkcs11LibPath);
        this.globalSmartcardCerts.set(pkcs11LibPath, certs);
      } catch (err) {
        console.warn(`[smartcard] failed to read certificate details for ${pkcs11LibPath}:`, err);
      }
      return this.loadSmartcardIntoPrivateAgentWithPresence(
        pkcs11LibPath,
        pinHandler,
        typeof sessionIdOrPinPrompt === 'string' ? sessionIdOrPinPrompt : undefined
      );
    })();
    this.globalSmartcardAgentLoads.set(pkcs11LibPath, loadPromise);

    try {
      const result = await loadPromise;
      this.globalSmartcardAgentFailures.delete(pkcs11LibPath);
      this.globalSmartcardAgents.set(pkcs11LibPath, result);
      console.log(
        `[smartcard] getOrLoadGlobalSmartcardAgent: loaded OK for ${pkcs11LibPath}, pid=${result.pid}, socket=${result.socketPath}`
      );
      return result.socketPath;
    } catch (err) {
      this.globalSmartcardAgentFailures.set(pkcs11LibPath, Date.now());
      throw err;
    } finally {
      this.globalSmartcardAgentLoads.delete(pkcs11LibPath);
    }
  }

  /**
   * 'agent-global' PIN caching + the opt-in "unlock at startup" setting: prompts
   * for the smartcard PIN and loads it into the app-lifetime agent immediately,
   * instead of waiting for the first connection that needs it — so by the time
   * the user opens their first terminal (SSH or local shell) the card is
   * already usable. Only acts when there's exactly one *unambiguous* card to
   * unlock: if p11-kit (which itself proxies every other registered PKCS#11
   * module — see the README's recommendation to prefer it) is among the
   * detected libraries, it's used regardless of what else was also found,
   * since e.g. p11-kit-proxy.so and opensc-pkcs11.so coexisting on the same
   * system is normal and both ultimately reach the same physical token, not
   * two different cards. Otherwise falls back to "exactly one candidate";
   * with zero or several non-p11-kit candidates there's no single card to
   * guess at, so it's left to the normal per-connection flow.
   */
  private paneTreeHasAuthType(node: unknown, authType: string): boolean {
    if (!node || typeof node !== 'object') return false;
    const n = node as Record<string, any>;
    if (n.type === 'leaf') {
      return n.config?.authType === authType;
    }
    if (Array.isArray(n.children)) {
      return n.children.some((child) => this.paneTreeHasAuthType(child, authType));
    }
    return false;
  }

  /**
   * 'agent-global' PIN caching + the opt-in "unlock at startup" setting: prompts
   * for security credentials (FIDO2 resident keys and/or smartcard PIN) and loads them
   * into app-lifetime global agents sequentially before terminal sessions start.
   * Concurrent terminal session restorations await this startup unlock so that
   * multiple connections never race against the physical security key hardware.
   */
  private async maybeUnlockSmartcardAtStartup(): Promise<{ started: boolean }> {
    const settings = await this.settingsStore.getSettings();
    if (!settings.smartcardUnlockAtStartup || (settings.smartcardAuthMode ?? 'always-prompt') !== 'agent-global') {
      return { started: false };
    }

    const libs = await SmartcardDetector.detectAvailableLibraries(undefined, { onlyExisting: true });
    const chosen = libs.find((lib) => lib.name === 'p11-kit') ?? (libs.length === 1 ? libs[0] : undefined);

    let hasFido2 = false;
    let hasSmartcard = Boolean(chosen);
    const targetSmartcardPaths = new Set<string>();

    try {
      const profiles = await this.profileStore.getProfiles();
      if (profiles.ssh?.some((p) => p.authType === 'fido2')) {
        hasFido2 = true;
      }
      for (const p of profiles.ssh ?? []) {
        if (p.authType === 'smartcard') {
          hasSmartcard = true;
          if (p.pkcs11LibPath) {
            targetSmartcardPaths.add(p.pkcs11LibPath);
          }
        }
      }
    } catch {
      // Ignore profile read errors on startup
    }

    try {
      const session = await this.sessionStore.getSession();
      if (session?.tabs) {
        for (const tab of session.tabs) {
          if (this.paneTreeHasAuthType(tab.paneTree, 'fido2')) hasFido2 = true;
          if (this.paneTreeHasAuthType(tab.paneTree, 'smartcard')) hasSmartcard = true;
        }
      }
    } catch {
      // Ignore session read errors on startup
    }

    // Fall back to detected library if smartcard is used but no specific library was saved in profiles
    if (targetSmartcardPaths.size === 0 && chosen) {
      targetSmartcardPaths.add(chosen.path);
    }

    // Filter to only libraries that exist on the system
    const existingLibPaths = new Set(libs.map((l) => l.path));
    const validPathsToUnlock: string[] = [];
    for (const libPath of targetSmartcardPaths) {
      if (existingLibPaths.has(libPath) || (await SmartcardDetector.validateLibraryPath(libPath))) {
        validPathsToUnlock.push(libPath);
      }
    }

    const pathsNeedingUnlock = validPathsToUnlock.filter(
      (p) => !this.globalSmartcardAgents.has(p) && !this.globalSmartcardAgentLoads.has(p)
    );

    if (!hasFido2 && (!hasSmartcard || validPathsToUnlock.length === 0)) {
      return { started: false };
    }

    const fido2Active = this.globalSmartcardAgents.has('__fido2__') || this.globalSmartcardAgentLoads.has('__fido2__');
    const smartcardActive = !hasSmartcard || pathsNeedingUnlock.length === 0;
    if ((!hasFido2 || fido2Active) && smartcardActive) {
      return { started: false };
    }

    const unlockPromise = (async () => {
      // 1. FIDO2 resident keys unlock first (if configured and not yet active)
      if (hasFido2 && !this.globalSmartcardAgents.has('__fido2__') && !this.globalSmartcardAgentLoads.has('__fido2__')) {
        try {
          console.log('[fido2] Startup unlock: loading FIDO2 resident keys into global agent...');
          await this.getOrLoadGlobalFido2Agent('startup', 'Startup: Global Agent Cache', 'direct');
        } catch (err) {
          console.warn('[fido2] Startup unlock failed or cancelled:', err);
        }
      }

      // 2. Smartcard / PIV unlock second (if detected and not yet active)
      if (hasSmartcard && pathsNeedingUnlock.length > 0) {
        try {
          console.log(
            `[smartcard] Startup unlock: loading Smartcard into global agent for ${pathsNeedingUnlock.join(', ')}...`
          );
          let transientPin: string | null = null;
          const startupPinPrompt = async () => {
            if (transientPin !== null) {
              return transientPin;
            }
            transientPin = await this.promptForPinDirect(
              'Enter your smartcard PIN to unlock it for this app session:',
              'smartcard',
              'Startup: Global Agent Cache'
            );
            return transientPin;
          };

          try {
            for (const libPath of pathsNeedingUnlock) {
              try {
                await this.getOrLoadGlobalSmartcardAgent(libPath, startupPinPrompt);
              } catch (err) {
                console.warn(`[smartcard] Startup unlock failed for ${libPath}:`, err);
              }
            }
          } finally {
            transientPin = null;
          }
        } catch (err) {
          console.warn('[smartcard] Startup unlock failed or cancelled:', err);
        }
      }
    })();

    this.startupUnlockPromise = unlockPromise;
    void unlockPromise.finally(() => {
      if (this.startupUnlockPromise === unlockPromise) {
        this.startupUnlockPromise = undefined;
      }
    });

    return { started: true };
  }

  /**
   * Kills the private per-session smartcard agent (if any) that was loaded for `sessionId` under
   * 'agent-per-session' mode (or 'always-prompt', which reuses the same per-session mechanism —
   * see resolveSmartcardAgentPath), whether that session was a terminal (PTY exit) or a file
   * manager SFTP connection (STORAGE_DISCONNECT).
   */
  private cleanupSmartcardSessionAgent(sessionId: string): void {
    if (this.activePresenceSessions.has(sessionId)) {
      this.activePresenceSessions.delete(sessionId);
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        const event: PresenceClearEvent = { sessionId };
        webContents.send(IPC_CHANNELS.PRESENCE_CLEAR, event);
      }
    }
    const entry = this.smartcardSessionAgents.get(sessionId);
    if (entry === undefined) return;
    this.smartcardSessionAgents.delete(sessionId);
    if (entry.kind === 'pkcs11') {
      // Evict just this card first — killPrivateAgent() is a no-op on Windows
      // (the socket is the shared system agent service, not a process we own).
      void AgentLifecycleManager.unloadCard(entry.socketPath, entry.pkcs11LibPath);
    } else {
      // See loadFido2ResidentKeysIntoPrivateAgent's keepAskpassAliveForAgentLifetime: this
      // session's agent was given its own long-lived Askpass server so a *later* signature
      // request (not just the initial load) still prompts through this app's own PIN modal —
      // that server is never stopped anywhere else, so it must be torn down here or it leaks
      // for the rest of the app's process lifetime.
      void entry.askpassServer?.stop();
      if (process.platform === 'win32') {
        // Resident FIDO2 credentials have no library path to unload by, and `ssh-add -D`
        // would nuke every identity in the shared Windows agent service, including ones
        // unrelated apps loaded — so, unlike PKCS#11, there's currently no way to evict
        // just this session's credentials from that shared agent. They stay loaded until
        // the ssh-agent service itself is restarted. Non-Windows doesn't hit this: each
        // session gets its own freshly-spawned agent process, torn down below.
        console.warn(
          `IpcBridge: session ${sessionId}'s FIDO2 resident credentials remain loaded in the shared Windows ssh-agent service (no per-credential eviction implemented yet)`
        );
      }
    }
    AgentLifecycleManager.killPrivateAgent(entry.pid);
  }

  /**
   * Kills every cached global smartcard agent (the 'agent-global' mode's
   * "lock card" action), forcing the next connection that needs any of
   * those cards to prompt for the PIN again.
   */
  private lockAllGlobalSmartcardAgents(): number {
    let count = 0;
    for (const [key, { pid, socketPath, askpassServer }] of this.globalSmartcardAgents.entries()) {
      if (key !== '__fido2__') {
        void AgentLifecycleManager.unloadCard(socketPath, key);
      }
      void askpassServer?.stop();
      AgentLifecycleManager.killPrivateAgent(pid);
      this.globalSmartcardCerts.delete(key);
      count++;
    }
    this.globalSmartcardAgents.clear();
    this.globalSmartcardAgentFailures.clear();
    return count;
  }

  /**
   * Reports what's currently cached under 'agent-global' PIN caching mode:
   * which PKCS#11 libraries have an unlocked agent, and which certificate(s)
   * each one is holding (queried live from the agent via `ssh-add -l`).
   *
   * Each identity is additionally enriched with X.509 certificate details
   * (subject, UPN, validity) — see `globalSmartcardCerts` for why those come
   * from a cache populated once at load time rather than a fresh PKCS#11
   * read on every call.
   */
  private async listGlobalSmartcardAgents(): Promise<CachedSmartcardAgent[]> {
    const entries = Array.from(this.globalSmartcardAgents.entries());
    return Promise.all(
      entries.map(async ([pkcs11LibPath, { socketPath }]) => {
        const identities = await listAgentIdentities(socketPath);
        const certsByFingerprint =
          this.globalSmartcardCerts.get(pkcs11LibPath) ?? new Map<string, SmartcardCertificateDetails>();
        return {
          pkcs11LibPath: pkcs11LibPath === '__fido2__' ? 'FIDO2 Security Key' : pkcs11LibPath,
          identities: identities.map((identity) => {
            const cert = certsByFingerprint.get(identity.fingerprint);
            return cert
              ? {
                  ...identity,
                  certificate: {
                    subject: cert.subject,
                    issuer: cert.issuer,
                    validFrom: cert.validFrom,
                    validTo: cert.validTo,
                    upn: cert.upn,
                  },
                }
              : identity;
          }),
        };
      })
    );
  }

  /**
   * Checks the host's assigned dotfiles pool (if any) against the live
   * server and applies it per the profile's sync policy. A no-op unless the
   * feature is enabled globally and the profile has explicitly opted in with
   * both a pool and a policy — see AppSettings.dotfilesPoolEnabled and
   * SSHConnectionConfig.dotfilesSyncPolicy.
   */
  private async runDotfilesSyncCheck(sessionId: string, config: SSHConnectionConfig): Promise<void> {
    console.log(
      `[smartcard] runDotfilesSyncCheck: firing for session ${sessionId}, poolId=${config.poolId}, policy=${config.dotfilesSyncPolicy}, agentPath=${config.agentPath ?? '(none — will load its own if smartcard)'}`
    );
    if (!config.poolId || !config.dotfilesSyncPolicy) return;

    if (config.authType === 'smartcard' && config.pkcs11LibPath && !config.agentPath) {
      const lastFailedAt = this.globalSmartcardAgentFailures.get(config.pkcs11LibPath);
      if (lastFailedAt && Date.now() - lastFailedAt < 30000) {
        console.log(
          `[smartcard] runDotfilesSyncCheck: skipping dotfiles sync for ${sessionId} (smartcard load failed recently)`
        );
        return;
      }
    }

    const settings = await this.settingsStore.getSettings();
    if (!settings.dotfilesPoolEnabled) return;

    const pool = await this.dotfilePoolStore.getPool(config.poolId);
    if (!pool || pool.files.length === 0) return;

    const session = this.sshPtyManager.getSession(sessionId);
    const controlPath = session?.controlPath;

    const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
      sessionId,
      'Touch your security key to sync dotfiles...'
    );

    const hostVerifier = createHostVerifier({
      host: config.host,
      port: config.port ?? 22,
      knownHosts: this.knownHostsStore,
      onUnknownOrChanged: (info) => this.promptHostKeyTrust(info),
    });

    const pinPromptHandler =
      config.authType === 'smartcard' && config.pkcs11LibPath
        ? () =>
            this.sshPtyManager.promptForPin(
              sessionId,
              `Enter your smartcard PIN to sync dotfiles with ${config.name || config.host}:`,
              'smartcard',
              `Dotfiles Sync: ${config.name || config.host}`
            )
        : undefined;

    let provider: Awaited<ReturnType<DotfileSyncService['computeDiff']>>['provider'] | undefined;
    try {
      const diff = await this.dotfileSyncService.computeDiff(config, pool, {
        hostVerifier,
        pinPromptHandler,
        controlPath,
        onPresence: onPresenceRequested,
        onPresenceCleared,
      });
      provider = diff.provider;
      if (diff.entries.length === 0) {
        return;
      }

      const filesToApply = pool.files.filter((f) => diff.entries.some((e) => e.fileId === f.id));

      if (config.dotfilesSyncPolicy === 'ask') {
        const resolution = await this.promptDotfilesSync({
          sessionId,
          poolName: pool.name,
          hostLabel: `${config.username}@${config.host}`,
          entries: diff.entries,
        });

        if (resolution === 'ignore') {
          return;
        }
        if (resolution === 'always') {
          await this.profileStore.saveSSH({ ...config, dotfilesSyncPolicy: 'always' });
        }
      }
      // 'always' policy (either pre-set or just chosen above) falls through and applies silently.

      await this.dotfileSyncService.applyFiles(provider, filesToApply);
      this.sendDotfilesSyncStatus({ sessionId, status: 'updated', updatedCount: filesToApply.length });
    } catch (err) {
      this.sendDotfilesSyncStatus({
        sessionId,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await provider?.disconnect?.().catch(() => {});
    }
  }

  private promptDotfilesSync(info: Omit<DotfilesSyncPromptEvent, 'id'>): Promise<DotfilesSyncResolution> {
    return new Promise((resolve) => {
      const webContents = this.getWebContents();
      if (!webContents || webContents.isDestroyed?.()) {
        resolve('ignore');
        return;
      }

      const id = crypto.randomUUID();
      this.pendingDotfilesSyncPrompts.set(id, { callback: resolve });

      const event: DotfilesSyncPromptEvent = { id, ...info };
      webContents.send(IPC_CHANNELS.DOTFILES_SYNC_PROMPT, event);
    });
  }

  private sendDotfilesSyncStatus(event: {
    sessionId: string;
    status: 'updated' | 'error';
    updatedCount?: number;
    error?: string;
  }): void {
    const webContents = this.getWebContents();
    if (webContents && !webContents.isDestroyed?.()) {
      webContents.send(IPC_CHANNELS.DOTFILES_SYNC_STATUS, event);
    }
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
        const saved = await this.settingsStore.saveSettings(settings);
        this.scheduleAutoSync();
        return saved;
      }
    );
  }

  public scheduleAutoSync(delayMs = 2000): void {
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
    }
    this.autoSyncTimer = setTimeout(async () => {
      this.autoSyncTimer = null;
      try {
        const config = await this.syncConfigStore.getConfig();
        if (!config.autoSync || !config.target) {
          return;
        }
        if (!(await this.ensureSyncUnlockedForAutoSync(config))) {
          return;
        }
        const provider = await this.storageRegistry.getOrCreate(config.target);
        await this.profileSyncService.pushToRemote(provider, config.remoteBasePath ?? '');
        await this.syncConfigStore.setLastSyncAt(new Date().toISOString());
        await this.pushSyncStatusToRenderer();
      } catch (err) {
        console.warn('[AutoSync] Background push failed:', err);
      }
    }, delayMs);
  }

  /**
   * Starts (or restarts) the periodic background pull, so machines pick up
   * changes pushed from elsewhere without the user having to open Settings
   * and click "Pull" themselves. Runs only while auto-sync is enabled — see
   * stopAutoPullTimer() for where it's torn down.
   */
  private startAutoPullTimer(): void {
    this.stopAutoPullTimer();
    this.autoPullTimer = setInterval(() => {
      void this.runAutoPull();
    }, IpcBridge.AUTO_PULL_INTERVAL_MS);
    // node's timer would otherwise keep the process alive just for this.
    this.autoPullTimer.unref?.();
  }

  private stopAutoPullTimer(): void {
    if (this.autoPullTimer) {
      clearInterval(this.autoPullTimer);
      this.autoPullTimer = null;
    }
  }

  private async runAutoPull(): Promise<void> {
    try {
      const config = await this.syncConfigStore.getConfig();
      if (!config.autoSync || !config.target) {
        this.stopAutoPullTimer();
        return;
      }
      if (!(await this.ensureSyncUnlockedForAutoSync(config))) {
        return;
      }
      const provider = await this.storageRegistry.getOrCreate(config.target);
      const result = await this.profileSyncService.pullFromRemote(provider, config.remoteBasePath ?? '');
      await this.syncConfigStore.setLastSyncAt(new Date().toISOString());
      if (result.sshNativeConflicts.length > 0) {
        // No interactive flow for a conflict discovered by a background pull
        // (the user may not even have Settings open) — surfaced in the log
        // instead; the conflict itself is never auto-resolved either way.
        console.warn(
          `[AutoSync] Background pull found ${result.sshNativeConflicts.length} known_hosts conflict(s), left unapplied.`
        );
      }
      await this.pushSyncStatusToRenderer();
    } catch (err) {
      console.warn('[AutoSync] Background pull failed:', err);
    }
  }

  private async pushSyncStatusToRenderer(): Promise<void> {
    const webContents = this.getWebContents();
    if (webContents && !webContents.isDestroyed?.()) {
      const status = await this.buildSyncStatus();
      webContents.send(IPC_CHANNELS.PROFILE_SYNC_STATUS, status);
    }
  }

  /**
   * Whether sync is unlocked for a background auto-sync/auto-pull cycle to
   * proceed — unlocking it via the linked smartcard first if it isn't.
   * Deliberately never attempts a text master-password prompt on its own
   * (unlike the smartcard PIN dialog, that's not something a user expects to
   * pop up unprompted); if no smartcard is linked, a locked sync just skips
   * this cycle exactly as before. A failed/declined auto-unlock attempt is
   * throttled (SMARTCARD_AUTO_UNLOCK_COOLDOWN_MS) so a persistently missing
   * card or a user who dismisses the prompt isn't re-nagged on every debounce
   * tick or pull interval.
   */
  private async ensureSyncUnlockedForAutoSync(config: SyncConfigData): Promise<boolean> {
    if (this.syncCryptoService.isUnlocked('topology') && this.syncCryptoService.isUnlocked('credentials')) {
      return true;
    }
    if (!config.smartcardSync) {
      return false;
    }
    if (Date.now() - this.lastSmartcardAutoUnlockAttempt < IpcBridge.SMARTCARD_AUTO_UNLOCK_COOLDOWN_MS) {
      return false;
    }
    this.lastSmartcardAutoUnlockAttempt = Date.now();
    try {
      await this.unlockWithSmartcardInternal(
        { pkcs11LibPath: config.smartcardSync.pkcs11LibPath },
        { skipAutoSyncSchedule: true }
      );
      return this.syncCryptoService.isUnlocked('topology') && this.syncCryptoService.isUnlocked('credentials');
    } catch (err) {
      console.warn('[AutoSync] Automatic smartcard unlock failed:', err);
      return false;
    }
  }

  private async buildSyncStatus(): Promise<ProfileSyncStatus> {
    const config = await this.syncConfigStore.getConfig();
    return {
      configured: !!config.target,
      target:
        config.target && (config.target.type === 'sftp' || config.target.type === 's3')
          ? { id: config.target.id, name: config.target.name, type: config.target.type }
          : undefined,
      targetConfig:
        config.target && (config.target.type === 'sftp' || config.target.type === 's3')
          ? {
              type: config.target.type,
              sftpConfig: config.target.sftpConfig,
              s3Config: config.target.s3Config,
            }
          : undefined,
      remoteBasePath: config.remoteBasePath,
      hasLocalSalts: !!(config.topologySaltBase64 && config.credentialsSaltBase64),
      topologyUnlocked: this.syncCryptoService.isUnlocked('topology'),
      credentialsUnlocked: this.syncCryptoService.isUnlocked('credentials'),
      lastSyncAt: config.lastSyncAt,
      comparison: this.profileSyncService.getLastComparison() ?? undefined,
      autoSync: Boolean(config.autoSync),
      smartcardLinked: Boolean(config.smartcardSync),
      smartcardLibPath: config.smartcardSync?.pkcs11LibPath,
      smartcardAvailable: (await SmartcardDetector.detectAvailableLibraries(undefined, { onlyExisting: true }).catch(() => [])).length > 0,
    };
  }

  private registerSyncHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_SETUP,
      async (_event, payload: { target: StorageConnectConfig; remoteBasePath?: string }) => {
        const target = payload?.target;
        if (!target || !target.id || !target.name) {
          throw new Error('A sync target with an id and name is required');
        }
        if (target.type !== 'sftp' && target.type !== 's3') {
          throw new Error('Remote profile sync only supports an SFTP or S3 target');
        }
        if (target.type === 's3' && !payload.remoteBasePath?.trim()) {
          throw new Error('An S3 target requires a bucket (optionally "bucket/prefix") to sync to');
        }
        await this.syncConfigStore.setTarget(target, payload.remoteBasePath ?? '');
        await this.storageRegistry.disconnect?.(target.id);
        await this.storageRegistry.disconnect?.('sshs3-remote-profile-sync');
        // The (app-lifetime) ProfileSyncService instance otherwise keeps comparing
        // against whatever remote state it last observed on the *previous* target.
        this.profileSyncService.resetRemoteState();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_ENABLE,
      async (
        _event,
        passwords: { topologyPassword: string; credentialsPassword: string }
      ): Promise<ProfileSyncStatus> => {
        if (!passwords?.topologyPassword || !passwords?.credentialsPassword) {
          throw new Error('Both the topology and credentials master passwords are required');
        }
        return await this.unlockSyncInternal(passwords);
      }
    );

    this.registerHandler(IPC_CHANNELS.PROFILE_SYNC_PUSH, async (): Promise<ProfileSyncStatus> => {
      const config = await this.syncConfigStore.getConfig();
      if (!config.target) {
        throw new Error('Configure a sync target first (profile-sync:setup)');
      }
      const provider = await this.storageRegistry.getOrCreate(config.target);
      await this.profileSyncService.pushToRemote(provider, config.remoteBasePath ?? '');
      await this.syncConfigStore.setLastSyncAt(new Date().toISOString());
      return await this.buildSyncStatus();
    });

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_PULL,
      async (
        _event,
        passwords?: { topologyPassword?: string; credentialsPassword?: string }
      ): Promise<ProfileSyncPullResult & ProfileSyncStatus> => {
        const config = await this.syncConfigStore.getConfig();
        if (!config.target) {
          throw new Error('Configure a sync target first (profile-sync:setup)');
        }
        const provider = await this.storageRegistry.getOrCreate(config.target);

        const result = await this.profileSyncService.pullFromRemote(provider, config.remoteBasePath ?? '', {
          topology: passwords?.topologyPassword,
          credentials: passwords?.credentialsPassword,
        });

        // Bootstrap on a fresh machine: persist whichever salt(s) this pull
        // just learned from the downloaded files, without touching a salt
        // that was already known (e.g. only one of the two passwords was
        // supplied this time).
        const topologySalt = this.syncCryptoService.getSalt('topology');
        const credentialsSalt = this.syncCryptoService.getSalt('credentials');
        if ((topologySalt && !config.topologySaltBase64) || (credentialsSalt && !config.credentialsSaltBase64)) {
          await this.syncConfigStore.setSalts({
            topologySalt: !config.topologySaltBase64 ? topologySalt : undefined,
            credentialsSalt: !config.credentialsSaltBase64 ? credentialsSalt : undefined,
          });
        }

        await this.syncConfigStore.setLastSyncAt(new Date().toISOString());
        const status = await this.buildSyncStatus();
        return { ...result, ...status };
      }
    );

    this.registerHandler(IPC_CHANNELS.PROFILE_SYNC_STATUS, async (): Promise<ProfileSyncStatus> => {
      return await this.buildSyncStatus();
    });

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_COMPARE,
      async (): Promise<SyncComparisonResult> => {
        const config = await this.syncConfigStore.getConfig();
        if (!config.target) {
          throw new Error('Configure a sync target first (profile-sync:setup)');
        }
        const provider = await this.storageRegistry.getOrCreate(config.target);
        return await this.profileSyncService.compareWithRemote(provider, config.remoteBasePath ?? '');
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_SET_AUTO_SYNC,
      async (_event, enabled: boolean): Promise<ProfileSyncStatus> => {
        await this.syncConfigStore.setAutoSync(Boolean(enabled));
        if (enabled) {
          this.scheduleAutoSync(500);
          this.startAutoPullTimer();
        } else {
          this.stopAutoPullTimer();
        }
        return await this.buildSyncStatus();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_UNLOCK_SMARTCARD,
      async (_event, options?: { pkcs11LibPath?: string; pin?: string }): Promise<ProfileSyncStatus> => {
        return await this.unlockWithSmartcardInternal(options);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_LINK_SMARTCARD,
      async (
        _event,
        options: {
          pkcs11LibPath: string;
          pin?: string;
          passwords?: { topologyPassword: string; credentialsPassword: string };
        }
      ): Promise<ProfileSyncStatus> => {
        const pinHandler = async () => {
          if (options.pin) return options.pin;
          return await this.promptForPinDirect(
            'Enter your smartcard PIN to link this card to Remote Profile Sync:',
            'smartcard'
          );
        };

        const settings = await this.settingsStore.getSettings();
        const mode = settings.smartcardAuthMode ?? 'always-prompt';

        let socketPath: string;
        let privateAgentPid: number | undefined;

        if (this.globalSmartcardAgents.has(options.pkcs11LibPath)) {
          socketPath = this.globalSmartcardAgents.get(options.pkcs11LibPath)!.socketPath;
        } else if (mode === 'agent-global') {
          socketPath = await this.getOrLoadGlobalSmartcardAgent(options.pkcs11LibPath, pinHandler);
        } else {
          const agent = await this.loadSmartcardIntoPrivateAgentWithPresence(options.pkcs11LibPath, pinHandler);
          socketPath = agent.socketPath;
          privateAgentPid = agent.pid;
        }

        try {
          const identities = await getAgentIdentities(socketPath);
          if (identities.length === 0) {
            throw new Error('No smartcard identities/certificates found on the card');
          }
          const chosen = identities[0];
          const challenge = crypto.randomBytes(32);
          const sig = await signChallengeWithAgent(socketPath, chosen.keyBlob, challenge);
          const verified = verifyAgentSignature(chosen.keyBlob, challenge, sig);
          if (!verified) {
            throw new Error('Failed to verify cryptographic signature from smartcard');
          }

          const hasExplicitPasswords = Boolean(
            options.passwords?.topologyPassword && options.passwords?.credentialsPassword
          );
          if (!hasExplicitPasswords && getKeyAlgorithm(chosen.keyBlob).startsWith('ecdsa-sha2-')) {
            // No saved passwords to fall back on, so unlocking would have to
            // derive a "stable" secret straight from a fresh card signature
            // every time — but ECDSA signing is non-deterministic on most
            // PKCS#11 tokens (a fresh hardware nonce per signature), so that
            // derived secret would differ on every unlock and could never
            // decrypt data pushed under an earlier one. Refuse rather than
            // risk silently locking the user out of their own synced data.
            throw new Error(
              'This smartcard uses an ECDSA key, which most PKCS#11 modules sign non-deterministically — sshs3 cannot derive a stable sync key from it alone. Unlock Remote Profile Sync with your master passwords first (Settings > Sync), then link this smartcard to save them.'
            );
          }

          let wrappedPasswordsEncrypted: string | undefined;
          if (options.passwords?.topologyPassword && options.passwords?.credentialsPassword) {
            wrappedPasswordsEncrypted = encryptSecretValue(JSON.stringify(options.passwords));
            if (!this.syncCryptoService.isUnlocked('topology') || !this.syncCryptoService.isUnlocked('credentials')) {
              await this.unlockSyncInternal(options.passwords);
            }
          }

          await this.syncConfigStore.setSmartcardSync({
            pkcs11LibPath: options.pkcs11LibPath,
            keyComment: chosen.comment,
            keyBlobBase64: chosen.keyBlob.toString('base64'),
            keyFingerprint: crypto.createHash('sha256').update(chosen.keyBlob).digest('hex'),
            wrappedPasswordsEncrypted,
          });

          return await this.buildSyncStatus();
        } catch (err) {
          if (this.globalSmartcardAgents.has(options.pkcs11LibPath) && privateAgentPid === undefined) {
            const cached = this.globalSmartcardAgents.get(options.pkcs11LibPath);
            if (cached) {
              void AgentLifecycleManager.unloadCard(cached.socketPath, options.pkcs11LibPath);
              AgentLifecycleManager.killPrivateAgent(cached.pid);
              this.globalSmartcardAgents.delete(options.pkcs11LibPath);
              this.globalSmartcardCerts.delete(options.pkcs11LibPath);
            }
          }
          throw err;
        } finally {
          if (privateAgentPid !== undefined) {
            void AgentLifecycleManager.unloadCard(socketPath, options.pkcs11LibPath);
            AgentLifecycleManager.killPrivateAgent(privateAgentPid);
          }
        }
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_UNLINK_SMARTCARD,
      async (): Promise<ProfileSyncStatus> => {
        await this.syncConfigStore.setSmartcardSync(undefined);
        return await this.buildSyncStatus();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILE_SYNC_WIPE,
      async (): Promise<ProfileSyncStatus & { remoteWipeErrors: string[] }> => {
        const config = await this.syncConfigStore.getConfig();
        const remoteWipeErrors: string[] = [];

        if (config.target) {
          try {
            const provider = await this.storageRegistry.getOrCreate(config.target);
            const result = await this.profileSyncService.wipeRemote(provider, config.remoteBasePath ?? '');
            remoteWipeErrors.push(...result.errors);
          } catch (err: any) {
            // The remote may simply be unreachable (e.g. the user wants to reset
            // sync from a machine that can no longer connect) — local config is
            // still cleared below regardless, and the error is surfaced instead
            // of blocking the reset entirely.
            remoteWipeErrors.push(err?.message || String(err));
          }
          await this.storageRegistry.disconnect?.(config.target.id);
        }
        await this.storageRegistry.disconnect?.('sshs3-remote-profile-sync');

        this.syncCryptoService.lock();
        await this.syncConfigStore.clear();
        this.profileSyncService.resetRemoteState();
        this.stopAutoPullTimer();

        const status = await this.buildSyncStatus();
        return { ...status, remoteWipeErrors };
      }
    );
  }

  /**
   * Unlocks sync via a linked hardware smartcard: loads the card into a
   * private agent, has it sign a challenge to prove possession, then derives
   * or unwraps the master passwords from that signature and unlocks through
   * the normal password path. Shared by the interactive profile-sync:unlock-
   * smartcard handler and ensureSyncUnlockedForAutoSync's background
   * auto-unlock — either way the PIN is requested through the same in-app
   * dialog (promptForPinDirect), never silently.
   */
  private async unlockWithSmartcardInternal(
    options?: { pkcs11LibPath?: string; pin?: string },
    unlockOptions?: { skipAutoSyncSchedule?: boolean }
  ): Promise<ProfileSyncStatus> {
    const config = await this.syncConfigStore.getConfig();
    if (!config.target) {
      throw new Error('Configure a sync target first (profile-sync:setup)');
    }

    let libPath = options?.pkcs11LibPath || config.smartcardSync?.pkcs11LibPath;
    if (!libPath) {
      const detected = await SmartcardDetector.detectAvailableLibraries(undefined, { onlyExisting: true });
      if (detected.length === 0) {
        throw new Error('No smartcard libraries detected. Please ensure your card reader / PKCS#11 module is installed.');
      }
      libPath = detected[0].path;
    }

    const pinHandler = async () => {
      if (options?.pin) return options.pin;
      return await this.promptForPinDirect('Enter your smartcard PIN to unlock Remote Profile Sync:', 'smartcard');
    };

    const settings = await this.settingsStore.getSettings();
    const mode = settings.smartcardAuthMode ?? 'always-prompt';

    let socketPath: string;
    let privateAgentPid: number | undefined;

    if (this.globalSmartcardAgents.has(libPath)) {
      socketPath = this.globalSmartcardAgents.get(libPath)!.socketPath;
    } else if (mode === 'agent-global') {
      socketPath = await this.getOrLoadGlobalSmartcardAgent(libPath, pinHandler);
    } else {
      const agent = await this.loadSmartcardIntoPrivateAgentWithPresence(libPath, pinHandler);
      socketPath = agent.socketPath;
      privateAgentPid = agent.pid;
    }

    try {
      const identities = await getAgentIdentities(socketPath);
      if (identities.length === 0) {
        throw new Error('No smartcard identities/certificates found on the card');
      }
      const chosen =
        identities.find(
          (id) =>
            (config.smartcardSync?.keyBlobBase64 && id.keyBlob.toString('base64') === config.smartcardSync.keyBlobBase64) ||
            (config.smartcardSync?.keyFingerprint &&
              crypto.createHash('sha256').update(id.keyBlob).digest('hex') === config.smartcardSync.keyFingerprint)
        ) || identities[0];

      const challenge = crypto.randomBytes(32);
      const sig = await signChallengeWithAgent(socketPath, chosen.keyBlob, challenge);
      const verified = verifyAgentSignature(chosen.keyBlob, challenge, sig);
      if (!verified) {
        throw new Error('Failed to verify cryptographic signature from smartcard. Please ensure the correct card is inserted.');
      }

      let topologyPassword = '';
      let credentialsPassword = '';

      if (config.smartcardSync?.wrappedPasswordsEncrypted) {
        try {
          const decrypted = decryptSecretValue(config.smartcardSync.wrappedPasswordsEncrypted);
          const parsed = JSON.parse(decrypted);
          topologyPassword = parsed.topologyPassword;
          credentialsPassword = parsed.credentialsPassword;
        } catch {
          throw new Error('Failed to decrypt saved sync passwords with OS keyring.');
        }
      } else if (config.smartcardSync?.wrappedPassword) {
        // Legacy format from an older sshs3 version: its wrapping key was
        // derived from a signature over a single-use random challenge,
        // which by construction can never be reproduced on a later unlock
        // (a fresh random challenge — and, for most ECDSA tokens, a fresh
        // nonce — on every call) — this can only ever fail. Don't bother
        // attempting it.
        throw new Error(
          'This smartcard was linked with an older, incompatible version of sshs3. Please re-link it in Settings.'
        );
      } else {
        // No saved passwords are linked to this card at all. There is no
        // stable secret derivable from a smartcard signature over a random,
        // single-use challenge (see the doc comment on KEY_DERIVATION_MESSAGE),
        // so derive it from a second signature over the fixed derivation
        // message instead — and refuse outright for an ECDSA key, whose
        // signature (and thus the derived secret) can't be reproduced
        // across separate unlocks on most PKCS#11 tokens.
        if (getKeyAlgorithm(chosen.keyBlob).startsWith('ecdsa-sha2-')) {
          throw new Error(
            'No saved sync passwords are linked to this smartcard, and its ECDSA key cannot derive a stable one on its own. Unlock Remote Profile Sync with your master passwords, then re-link the smartcard to save them.'
          );
        }
        const derivationSig = await signChallengeWithAgent(socketPath, chosen.keyBlob, KEY_DERIVATION_MESSAGE);
        const smartcardSecret = deriveSecretFromSignature(derivationSig);
        topologyPassword = smartcardSecret;
        credentialsPassword = smartcardSecret;
      }

      return await this.unlockSyncInternal({ topologyPassword, credentialsPassword }, unlockOptions);
    } catch (err) {
      if (this.globalSmartcardAgents.has(libPath) && privateAgentPid === undefined) {
        const cached = this.globalSmartcardAgents.get(libPath);
        if (cached) {
          void AgentLifecycleManager.unloadCard(cached.socketPath, libPath);
          AgentLifecycleManager.killPrivateAgent(cached.pid);
          this.globalSmartcardAgents.delete(libPath);
          this.globalSmartcardCerts.delete(libPath);
        }
      }
      throw err;
    } finally {
      if (privateAgentPid !== undefined) {
        void AgentLifecycleManager.unloadCard(socketPath, libPath);
        AgentLifecycleManager.killPrivateAgent(privateAgentPid);
      }
    }
  }

  private async unlockSyncInternal(
    passwords: { topologyPassword: string; credentialsPassword: string },
    options?: { skipAutoSyncSchedule?: boolean }
  ): Promise<ProfileSyncStatus> {
    const config = await this.syncConfigStore.getConfig();
    if (!config.target) {
      throw new Error('Configure a sync target first (profile-sync:setup)');
    }
    const provider = await this.storageRegistry.getOrCreate(config.target);

    if (config.topologySaltBase64 && config.credentialsSaltBase64) {
      this.syncCryptoService.unlock(
        'topology',
        passwords.topologyPassword,
        Buffer.from(config.topologySaltBase64, 'base64')
      );
      this.syncCryptoService.unlock(
        'credentials',
        passwords.credentialsPassword,
        Buffer.from(config.credentialsSaltBase64, 'base64')
      );
      await this.profileSyncService.pullFromRemote(provider, config.remoteBasePath ?? '');
      // Re-unlocking only pulls, never pushes — any local edits made while
      // locked would otherwise sit unpushed until the user notices and clicks
      // Push manually. Flush them now if auto-sync is on (scheduleAutoSync is
      // itself a no-op when it isn't, or when there's nothing new to push).
      // Skipped when called from ensureSyncUnlockedForAutoSync, which already
      // pushes/pulls itself right after unlocking — scheduling another one
      // here too would just double up that same request 500ms later.
      if (!options?.skipAutoSyncSchedule) {
        this.scheduleAutoSync(500);
      }
    } else {
      if (await this.profileSyncService.hasRemoteData(provider, config.remoteBasePath ?? '')) {
        throw new Error(
          'This sync target already has data pushed from another machine. Use profile-sync:pull to bootstrap this machine instead of profile-sync:enable.'
        );
      }
      const topologySalt = generateSalt();
      const credentialsSalt = generateSalt();
      this.syncCryptoService.unlock('topology', passwords.topologyPassword, topologySalt);
      this.syncCryptoService.unlock('credentials', passwords.credentialsPassword, credentialsSalt);
      await this.syncConfigStore.setSalts({ topologySalt, credentialsSalt });
      await this.profileSyncService.pushToRemote(provider, config.remoteBasePath ?? '');
    }

    await this.syncConfigStore.setLastSyncAt(new Date().toISOString());
    return await this.buildSyncStatus();
  }

  private registerConnectionTestHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.CONNECTION_TEST_SSH,
      async (_event, config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }> => {
        if (!config || !config.host?.trim()) {
          return { success: false, error: 'Hostname / IP is required' };
        }
        if (!config.username?.trim()) {
          return { success: false, error: 'Username is required' };
        }

        if (config.authType === 'smartcard') {
          if (!config.pkcs11LibPath?.trim()) {
            return { success: false, error: 'PKCS#11 library path is required' };
          }
          const valid = await SmartcardDetector.validateLibraryPath(config.pkcs11LibPath);
          if (!valid) {
            return { success: false, error: `Smartcard library not found: ${config.pkcs11LibPath}` };
          }
          return { success: true };
        }

        // Like 'smartcard' above, a live connection test is skipped: a real attempt would need
        // a physical touch (and possibly the resident agent-load dance) that doesn't fit a quick
        // "Test Connection" click. Only the config shape is validated here.
        if (config.authType === 'fido2') {
          if (config.fido2Resident) {
            return { success: true };
          }
          if (!config.privateKeyPath?.trim()) {
            return { success: false, error: 'A key file is required (or enable "Resident key on device")' };
          }
          const exists = await fs
            .stat(config.privateKeyPath)
            .then((s) => s.isFile())
            .catch(() => false);
          if (!exists) {
            return { success: false, error: `Key file not found: ${config.privateKeyPath}` };
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
        if (!config || !config.region?.trim()) {
          return { success: false, error: 'Region is required' };
        }
        if (config.authMode === 'sso') {
          if (!config.sso?.startUrl?.trim() || !config.sso?.accountId?.trim() || !config.sso?.roleName?.trim()) {
            return { success: false, error: 'Start URL, Account, and Role are required for AWS SSO' };
          }
        } else if (!config.accessKeyId?.trim() || !config.secretAccessKey?.trim()) {
          return { success: false, error: 'Access Key ID and Secret Access Key are required' };
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

  /**
   * Runs the AWS SSO device-authorization flow and resolves once the user
   * approves it in their browser. Mirrors `promptHostKeyTrust`'s pattern of
   * leaving a single long-lived `ipcMain.handle` invoke pending, but also
   * supports cancellation via a separate channel since this wait can be
   * minutes rather than a single click.
   */
  private registerAwsSsoHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.AWS_SSO_LOGIN,
      async (_event, startUrl: string, region: string): Promise<AwsSsoLoginResult> => {
        if (!startUrl?.trim() || !region?.trim()) {
          throw new Error('Start URL and region are required');
        }

        const id = crypto.randomUUID();
        const controller = new AbortController();
        this.pendingAwsSsoLogins.set(id, { cancel: () => controller.abort() });

        try {
          return await this.awsSsoAuthService.login(startUrl, region, {
            onPrompt: (prompt) => {
              const urlToOpen = prompt.verificationUriComplete || prompt.verificationUri;
              if (
                urlToOpen &&
                (urlToOpen.startsWith('http://') || urlToOpen.startsWith('https://')) &&
                electronShell?.openExternal
              ) {
                void electronShell.openExternal(urlToOpen).catch(() => {});
              }
              const webContents = this.getWebContents();
              if (webContents && !webContents.isDestroyed?.()) {
                const event: AwsSsoPromptEvent = { id, ...prompt };
                webContents.send(IPC_CHANNELS.AWS_SSO_PROMPT, event);
              }
            },
            signal: controller.signal,
          });
        } catch (err) {
          if (err instanceof AwsSsoLoginCancelledError) {
            throw new Error('AWS SSO login was cancelled', { cause: err });
          }
          throw err;
        } finally {
          this.pendingAwsSsoLogins.delete(id);
        }
      }
    );

    this.registerHandler(IPC_CHANNELS.AWS_SSO_LOGIN_CANCEL, async (_event, id: string) => {
      const pending = this.pendingAwsSsoLogins.get(id);
      pending?.cancel();
    });

    this.registerHandler(
      IPC_CHANNELS.AWS_SSO_LIST_ACCOUNTS,
      async (_event, accessToken: string, region: string): Promise<AwsSsoAccount[]> => {
        return await this.awsSsoAuthService.listAccounts(accessToken, region);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.AWS_SSO_LIST_ROLES,
      async (_event, accessToken: string, region: string, accountId: string): Promise<AwsSsoAccountRole[]> => {
        return await this.awsSsoAuthService.listAccountRoles(accessToken, region, accountId);
      }
    );
  }

  private registerFileEditorHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.FILE_READ,
      async (_event, providerId: string, remotePath: string, maxBytes?: number) => {
        return await this.fileEditorService.readFile(
          this.storageRegistry,
          providerId,
          remotePath,
          maxBytes
        );
      }
    );

    this.registerHandler(
      IPC_CHANNELS.FILE_SAVE,
      async (_event, providerId: string, remotePath: string, content: string) => {
        await this.fileEditorService.saveFile(
          this.storageRegistry,
          providerId,
          remotePath,
          content
        );
      }
    );

    this.registerHandler(
      IPC_CHANNELS.FILE_OPEN_EXTERNAL,
      async (_event, providerId: string, remotePath: string) => {
        return await this.fileEditorService.openInExternalEditor(
          this.storageRegistry,
          providerId,
          remotePath,
          (statusEvent) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.FILE_EXTERNAL_STATUS, statusEvent);
            }
          }
        );
      }
    );

    this.registerHandler(
      IPC_CHANNELS.FILE_CLOSE_EXTERNAL,
      async (_event, sessionToken: string) => {
        await this.fileEditorService.closeExternalEditor(sessionToken);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.FILE_TAIL_START,
      async (_event, providerId: string, remotePath: string) => {
        return await this.fileTailService.startTail(
          this.storageRegistry,
          providerId,
          remotePath,
          (dataEvent) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.FILE_TAIL_DATA, dataEvent);
            }
          },
          (errorEvent) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.FILE_TAIL_ERROR, errorEvent);
            }
          }
        );
      }
    );

    this.registerHandler(
      IPC_CHANNELS.FILE_TAIL_STOP,
      async (_event, tailId: string) => {
        this.fileTailService.stopTail(tailId);
      }
    );
  }

  private registerK8sHandlers(): void {
    this.registerHandler(IPC_CHANNELS.K8S_LIST_CONTEXTS, async (): Promise<K8sClusterNode[]> => {
      return this.k8sDiscoveryService.listContexts();
    });

    this.registerHandler(
      IPC_CHANNELS.K8S_LIST_NAMESPACES,
      async (_event, contextName: string): Promise<K8sNamespaceNode[]> => {
        return await this.k8sDiscoveryService.listNamespaces(contextName);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.K8S_LIST_PODS,
      async (_event, contextName: string, namespace: string): Promise<K8sPodNode[]> => {
        return await this.k8sDiscoveryService.listPods(contextName, namespace);
      }
    );

    this.registerHandler(IPC_CHANNELS.K8S_RELOAD, async (): Promise<void> => {
      this.k8sDiscoveryService.reload();
    });

    this.registerHandler(
      IPC_CHANNELS.K8S_LOGIN,
      async (_event, options: K8sLoginOptions): Promise<K8sLoginResult> => {
        const result = await loginWithToken(options);
        this.k8sDiscoveryService.reload();
        const webContents = this.getWebContents();
        if (webContents && !webContents.isDestroyed?.()) {
          webContents.send(IPC_CHANNELS.K8S_CONFIG_CHANGED);
        }
        return result;
      }
    );

    this.registerHandler(
      IPC_CHANNELS.K8S_TERMINAL_CREATE,
      async (
        _event,
        target: K8sTerminalTarget,
        options?: { cols?: number; rows?: number }
      ): Promise<{ sessionId: string }> => {
        const sessionId = await this.k8sTerminalManager.createSession(target, options);
        return { sessionId };
      }
    );

    this.registerHandler(IPC_CHANNELS.K8S_TERMINAL_WRITE, async (_event, sessionId: string, data: string) => {
      this.k8sTerminalManager.write(sessionId, data);
    });

    this.registerHandler(
      IPC_CHANNELS.K8S_TERMINAL_RESIZE,
      async (_event, sessionId: string, cols: number, rows: number) => {
        this.k8sTerminalManager.resize(sessionId, cols, rows);
      }
    );

    this.registerHandler(IPC_CHANNELS.K8S_TERMINAL_KILL, async (_event, sessionId: string) => {
      this.k8sTerminalManager.kill(sessionId);
    });

    this.registerHandler(
      IPC_CHANNELS.K8S_LOG_START,
      async (
        _event,
        target: K8sTerminalTarget,
        options?: { tailLines?: number; timestamps?: boolean; previous?: boolean }
      ): Promise<{ sessionId: string }> => {
        const sessionId = await this.k8sLogManager.startFollow(target, options);
        return { sessionId };
      }
    );

    this.registerHandler(IPC_CHANNELS.K8S_LOG_STOP, async (_event, sessionId: string) => {
      this.k8sLogManager.stop(sessionId);
    });

    this.registerHandler(
      IPC_CHANNELS.K8S_POD_DESCRIBE,
      async (
        _event,
        contextName: string,
        namespace: string,
        podName: string
      ): Promise<K8sPodDescription> => {
        return await this.k8sDiscoveryService.describePod(contextName, namespace, podName);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.K8S_PORT_FORWARD_START,
      async (_event, target: K8sPortForwardTarget): Promise<K8sActivePortForward> => {
        return await this.k8sPortForwardManager.startPortForward(target);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.K8S_PORT_FORWARD_STOP,
      async (_event, id: string): Promise<boolean> => {
        return await this.k8sPortForwardManager.stopPortForward(id);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.K8S_PORT_FORWARD_LIST,
      async (): Promise<K8sActivePortForward[]> => {
        return this.k8sPortForwardManager.listActive();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.K8S_DEBUG_ATTACH,
      async (_event, target: K8sDebugTarget): Promise<{ containerName: string }> => {
        return await this.k8sDebugService.attachEphemeralContainer(target);
      }
    );
  }

  private registerSearchHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.SEARCH_START,
      async (_event, options: SearchStartOptions) => {
        return await this.searchOrchestrator.startSearch(
          this.storageRegistry,
          options,
          (resultEvent) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.SEARCH_RESULT, resultEvent);
            }
          },
          (errorEvent) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.SEARCH_ERROR, errorEvent);
            }
          },
          (doneEvent) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.SEARCH_DONE, doneEvent);
            }
          },
          (progressEvent) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.SEARCH_PROGRESS, progressEvent);
            }
          }
        );
      }
    );

    this.registerHandler(
      IPC_CHANNELS.SEARCH_CANCEL,
      async (_event, searchId: string) => {
        this.searchOrchestrator.cancelSearch(searchId);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.SEARCH_PREVIEW,
      async (_event, providerId: string, remotePath: string, lineNumber: number, contextLines: number) => {
        return await this.searchOrchestrator.previewLines(
          this.storageRegistry,
          providerId,
          remotePath,
          lineNumber,
          contextLines
        );
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

    this.registerHandler(IPC_CHANNELS.APP_OPEN_EXTERNAL, async (_event, url: string) => {
      if (url && (url.startsWith('http://') || url.startsWith('https://')) && electronShell?.openExternal) {
        await electronShell.openExternal(url);
      }
    });

    this.registerHandler(IPC_CHANNELS.APP_GET_HOMEDIR, async () => {
      return os.homedir();
    });

    this.registerHandler(IPC_CHANNELS.APP_GET_PLATFORM, async () => {
      return process.platform;
    });

    this.registerHandler(IPC_CHANNELS.APP_GET_HOSTNAME, async () => {
      return os.hostname();
    });

    this.registerHandler(IPC_CHANNELS.APP_GET_SECURITY_STATUS, async () => {
      return { credentialEncryptionAvailable: isEncryptionAvailable() };
    });

    this.registerHandler(IPC_CHANNELS.APP_DETECT_LOCAL_SHELLS, async () => {
      if (process.platform !== 'win32') {
        return { pwsh: false, wsl: false, wslDistros: [] };
      }
      let pwsh: boolean;
      let wsl: boolean;
      let wslDistros: string[];
      try {
        await execFileAsync('where', ['pwsh.exe']);
        pwsh = true;
      } catch {
        pwsh = false;
      }
      try {
        await execFileAsync('where', ['wsl.exe']);
        const { stdout } = await execFileAsync('wsl.exe', ['-l', '-q'], { timeout: 2500 });
        // Strip null bytes (UTF-16LE decoding artifact in Node utf8 buffer) and BOM
        const cleaned = stdout.replace(/\0/g, '').replace(/^\uFEFF/, '');
        const distros = cleaned
          .split(/\r?\n/)
          .map((d) => d.trim())
          .filter(Boolean);
        wsl = distros.length > 0;
        wslDistros = distros;
      } catch {
        wsl = false;
        wslDistros = [];
      }
      return { pwsh, wsl, wslDistros };
    });

    this.registerHandler(
      IPC_CHANNELS.APP_CHECK_X11_SERVER,
      async (_event, displayStr?: string) => {
        return await XServerManager.isListening(displayStr);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.X11_GET_STATUS,
      async (_event, customPath?: string, display?: string) => {
        return await XServerManager.getStatus(customPath, display);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.X11_START_SERVER,
      async (
        _event,
        options?: { customPath?: string; customArgs?: string; display?: string }
      ) => {
        return await XServerManager.startServer(options);
      }
    );

    this.registerHandler(IPC_CHANNELS.X11_STOP_SERVER, async () => {
      return await XServerManager.stopServer();
    });

    this.registerHandler(IPC_CHANNELS.SSH_AGENT_STATUS, async () => {
      return await AgentLifecycleManager.getStatus();
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

    this.registerHandler(
      IPC_CHANNELS.DIALOG_OPEN_FOLDER,
      async (_event, options?: { title?: string }) => {
        const result = await electronDialog.showOpenDialog({
          title: options?.title,
          properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        return result.filePaths[0];
      }
    );
  }

  /**
   * The target field always names an existing parent directory (so it stays
   * browsable even when the eventual sync root doesn't exist yet); the
   * source folder's own name is nested under it, mirroring how drag/drop
   * copy (TRANSFER_ADD, above) and most file managers behave.
   */
  private resolveDirSyncTargetRoot(
    sourcePath: string,
    targetProviderType: StorageType,
    targetParentPath: string
  ): string {
    const sourceBaseName = getBaseName(sourcePath);
    if (!sourceBaseName) {
      return targetParentPath;
    }
    return joinPaths(targetProviderType, targetParentPath, sourceBaseName);
  }

  private registerDirSyncHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.DIR_SYNC_COMPUTE_DIFF,
      async (_event, options: DirSyncComputeDiffOptions): Promise<DirectoryDiffResult> => {
        if (!options?.sourceProviderId || !options?.targetProviderId) {
          throw new Error('sourceProviderId and targetProviderId are required for directory sync');
        }
        const sourceProvider = this.storageRegistry.get(options.sourceProviderId);
        if (!sourceProvider) {
          throw new Error(`Source storage provider not found: ${options.sourceProviderId}`);
        }
        const targetProvider = this.storageRegistry.get(options.targetProviderId);
        if (!targetProvider) {
          throw new Error(`Target storage provider not found: ${options.targetProviderId}`);
        }

        const targetRoot = this.resolveDirSyncTargetRoot(
          options.sourcePath,
          targetProvider.type,
          options.targetPath
        );

        return computeDirSyncDiff(
          sourceProvider,
          options.sourcePath,
          targetProvider,
          targetRoot,
          (side, filesCount, currentItem) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.DIR_SYNC_SCAN_PROGRESS, { side, filesCount, currentItem });
            }
          }
        );
      }
    );

    this.registerHandler(
      IPC_CHANNELS.DIR_SYNC_APPLY,
      async (_event, options: DirSyncApplyOptions): Promise<DirectorySyncApplyResult> => {
        if (!options?.sourceProviderId || !options?.targetProviderId) {
          throw new Error('sourceProviderId and targetProviderId are required for directory sync apply');
        }
        const sourceProvider = this.storageRegistry.get(options.sourceProviderId);
        if (!sourceProvider) {
          throw new Error(`Source storage provider not found: ${options.sourceProviderId}`);
        }
        const targetProvider = this.storageRegistry.get(options.targetProviderId);
        if (!targetProvider) {
          throw new Error(`Target storage provider not found: ${options.targetProviderId}`);
        }

        const targetRoot = this.resolveDirSyncTargetRoot(
          options.sourcePath,
          targetProvider.type,
          options.targetPath
        );

        const result = await applyDirSync(
          options.entries ?? [],
          sourceProvider,
          targetProvider,
          targetRoot,
          { deleteExtraneous: Boolean(options.deleteExtraneous) },
          (progress) => {
            const webContents = this.getWebContents();
            if (webContents && !webContents.isDestroyed?.()) {
              webContents.send(IPC_CHANNELS.DIR_SYNC_APPLY_PROGRESS, progress);
            }
          }
        );

        // Piggyback a synthetic "completed" TRANSFER_PROGRESS event so any
        // open pane auto-refreshes its listing, same as a regular transfer.
        const webContents = this.getWebContents();
        if (webContents && !webContents.isDestroyed?.()) {
          webContents.send(IPC_CHANNELS.TRANSFER_PROGRESS, {
            jobId: 'dirsync-apply',
            fileName: '',
            transferredBytes: 0,
            totalBytes: 0,
            percentage: 100,
            bytesPerSecond: 0,
            status: 'completed',
          });
        }

        return result;
      }
    );

    this.registerHandler(IPC_CHANNELS.DIR_SYNC_PROFILE_LIST, async (): Promise<DirectorySyncProfile[]> => {
      return this.directorySyncProfileStore.list();
    });

    this.registerHandler(
      IPC_CHANNELS.DIR_SYNC_PROFILE_SAVE,
      async (_event, profile: DirectorySyncProfile): Promise<DirectorySyncProfile> => {
        return this.directorySyncProfileStore.save(profile);
      }
    );

    this.registerHandler(IPC_CHANNELS.DIR_SYNC_PROFILE_DELETE, async (_event, id: string): Promise<void> => {
      await this.directorySyncProfileStore.delete(id);
    });
  }

  private setupEventListeners(): void {
    this.onPtyData = ({ sessionId, data }) => {
      if (sessionId && this.activePresenceSessions.has(sessionId)) {
        this.activePresenceSessions.delete(sessionId);
        const webContents = this.getWebContents();
        if (webContents && !webContents.isDestroyed?.()) {
          const event: PresenceClearEvent = { sessionId };
          webContents.send(IPC_CHANNELS.PRESENCE_CLEAR, event);
        }
      }
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.TERMINAL_DATA, sessionId, data);
      }
    };
    this.sshPtyManager.on('data', this.onPtyData);

    this.onPtyExit = ({ sessionId, exitCode, signal }) => {
      if (sessionId && this.activePresenceSessions.has(sessionId)) {
        this.activePresenceSessions.delete(sessionId);
        const webContents = this.getWebContents();
        if (webContents && !webContents.isDestroyed?.()) {
          const event: PresenceClearEvent = { sessionId };
          webContents.send(IPC_CHANNELS.PRESENCE_CLEAR, event);
        }
      }

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

      // Tear down any private smartcard agent that was pre-loaded for this session.
      this.cleanupSmartcardSessionAgent(sessionId);

      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        const event: SSHPtyExitEvent = { exitCode, signal };
        webContents.send(IPC_CHANNELS.TERMINAL_EXIT, sessionId, event);
      }
    };
    this.sshPtyManager.on('exit', this.onPtyExit);

    this.onPtyAskpass = ({ sessionId, prompt, kind, context, callback }) => {
      const id = crypto.randomUUID();
      this.pendingAskpass.set(id, { sessionId, callback });
      if (sessionId) {
        this.activePresenceSessions.add(sessionId);
      }

      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.ASKPASS_PROMPT, { id, prompt, sessionId, kind, context });
      }
    };
    this.sshPtyManager.on('askpass', this.onPtyAskpass);

    this.sshPtyManager.on('reconnecting', ({ sessionId, attempt, maxAttempts }) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.TERMINAL_RECONNECTING, sessionId, { attempt, maxAttempts });
      }
    });

    this.onTransferProgress = (progress) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.TRANSFER_PROGRESS, progress);
      }
    };
    this.transferQueue.on('progress', this.onTransferProgress);

    this.onK8sTerminalData = ({ sessionId, data }) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.K8S_TERMINAL_DATA, sessionId, data);
      }
    };
    this.k8sTerminalManager.on('data', this.onK8sTerminalData);

    this.onK8sTerminalExit = ({ sessionId, status }) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.K8S_TERMINAL_EXIT, sessionId, { status });
      }
    };
    this.k8sTerminalManager.on('exit', this.onK8sTerminalExit);

    this.onK8sLogData = ({ sessionId, data }) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.K8S_LOG_DATA, sessionId, data);
      }
    };
    this.k8sLogManager.on('data', this.onK8sLogData);

    this.onK8sLogEnd = ({ sessionId }) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.K8S_LOG_END, sessionId);
      }
    };
    this.k8sLogManager.on('end', this.onK8sLogEnd);

    this.onK8sPortForwardChange = (activeForwards) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.K8S_PORT_FORWARD_EVENT, activeForwards);
      }
    };
    this.k8sPortForwardManager.on('change', this.onK8sPortForwardChange);

    this.onK8sConfigChanged = () => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.K8S_CONFIG_CHANGED);
      }
    };
    this.unsubscribeK8sConfig = this.k8sDiscoveryService.onConfigChanged(this.onK8sConfigChanged);
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

    if (this.onK8sTerminalData) {
      this.k8sTerminalManager.off('data', this.onK8sTerminalData);
    }
    if (this.onK8sTerminalExit) {
      this.k8sTerminalManager.off('exit', this.onK8sTerminalExit);
    }
    void this.k8sTerminalManager.killAll();

    if (this.onK8sLogData) {
      this.k8sLogManager.off('data', this.onK8sLogData);
    }
    if (this.onK8sLogEnd) {
      this.k8sLogManager.off('end', this.onK8sLogEnd);
    }
    void this.k8sLogManager.stopAll();

    if (this.onK8sPortForwardChange) {
      this.k8sPortForwardManager.off('change', this.onK8sPortForwardChange);
    }
    void this.k8sPortForwardManager.stopAll();

    if (this.unsubscribeK8sConfig) {
      this.unsubscribeK8sConfig();
      this.unsubscribeK8sConfig = undefined;
    }

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

    for (const prompt of this.pendingDotfilesSyncPrompts.values()) {
      try {
        prompt.callback('ignore');
      } catch {
        // Ignore
      }
    }
    this.pendingDotfilesSyncPrompts.clear();

    for (const pending of this.pendingAwsSsoLogins.values()) {
      try {
        pending.cancel();
      } catch {
        // Ignore
      }
    }
    this.pendingAwsSsoLogins.clear();

    await this.sshPtyManager.killAll();
    await this.storageRegistry.disconnectAll?.();
    await this.fileEditorService.dispose();
    this.fileTailService.dispose();
    this.searchOrchestrator.dispose();
    if (this.autoSyncTimer) {
      clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    this.stopAutoPullTimer();
    // The PTY-exit listener that normally drives cleanupSmartcardSessionAgent()
    // was already detached above, so killAll() won't trigger it — kill every
    // remaining per-session ('agent-per-session' mode) private agent explicitly,
    // in addition to the global ones, or their ssh-agent processes and sockets
    // under ~/.ssh/agent leak past app quit.
    for (const sessionId of Array.from(this.smartcardSessionAgents.keys())) {
      this.cleanupSmartcardSessionAgent(sessionId);
    }
    this.lockAllGlobalSmartcardAgents();
    AgentLifecycleManager.killAllPrivateAgents();
    await AgentLifecycleManager.stopManagedAgent();
    await XServerManager.stopServer();
  }
}
