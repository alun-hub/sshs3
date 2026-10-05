import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ipcMain as electronIpcMain, app as electronApp, dialog as electronDialog, shell as electronShell } from 'electron';
import type { IpcMain } from 'electron';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { SSHPtyManager, type InternalSSHPtySession } from './ssh/SSHPtyManager';
import { withResolvedProxyJump } from './ssh/resolveProxyJump';
import { AgentLifecycleManager } from './ssh/AgentLifecycleManager';
import { AppAgent, fingerprintOfKeyBlob } from './ssh/AppAgent';
import { assignHostAliases, type AgentHostEntry } from './services/SshNativeFileMerger';
import { SmartcardDetector } from './smartcard/SmartcardDetector';
import { applyWindowsAgentPathFix, getWindowsAgentPathStatus } from './smartcard/WindowsAgentPath';
import {
  loadSmartcardIntoPrivateAgent,
  loadFido2ResidentKeysIntoPrivateAgent,
  pinPromptKind,
} from './smartcard/SmartcardAgentLoader';
import { generateFido2Key, listFido2ResidentKeys, deleteFido2ResidentKey } from './smartcard/Fido2KeyManager';
import type { AskpassPromptHandler, AskpassPromptRetryContext, AskpassServer } from './smartcard/AskpassServer';
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
import { ClipboardHistoryStore } from './clipboard/ClipboardHistoryStore';
import { SnippetStore } from './snippets/SnippetStore';
import { SNIPPET_MAX_NAME_CHARS } from '../shared/types/snippets';
import { SettingsStore } from './settings/SettingsStore';
import { UpdateService } from './update/UpdateService';
import { KnownHostsStore } from './ssh/KnownHostsStore';
import { createHostVerifier, type HostKeyPromptInfo } from './ssh/HostKeyVerifier';
import { installPublicKeys, probeHost, testLogin, verifyKeyLogin } from './ssh/KeyInstallService';
import { listFilePublicKeys, listAgentPublicKeys, dedupeKeys } from './ssh/PublicKeyDiscovery';
import { buildInstallCommand, parsePublicKeyLine } from './ssh/PublicKeyUtils';
import { DotfilePoolStore } from './dotfiles/DotfilePoolStore';
import { DotfileSyncService } from './dotfiles/DotfileSyncService';
import { defaultDotfileRemotePath } from '../shared/dotfilePath';
import { computeDiff as computeDirSyncDiff, apply as applyDirSync } from './dirsync/DirectorySyncService';
import { DirectorySyncProfileStore } from './dirsync/DirectorySyncProfileStore';
import { FileEditorService } from './editor/FileEditorService';
import { FileTailService } from './editor/FileTailService';
import { SearchOrchestrator } from './search/SearchOrchestrator';
import { K8sDiscoveryService } from './services/K8sDiscoveryService';
import { loginWithToken } from './services/K8sAuthService';
import { K8sDebugService } from './services/K8sDebugService';
import { K8sPortForwardManager } from './services/K8sPortForwardManager';
import { SSHTunnelManager } from './services/SSHTunnelManager';
import { K8sTerminalManager } from './terminal/K8sTerminalManager';
import { PerfMetricsService } from './services/PerfMetricsService';
import { K8sLogManager } from './terminal/K8sLogManager';
import { AwsSsoAuthService, AwsSsoLoginCancelledError } from './aws/AwsSsoAuthService';
import { SyncConfigStore, type SyncConfigData } from './services/SyncConfigStore';
import { SyncCryptoService, generateSalt } from './services/SyncCryptoService';
import { ProfileSyncService } from './services/ProfileSyncService';
import { importSshConfigFile } from './services/SshConfigImporter';
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
import { fetchGitPublicKeys } from './git/GitKeyFetcher';
import { GitConfigService } from './git/GitConfigService';
import { GitStatusService } from './git/GitStatusService';
import { RemoteGitService } from './git/RemoteGitService';
import { DotfileGitImporter } from './dotfiles/DotfileGitImporter';
import type {
  ConfigureGitSigningRequest,
  ConfigureGitSigningResult,
  DotfilesImportFromGitRequest,
  DotfilesImportFromGitResult,
  FetchGitKeysRequest,
  FetchGitKeysResult,
  GitCloneRequest,
  GitOperationResult,
  GitRepoStatus,
  GitSigningConfig,
  TestRemoteGitAccessRequest,
  TestRemoteGitAccessResult,
} from '../shared/types/git';
import type { SearchStartOptions } from '../shared/types/search';
import {
  IPC_CHANNELS,
  type StorageConnectConfig,
  type HostKeyPromptEvent,
  type PresencePromptEvent,
  type PresenceClearEvent,
  type TransferConflictPromptEvent,
  type TransferConflictResolution,
  type QuitConfirmPromptEvent,
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
  SSHTunnelConfig,
  SSHActiveTunnel,
  LocalPublicKey,
  ListPublicKeysRequest,
  InstallPublicKeysRequest,
  InstallPublicKeysResult,
  ProbeHostResult,
  TestLoginResult,
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

const DISPOSE_STEP_TIMEOUT_MS = 5000;

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

interface PendingQuitConfirmPrompt {
  callback: (proceed: boolean) => void;
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
  clipboardHistoryStore?: ClipboardHistoryStore;
  snippetStore?: SnippetStore;
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
  sshTunnelManager?: SSHTunnelManager;
  getWebContents?: () => Electron.WebContents | null | undefined;
  /** Quit confirmation (transfers, confirm-before-quit) run before an update restart. */
  confirmQuit?: () => Promise<boolean>;
}

export class IpcBridge {
  private ipcMain: IpcMain;
  public readonly sshPtyManager: SSHPtyManager;
  public readonly storageRegistry: StorageRegistry;
  public readonly transferQueue: TransferQueue;
  public readonly profileStore: ProfileStore;
  public readonly knownHostsStore: KnownHostsStore;
  public readonly sessionStore: SessionStore;
  public readonly clipboardHistoryStore: ClipboardHistoryStore;
  public readonly snippetStore: SnippetStore;
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
  private readonly perfMetricsService: PerfMetricsService;
  public readonly k8sLogManager: K8sLogManager;
  public readonly k8sPortForwardManager: K8sPortForwardManager;
  public readonly sshTunnelManager: SSHTunnelManager;
  private updateService: UpdateService | null = null;
  private confirmQuit: (() => Promise<boolean>) | undefined;
  private getWebContents: () => Electron.WebContents | null | undefined;

  private pendingAskpass = new Map<string, PendingAskpassPrompt>();
  private pendingHostKeyPrompts = new Map<string, PendingHostKeyPrompt>();
  private pendingTransferConflicts = new Map<string, PendingTransferConflictPrompt>();
  private pendingQuitConfirms = new Map<string, PendingQuitConfirmPrompt>();
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
  /**
   * The one app-wide ssh-agent for 'agent-global' mode (see AppAgent): every unlocked smartcard and
   * FIDO2 key lives in it, so a local shell can use all of them through a single SSH_AUTH_SOCK.
   */
  private appAgent = new AppAgent();
  /** pkcs11LibPath or '__fido2__' -> what that unlocked card/key contributed to the app agent (its key fingerprints), so keys can be attributed to a card. */
  private globalCards = new Map<string, { fingerprints: Set<string> }>();
  private agentConfigRefresh: Promise<void> = Promise.resolve();
  /** pkcs11LibPath or '__fido2__' -> in-flight load, so concurrent connections to the same card don't each prompt separately. */
  private globalSmartcardAgentLoads = new Map<string, Promise<string>>();
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
    retry?: AskpassPromptRetryContext;
    callback: (pin: string) => void;
  }) => void;
  private onPtyPresence?: (event: { sessionId: string; prompt: string }) => void;
  private onTransferProgress?: (progress: TransferProgress) => void;
  private onK8sTerminalData?: (event: { sessionId: string; data: string }) => void;
  private onK8sTerminalExit?: (event: { sessionId: string; status: string }) => void;
  private onK8sLogData?: (event: { sessionId: string; data: string }) => void;
  private onK8sLogEnd?: (event: { sessionId: string }) => void;
  private onK8sPortForwardChange?: (list: K8sActivePortForward[]) => void;
  private onSshTunnelChange?: (list: SSHActiveTunnel[]) => void;
  private onK8sConfigChanged?: () => void;
  private unsubscribeK8sConfig?: () => void;

  constructor(options: IpcBridgeOptions = {}) {
    this.ipcMain = options.ipcMain ?? electronIpcMain;
    this.settingsStore = options.settingsStore ?? new SettingsStore();
    this.sshPtyManager =
      options.sshPtyManager ??
      new SSHPtyManager({
        settingsStore: this.settingsStore,
        // Dead wiring: SSHPtyManager no longer reads isTunnelActive (terminal sessions don't
        // auto-start a profile's saved tunnels anymore, only the Tunnels panel does). Left in
        // place rather than removed — see SSHPtyManagerOptions.isTunnelActive.
        isTunnelActive: (connectionId, tunnelId) =>
          this.sshTunnelManager
            .listActive()
            .some((t) => t.connectionId === connectionId && t.tunnel.id === tunnelId),
      });
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
        sftpPresenceFactory: (cfg) => {
          const n = this.makePresenceNotifier(undefined, `Touch your security key to connect to ${cfg.name || cfg.host}`);
          return { onPresence: n.onPresenceRequested, onPresenceCleared: n.onPresenceCleared };
        },
        sftpPinPromptHandlerFactory: (cfg) => (prompt) =>
          this.promptForPinDirect(
            prompt.trim(),
            cfg.authType === 'fido2' ? 'fido2' : cfg.authType === 'smartcard' ? 'smartcard' : undefined,
            `SFTP: ${cfg.name || cfg.host}`
          ),
      });
    this.transferQueue = options.transferQueue ?? new TransferQueue();
    this.profileStore = options.profileStore ?? new ProfileStore();
    this.sessionStore = options.sessionStore ?? new SessionStore();
    this.clipboardHistoryStore = options.clipboardHistoryStore ?? new ClipboardHistoryStore();
    this.snippetStore = options.snippetStore ?? new SnippetStore();
    this.dotfilePoolStore = options.dotfilePoolStore ?? new DotfilePoolStore();
    this.dotfileSyncService = options.dotfileSyncService ?? new DotfileSyncService();
    this.directorySyncProfileStore = options.directorySyncProfileStore ?? new DirectorySyncProfileStore();
    this.fileEditorService = options.fileEditorService ?? new FileEditorService();
    this.fileTailService = options.fileTailService ?? new FileTailService();
    this.searchOrchestrator = options.searchOrchestrator ?? new SearchOrchestrator();
    this.awsSsoAuthService = options.awsSsoAuthService ?? new AwsSsoAuthService();
    // Prompts the app agent itself raises later (e.g. a verify-required FIDO2 signature) — loads
    // prompt through their own askpass server and never come through here.
    this.appAgent.setHandlers({
      promptHandler: (prompt, retry) =>
        this.promptForPinDirect(
          prompt.trim(),
          pinPromptKind(prompt),
          'App ssh-agent',
          retry
        ),
      onPresence: () => {
        const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
          undefined,
          'Touch your security key to continue'
        );
        onPresenceRequested();
        setTimeout(onPresenceCleared, 20_000).unref?.();
      },
    });
    this.appAgent.setOnExit(() => {
      this.globalCards.clear();
      this.globalSmartcardCerts.clear();
      this.refreshAgentSshConfig();
    });
    this.syncConfigStore = options.syncConfigStore ?? new SyncConfigStore();
    this.syncCryptoService = options.syncCryptoService ?? new SyncCryptoService();
    this.profileSyncService =
      options.profileSyncService ??
      new ProfileSyncService(this.profileStore, this.dotfilePoolStore, this.settingsStore, this.syncCryptoService, {
        directorySyncProfileStore: this.directorySyncProfileStore,
      });
    this.k8sDiscoveryService = options.k8sDiscoveryService ?? new K8sDiscoveryService();
    this.k8sDebugService = options.k8sDebugService ?? new K8sDebugService();
    this.k8sTerminalManager = options.k8sTerminalManager ?? new K8sTerminalManager();
    this.perfMetricsService = new PerfMetricsService((sessionId) => {
      const session = this.sshPtyManager.getSession(sessionId);
      return session
        ? {
            host: session.config.host,
            controlPath: session.controlPath,
            config: session.config,
            askpassEnv: (session as InternalSSHPtySession).askpassServer?.getEnv(),
          }
        : undefined;
    });
    this.k8sLogManager = options.k8sLogManager ?? new K8sLogManager();
    this.k8sPortForwardManager = options.k8sPortForwardManager ?? new K8sPortForwardManager();
    this.sshTunnelManager = options.sshTunnelManager ?? new SSHTunnelManager();
    this.getWebContents = options.getWebContents ?? (() => null);
    this.confirmQuit = options.confirmQuit;
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
    this.registerClipboardHistoryHandlers();
    this.registerSnippetHandlers();
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
    this.registerKeyInstallHandlers();
    this.registerGitHandlers();
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

  /**
   * Defense-in-depth (not currently exploitable): window creation and
   * navigation are already locked down (see setWindowOpenHandler/
   * will-navigate in src/main/index.ts), so today the main window's own
   * frame is the only thing that can ever call an IPC handler. But this
   * privileged API surface — ~90 methods reachable from the renderer,
   * including local filesystem access, SSH/S3 credentials, and arbitrary
   * command execution helpers — should not rely on that holding forever. A
   * future regression that lets a second frame or a <webview> load
   * untrusted content would otherwise expose the entire API to it with no
   * additional check. getWebContents() returning null/undefined (as in
   * tests, where it's often not wired up) skips the check rather than
   * failing every handler.
   */
  private assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
    const webContents = this.getWebContents();
    if (!webContents || webContents.isDestroyed()) return;
    if (event.senderFrame !== webContents.mainFrame) {
      throw new Error('Rejected IPC call from an untrusted frame');
    }
  }

  private registerHandler(channel: string, handler: (...args: any[]) => any): void {
    // async, not a plain arrow function: assertTrustedSender's throw must
    // surface as a rejected promise (what ipcMain.invoke's caller expects)
    // rather than a synchronous exception out of the handle() dispatch.
    this.ipcMain.handle(channel, async (event, ...args) => {
      this.assertTrustedSender(event);
      return handler(event, ...args);
    });
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
          config = await this.restoreSavedSecrets(config);
          config = await this.resolveProxyJumpConfig(config);
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
          const settings = await this.settingsStore.getSettings().catch(() => null);
          const agentMode = settings?.localTerminalAgentMode ?? 'auto';
          if (agentMode === 'auto' || agentMode === 'app-managed') {
            const globalAgentSocket = await this.resolveLocalShellAgentSocket(settings?.smartcardAuthMode);
            if (globalAgentSocket) {
              ptyOptions = { ...ptyOptions, env: { SSH_AUTH_SOCK: globalAgentSocket, ...ptyOptions?.env } };
            }
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

    // Only modules the app itself detected may be acted on: the fix edits the *system* PATH, so an
    // arbitrary renderer-supplied path must never reach it.
    const requireDetectedLib = async (libPath: string): Promise<string> => {
      const detected = await SmartcardDetector.detectAvailableLibraries(undefined, { onlyExisting: true });
      const match = detected.find((l) => l.path.toLowerCase() === String(libPath).toLowerCase());
      if (!match) throw new Error('Not a detected smartcard library.');
      return match.path;
    };

    this.registerHandler(IPC_CHANNELS.SMARTCARD_AGENT_PATH_STATUS, async (_event, libPath: string) => {
      if (process.platform !== 'win32') return { applicable: false, needsFix: false };
      try {
        return await getWindowsAgentPathStatus(await requireDetectedLib(libPath));
      } catch {
        return { applicable: false, needsFix: false };
      }
    });

    this.registerHandler(IPC_CHANNELS.SMARTCARD_AGENT_PATH_FIX, async (_event, libPath: string) => {
      const libDir = path.dirname(await requireDetectedLib(libPath));
      await applyWindowsAgentPathFix(libDir);
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
      return { locked: await this.lockAllGlobalSmartcardAgents() };
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
    context?: string,
    retry?: AskpassPromptRetryContext
  ): Promise<string> {
    return new Promise((resolve) => {
      const webContents = this.getWebContents();
      if (!webContents || webContents.isDestroyed?.()) {
        resolve('');
        return;
      }

      const id = crypto.randomUUID();
      this.pendingAskpass.set(id, { callback: resolve });
      webContents.send(IPC_CHANNELS.ASKPASS_PROMPT, {
        id,
        prompt,
        kind,
        context,
        error: retry?.error,
        attempt: retry?.attempt,
        maxAttempts: retry?.maxAttempts,
      });
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

  /**
   * UX audit finding #2: asks the renderer to show its own themed
   * ConfirmDialog instead of a native `dialog.showMessageBoxSync` box, so
   * quitting looks and behaves like every other confirmation in the app.
   * Resolves to `true` (proceed with quitting) if no window is available to
   * prompt — matches the previous native-dialog fallback behavior.
   */
  public promptQuitConfirm(info: Omit<QuitConfirmPromptEvent, 'id'>): Promise<boolean> {
    return new Promise((resolve) => {
      const webContents = this.getWebContents();
      if (!webContents || webContents.isDestroyed?.()) {
        resolve(true);
        return;
      }

      const id = crypto.randomUUID();
      this.pendingQuitConfirms.set(id, { callback: resolve });

      const event: QuitConfirmPromptEvent = { id, ...info };
      webContents.send(IPC_CHANNELS.QUIT_CONFIRM_PROMPT, event);
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
          let sftpConfig = await this.resolveProxyJumpConfig(config.sftpConfig);
          sftpConfig = await this.prepareSftpSmartcardConfig(sftpConfig, config.id);
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

    this.registerHandler(
      IPC_CHANNELS.STORAGE_GET_HOMEDIR,
      async (_event, providerId: string): Promise<string> => {
        const provider = this.storageRegistry.get(providerId);
        if (!provider) {
          throw new Error(`Storage provider not found: ${providerId}`);
        }
        if (typeof provider.getHomeDir === 'function') {
          return await provider.getHomeDir();
        }
        if (provider.type === 'local') {
          return os.homedir();
        }
        return '/';
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
          verifyIntegrity?: boolean;
          verifyChecksum?: boolean | 'sha256' | 'md5';
          expectedChecksum?: string;
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

        const settings = await this.settingsStore.getSettings();
        const verifyIntegrity = options.verifyIntegrity ?? settings.verifyTransferIntegrity ?? true;

        const job = this.transferQueue.addJob({
          sourceProvider,
          sourcePath: options.sourcePath,
          targetProvider,
          targetPath: resolvedTargetPath,
          isDirectory,
          totalBytes,
          verifyIntegrity,
          verifyChecksum: options.verifyChecksum,
          expectedChecksum: options.expectedChecksum,
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

    this.registerHandler(
      IPC_CHANNELS.QUIT_CONFIRM_RESPOND,
      async (_event, id: string, proceed: boolean) => {
        const prompt = this.pendingQuitConfirms.get(id);
        if (!prompt) {
          throw new Error(`Quit confirm prompt with id "${id}" not found or expired`);
        }
        this.pendingQuitConfirms.delete(id);
        prompt.callback(Boolean(proceed));
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
        // The file manager caches one live provider per profile id; drop it so the next connect uses the edited settings.
        await this.storageRegistry.disconnect?.(`sftp-${config.id}`);
        this.scheduleAutoSync();
        void this.profileSyncService.autoSyncLocalSshConfig();
        this.refreshAgentSshConfig();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_DELETE_SSH,
      async (_event, id: string) => {
        await this.profileStore.deleteSSH(id);
        await this.storageRegistry.disconnect?.(`sftp-${id}`);
        this.scheduleAutoSync();
        void this.profileSyncService.autoSyncLocalSshConfig();
        this.refreshAgentSshConfig();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_SAVE_S3,
      async (_event, config: S3Config) => {
        await this.profileStore.saveS3(config);
        // The file manager caches one live provider per profile id; drop it so the next connect uses the edited settings.
        await this.storageRegistry.disconnect?.(`s3-${config.id}`);
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_DELETE_S3,
      async (_event, id: string) => {
        await this.profileStore.deleteS3(id);
        await this.storageRegistry.disconnect?.(`s3-${id}`);
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_SAVE_FOLDER,
      async (_event, name: string) => {
        await this.profileStore.saveFolder(name);
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_DELETE_FOLDER,
      async (_event, name: string, deleteProfiles?: boolean) => {
        await this.profileStore.deleteFolder(name, Boolean(deleteProfiles));
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_RENAME_FOLDER,
      async (_event, oldName: string, newName: string) => {
        await this.profileStore.renameFolder(oldName, newName);
        this.scheduleAutoSync();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_IMPORT_SSH_CONFIG,
      async () => {
        // No caller-supplied path (H4, code review): always the real
        // ~/.ssh/config, never an arbitrary path an untrusted renderer
        // could name.
        return await importSshConfigFile();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_EXPORT_JSON,
      async () => {
        // Always resolved via the save dialog (H4, code review) — never a
        // caller-supplied path, which would let an untrusted renderer
        // overwrite an arbitrary file on disk.
        const dateStr = new Date().toISOString().slice(0, 10);
        const result = await electronDialog.showSaveDialog({
          title: 'Export Profiles',
          defaultPath: `sshs3-profiles-${dateStr}.json`,
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return null;
        const exportPath = result.filePath;

        const profiles = await this.profileStore.getProfiles();
        const exportData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          folders: profiles.folders || [],
          ssh: profiles.ssh.map((p) => {
            const { password: _pw, passphrase: _pp, ...rest } = p;
            if (rest.proxy && 'password' in rest.proxy) {
              const { password: _proxyPw, ...proxyRest } = rest.proxy;
              return { ...rest, proxy: proxyRest };
            }
            return rest;
          }),
          s3: profiles.s3.map((p) => {
            const { secretAccessKey: _sec, sessionToken: _tok, ...rest } = p;
            if (rest.proxy && 'password' in rest.proxy) {
              const { password: _proxyPw, ...proxyRest } = rest.proxy;
              return { ...rest, proxy: proxyRest };
            }
            return rest;
          }),
        };

        await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf-8');
        return { count: profiles.ssh.length + profiles.s3.length, filePath: exportPath };
      }
    );

    this.registerHandler(
      IPC_CHANNELS.PROFILES_IMPORT_JSON,
      async () => {
        // Always resolved via the open dialog (H4, code review) — never a
        // caller-supplied path, which would let an untrusted renderer read
        // an arbitrary file on disk and have it parsed/merged as profiles.
        const result = await electronDialog.showOpenDialog({
          title: 'Import Profiles JSON',
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return { count: 0 };
        const importPath = result.filePaths[0];

        const content = await fs.readFile(importPath, 'utf-8');
        const parsed = JSON.parse(content);
        const sshList = Array.isArray(parsed.ssh) ? parsed.ssh : [];
        const s3List = Array.isArray(parsed.s3) ? parsed.s3 : [];
        const foldersList = Array.isArray(parsed.folders) ? parsed.folders : [];

        let count = 0;
        for (const f of foldersList) {
          if (typeof f === 'string' && f.trim()) {
            await this.profileStore.saveFolder(f.trim()).catch(() => {});
          }
        }
        for (const ssh of sshList) {
          if (ssh && typeof ssh === 'object' && ssh.host) {
            const id = ssh.id || crypto.randomUUID();
            await this.profileStore.saveSSH({ ...ssh, id });
            count++;
          }
        }
        for (const s3 of s3List) {
          if (s3 && typeof s3 === 'object' && s3.name) {
            const id = s3.id || crypto.randomUUID();
            await this.profileStore.saveS3({ ...s3, id });
            count++;
          }
        }

        this.scheduleAutoSync();
        if (sshList.length > 0) {
          void this.profileSyncService.autoSyncLocalSshConfig();
          this.refreshAgentSshConfig();
        }
        return { count };
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
        title: 'Select files to add to the pool',
        defaultPath: os.homedir(),
        properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return [];
      }
      return await this.dotfilePoolStore.importLocalFiles(result.filePaths);
    });

    // Re-reads local source files of pooled entries (status check / Refresh).
    // Files that are missing or no longer importable are simply absent.
    this.registerHandler(IPC_CHANNELS.DOTFILES_READ_SOURCES, async (_event, paths: string[]) => {
      if (!Array.isArray(paths) || paths.length > 500 || !paths.every((p) => typeof p === 'string')) {
        throw new Error('Invalid source path list');
      }
      return await this.dotfilePoolStore.importLocalFiles(paths);
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

        const remotePath =
          options.targetRemotePath || defaultDotfileRemotePath(options.filePath, os.homedir());

        const added = await this.dotfilePoolStore.addFileToPool(options.poolId, {
          remotePath,
          content,
          mode,
          sourcePath: provider.type === 'local' ? options.filePath : undefined,
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
  /**
   * Restored tabs have their password/passphrase stripped from the persisted session state
   * (see sanitizePaneNode in the renderer) and get a fresh id per terminal, so a saved
   * credential is looked up again here by connection identity. Secrets never leave main.
   */
  private async restoreSavedSecrets(config: SSHConnectionConfig): Promise<SSHConnectionConfig> {
    const needsPassword = config.authType === 'password' && !config.password;
    const needsPassphrase = config.authType === 'privateKey' && !config.passphrase && !!config.privateKeyPath;
    if (!needsPassword && !needsPassphrase) return config;

    const { ssh } = await this.profileStore.getProfiles();
    const match = ssh.find(
      (p) =>
        p.host === config.host &&
        (p.port ?? 22) === (config.port ?? 22) &&
        p.username === config.username &&
        p.authType === config.authType &&
        (needsPassword ? !!p.password : p.privateKeyPath === config.privateKeyPath && !!p.passphrase)
    );
    if (!match) return config;
    return needsPassword ? { ...config, password: match.password } : { ...config, passphrase: match.passphrase };
  }

  private async resolveProxyJumpConfig<T extends { proxyJumpProfileId?: string; proxyJump?: string }>(
    config: T
  ): Promise<T> {
    if (!config.proxyJumpProfileId) return config;
    const profiles = await this.profileStore.getProfiles();
    const byId = new Map(profiles.ssh.map((p) => [p.id, p]));
    if (!byId.has(config.proxyJumpProfileId)) {
      console.warn(
        `[ssh] ProxyJump profile ${config.proxyJumpProfileId} not found; connecting ${config.proxyJump ? 'via the manual proxyJump string' : 'WITHOUT a jump host'}`
      );
    }
    return withResolvedProxyJump(config, (id) => byId.get(id));
  }

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
    return agentPath
      ? { ...configWithId, agentPath, ...(await this.agentIdentityFilesFor(agentPath, config.pkcs11LibPath)) }
      : configWithId;
  }

  /**
   * When `agentPath` is the shared app agent (which holds every unlocked card), the public key files
   * that pin a connection to just this card's keys (see SSHConnectionConfig.agentIdentityFiles).
   * Empty for a private per-session agent, which holds only this card, and on Windows.
   */
  private async agentIdentityFilesFor(
    agentPath: string,
    cardKey: string
  ): Promise<{ agentIdentityFiles?: string[] }> {
    const card = this.globalCards.get(cardKey);
    if (!card || agentPath !== this.appAgent.getSocketPath()) return {};
    try {
      const files = await this.appAgent.writePublicKeyFiles(card.fingerprints);
      return files.length > 0 ? { agentIdentityFiles: files } : {};
    } catch (err) {
      console.warn('[app-agent] could not write identity files; the connection will offer all agent keys:', err);
      return {};
    }
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
    return agentPath ? { ...configWithId, agentPath, ...(await this.agentIdentityFilesFor(agentPath, '__fido2__')) } : configWithId;
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
    return agentPath
      ? { ...config, agentPath, ...(await this.agentIdentityFilesFor(agentPath, config.pkcs11LibPath)) }
      : config;
  }

  /**
   * Opens (or reuses) the remote-profile-sync storage provider. Unlike the file manager's
   * STORAGE_CONNECT, the sync target used to be created straight from its saved config, so a
   * smartcard/FIDO2 target ignored the already-unlocked agent and opened its own PKCS#11 session
   * (often via a different library than the one the card was unlocked with) — surfacing a second
   * PIN prompt whose answer then fell through to a password prompt and failed.
   */
  private async getSyncProvider(target: StorageConnectConfig): ReturnType<StorageRegistry["getOrCreate"]> {
    // Windows-only: Linux keeps creating the sync provider straight from its saved config.
    if (process.platform !== 'win32' || target.type !== 'sftp' || !target.sftpConfig || this.storageRegistry.has(target.id)) {
      return await this.storageRegistry.getOrCreate(target);
    }
    let sftpConfig = await this.resolveProxyJumpConfig(target.sftpConfig);
    if (sftpConfig.authType === 'smartcard' && !sftpConfig.agentPath) {
      // Same physical card as an already-unlocked terminal/startup agent: reuse it rather than
      // opening a second PKCS#11 session (the card's PIV keys are the same whichever library
      // loaded them).
      const unlockedSocket = Array.from(this.globalCards.keys()).some((key) => key !== '__fido2__')
        ? this.appAgent.getSocketPath()
        : null;
      if (unlockedSocket) {
        sftpConfig = { ...sftpConfig, agentPath: unlockedSocket };
      }
    }
    sftpConfig = await this.prepareSftpSmartcardConfig(sftpConfig, target.id);
    sftpConfig = await this.prepareFido2SftpConfig(sftpConfig, target.id);
    return await this.storageRegistry.getOrCreate({ ...target, sftpConfig });
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
    return agentPath ? { ...config, agentPath, ...(await this.agentIdentityFilesFor(agentPath, '__fido2__')) } : config;
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
      const promptPin = (rawPrompt: string, retry?: AskpassPromptRetryContext) =>
        pinPromptKind === 'direct'
          ? this.promptForPinDirect(rawPrompt.trim(), 'fido2', promptLabel, retry)
          : this.sshPtyManager.promptForPin(sessionId, rawPrompt.trim(), 'fido2', promptLabel, retry);

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
   * Returns the app agent's socket after making sure the connected security key's FIDO2 resident
   * credentials are loaded into it (prompting for the PIN once if they aren't). Concurrent callers
   * share the same in-flight load rather than each prompting separately.
   */
  private async getOrLoadGlobalFido2Agent(
    sessionId: string,
    promptLabel: string,
    pinPromptKind: 'pty' | 'direct' = 'pty'
  ): Promise<string> {
    if (this.globalCards.has('__fido2__')) {
      const socketPath = await this.appAgent.ensure();
      if (this.globalCards.has('__fido2__')) {
        console.log('[fido2] getOrLoadGlobalFido2Agent: reusing the app agent');
        return socketPath;
      }
    }

    const lastFailedAt = this.globalSmartcardAgentFailures.get('__fido2__');
    if (lastFailedAt && Date.now() - lastFailedAt < 30000) {
      console.log('[fido2] getOrLoadGlobalFido2Agent: skipping load (failed recently)');
      throw new Error('FIDO2 agent load failed recently; cooling down');
    }

    const inFlight = this.globalSmartcardAgentLoads.get('__fido2__');
    if (inFlight) {
      console.log('[fido2] getOrLoadGlobalFido2Agent: awaiting in-flight load');
      return await inFlight;
    }

    console.log('[fido2] getOrLoadGlobalFido2Agent: loading FIDO2 resident keys into the app agent');
    const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
      sessionId,
      'Touch your security key to connect'
    );

    const promptPin = (rawPrompt: string, retry?: AskpassPromptRetryContext) =>
      pinPromptKind === 'direct'
        ? this.promptForPinDirect(rawPrompt.trim(), 'fido2', promptLabel, retry)
        : this.sshPtyManager.promptForPin(sessionId, rawPrompt.trim(), 'fido2', promptLabel, retry);

    const loadPromise = (async () => {
      await this.appAgent.addFido2Resident(promptPin, { onPresenceRequested, onPresenceCleared });
      const socketPath = await this.appAgent.ensure();
      // Every security-key (`*-SK`) identity in the agent belongs to FIDO2; PIV keys never are.
      const identities = await this.appAgent.list();
      this.globalCards.set('__fido2__', {
        fingerprints: new Set(identities.filter((i) => /-SK$/i.test(i.keyType)).map((i) => i.fingerprint)),
      });
      this.refreshAgentSshConfig();
      return socketPath;
    })();
    this.globalSmartcardAgentLoads.set('__fido2__', loadPromise);

    try {
      const socketPath = await loadPromise;
      this.globalSmartcardAgentFailures.delete('__fido2__');
      console.log(`[fido2] getOrLoadGlobalFido2Agent: loaded OK, socket=${socketPath}`);
      return socketPath;
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
   * Returns the app agent's socket after making sure the given PKCS#11 library's card is loaded into
   * it (prompting for the PIN once if it isn't). Concurrent callers for the same library share the
   * same in-flight load rather than each prompting separately.
   */
  private async getOrLoadGlobalSmartcardAgent(
    pkcs11LibPath: string,
    sessionIdOrPinPrompt: string | AskpassPromptHandler,
    promptLabel?: string
  ): Promise<string> {
    if (this.globalCards.has(pkcs11LibPath)) {
      const socketPath = await this.appAgent.ensure();
      // ensure() drops all card state if it had to restart a dead agent.
      if (this.globalCards.has(pkcs11LibPath)) {
        console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: reusing the app agent for ${pkcs11LibPath}`);
        return socketPath;
      }
    }

    const lastFailedAt = this.globalSmartcardAgentFailures.get(pkcs11LibPath);
    if (lastFailedAt && Date.now() - lastFailedAt < 30000) {
      console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: skipping load for ${pkcs11LibPath} (failed recently)`);
      throw new Error(`Smartcard load for ${pkcs11LibPath} failed recently; cooling down`);
    }

    const inFlight = this.globalSmartcardAgentLoads.get(pkcs11LibPath);
    if (inFlight) {
      console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: awaiting in-flight load for ${pkcs11LibPath}`);
      return await inFlight;
    }

    console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: loading ${pkcs11LibPath} into the app agent`);
    const pinHandler =
      typeof sessionIdOrPinPrompt === 'function'
        ? sessionIdOrPinPrompt
        : (_prompt: string, retry?: AskpassPromptRetryContext) =>
            this.sshPtyManager.promptForPin(
              sessionIdOrPinPrompt,
              `Enter your smartcard PIN to ${promptLabel}:`,
              'smartcard',
              promptLabel,
              retry
            );

    const loadPromise = (async () => {
      // Read the certificate details *before* handing the module to `ssh-add -s` below (see
      // the doc comment on `globalSmartcardCerts` for why we want them at all). This must run
      // strictly before, not concurrently with or fire-and-forget after: once `ssh-add -s`
      // succeeds, the agent keeps the PKCS#11 module initialized and the token open for as long
      // as it lives, and opening a second, independent PKCS#11 session against the same physical
      // token from this (separate) process while that first one is live crashed the vendor's
      // Net iD module outright (SIGTRAP inside the driver, observed right at startup's
      // auto-unlock). No PIN/session is needed to read certs (they're public objects, see
      // readSmartcardCertificates' doc comment), so doing this first is safe and guarantees
      // we're never more than one process talking to the token at a time.
      let certs = new Map<string, SmartcardCertificateDetails>();
      try {
        certs = await readSmartcardCertificates(pkcs11LibPath);
        this.globalSmartcardCerts.set(pkcs11LibPath, certs);
      } catch (err) {
        console.warn(`[smartcard] failed to read certificate details for ${pkcs11LibPath}:`, err);
      }
      await this.appAgent.ensure();
      const before = new Set((await this.appAgent.list()).map((i) => i.fingerprint));
      // The same physical card is often reachable through several modules (p11-kit-proxy proxies
      // libykcs11, OpenSC, …). If one of this module's keys is already in the agent, loading it again
      // would prompt for the PIN a second time and open a second PKCS#11 session against the same
      // token (which most readers reject), for keys the agent already holds.
      const alreadyLoaded = Array.from(certs.keys()).filter((fingerprint) => before.has(fingerprint));
      if (alreadyLoaded.length > 0) {
        console.log(
          `[smartcard] getOrLoadGlobalSmartcardAgent: ${pkcs11LibPath} is the same card as one already loaded; not loading it again`
        );
        this.globalCards.set(pkcs11LibPath, { fingerprints: new Set(certs.keys()) });
        this.refreshAgentSshConfig();
        return await this.appAgent.ensure();
      }
      await this.addSmartcardToAppAgentWithPresence(
        pkcs11LibPath,
        pinHandler,
        typeof sessionIdOrPinPrompt === 'string' ? sessionIdOrPinPrompt : undefined
      );
      const socketPath = await this.appAgent.ensure();
      // Which keys are this card's: its certificates' fingerprints; if those couldn't be read, whatever
      // this add contributed (excluding security keys, which belong to FIDO2).
      const fingerprints = new Set(certs.keys());
      if (fingerprints.size === 0) {
        const nonSecurityKeys = (await this.appAgent.list()).filter((i) => !/-SK$/i.test(i.keyType));
        for (const i of nonSecurityKeys) {
          if (!before.has(i.fingerprint)) fingerprints.add(i.fingerprint);
        }
        // The add contributed nothing new (the same key was already there, e.g. loaded via another
        // module for the same card): attribute every non-security key rather than none at all.
        if (fingerprints.size === 0) nonSecurityKeys.forEach((i) => fingerprints.add(i.fingerprint));
      }
      this.globalCards.set(pkcs11LibPath, { fingerprints });
      this.refreshAgentSshConfig();
      return socketPath;
    })();
    this.globalSmartcardAgentLoads.set(pkcs11LibPath, loadPromise);

    try {
      const socketPath = await loadPromise;
      this.globalSmartcardAgentFailures.delete(pkcs11LibPath);
      console.log(`[smartcard] getOrLoadGlobalSmartcardAgent: loaded OK for ${pkcs11LibPath}, socket=${socketPath}`);
      return socketPath;
    } catch (err) {
      this.globalSmartcardAgentFailures.set(pkcs11LibPath, Date.now());
      throw err;
    } finally {
      this.globalSmartcardAgentLoads.delete(pkcs11LibPath);
    }
  }

  /** Same presence banner as loadSmartcardIntoPrivateAgentWithPresence, but loading into the app agent. */
  private addSmartcardToAppAgentWithPresence(
    pkcs11LibPath: string,
    promptHandler: AskpassPromptHandler,
    sessionId?: string
  ): Promise<void> {
    const { onPresenceRequested, onPresenceCleared } = this.makePresenceNotifier(
      sessionId,
      'Touch your YubiKey / smartcard to confirm'
    );
    return this.appAgent.addPkcs11(pkcs11LibPath, promptHandler, { onPresenceRequested, onPresenceCleared });
  }

  /**
   * Keeps the local agent block in ~/.ssh/config (see writeAgentSshConfigBlock) in step with what is
   * unlocked, so a plain `ssh <alias>` in any terminal uses the app agent instead of asking for the
   * card's PIN itself. Serialized, fire-and-forget, never throws.
   */
  public refreshAgentSshConfig(): void {
    this.agentConfigRefresh = this.agentConfigRefresh
      .then(async () => {
        await this.profileSyncService.syncAgentBlockToLocalSshConfig(await this.buildAgentHostEntries());
      })
      .catch((err) => console.warn('[app-agent] could not refresh the ~/.ssh/config agent block:', err));
  }

  /**
   * Hosts to point at the app agent: SSH profiles whose card (PIV library, or FIDO2 resident key) is
   * unlocked in it. Null (⇒ block removed) unless 'agent-global' mode is on and the agent holds a card.
   * Not on Windows (shared OpenSSH service, no key selection there).
   */
  private async buildAgentHostEntries(): Promise<AgentHostEntry[] | null> {
    if (process.platform === 'win32') return null;
    const settings = await this.settingsStore.getSettings().catch(() => null);
    const socketPath = this.appAgent.getSocketPath();
    if (settings?.smartcardAuthMode !== 'agent-global' || !socketPath || this.globalCards.size === 0) return null;

    const { ssh } = await this.profileStore.getProfiles();
    const aliases = assignHostAliases(ssh);
    const entries: AgentHostEntry[] = [];
    for (const profile of ssh) {
      const cardKey =
        profile.authType === 'smartcard' && profile.pkcs11LibPath
          ? profile.pkcs11LibPath
          : profile.authType === 'fido2' && profile.fido2Resident
            ? '__fido2__'
            : undefined;
      const card = cardKey ? this.globalCards.get(cardKey) : undefined;
      const alias = aliases.get(profile.id);
      if (!card || !alias) continue;
      const identityFiles = await this.appAgent.writePublicKeyFiles(card.fingerprints);
      if (identityFiles.length > 0) entries.push({ alias, agentSocket: socketPath, identityFiles });
    }
    return entries;
  }

  /**
   * The SSH_AUTH_SOCK a local shell should get under 'agent-global' PIN caching: always the app agent
   * (even while empty, so a card unlocked later is usable from terminals that are already open). On
   * Windows the app agent is the shared system service, so only hand it out once a card is cached.
   * Undefined in every other mode, or if the agent can't be started (the shell then keeps the default).
   */
  private async resolveLocalShellAgentSocket(smartcardAuthMode: string | undefined): Promise<string | undefined> {
    if (smartcardAuthMode !== 'agent-global') return undefined;
    if (process.platform === 'win32' && this.globalCards.size === 0) return undefined;
    try {
      return await this.appAgent.ensure();
    } catch (err) {
      console.warn('[app-agent] could not start for a local shell; using the default agent:', err);
      return undefined;
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
    // Assign the guard promise synchronously, before any awaits, so a concurrent restored
    // terminal session's TERMINAL_CREATE (which awaits `this.startupUnlockPromise` at line
    // ~395) always has something to wait on from the very first tick of this call — closing
    // the TOCTOU gap where a restored pane could otherwise race ahead of the async
    // settings/profile/session detection below (previously done before the guard was assigned)
    // and fall through to a fresh PIN prompt, even though a startup unlock was about to happen.
    // The guard resolves once the real unlock work finishes (or immediately if none is needed);
    // it does NOT gate this function's own return, which still resolves as soon as detection
    // decides whether an unlock was started, same as before — callers of this IPC handler don't
    // wait for the PIN to actually be entered, only concurrent session creation does.
    let resolveGuard!: () => void;
    const guardPromise = new Promise<void>((resolve) => {
      resolveGuard = resolve;
    });
    this.startupUnlockPromise = guardPromise;
    void guardPromise.finally(() => {
      if (this.startupUnlockPromise === guardPromise) {
        this.startupUnlockPromise = undefined;
      }
    });

    let unlockKickedOff = false;
    try {
      return await this.runSmartcardStartupUnlockWork((unlockPromise) => {
        unlockKickedOff = true;
        void unlockPromise.finally(resolveGuard);
      });
    } finally {
      if (!unlockKickedOff) {
        resolveGuard();
      }
    }
  }

  private async runSmartcardStartupUnlockWork(
    onUnlockStarted: (unlockPromise: Promise<void>) => void
  ): Promise<{ started: boolean }> {
    const settings = await this.settingsStore.getSettings();
    if (!settings.smartcardUnlockAtStartup || (settings.smartcardAuthMode ?? 'always-prompt') !== 'agent-global') {
      return { started: false };
    }

    const libs = await SmartcardDetector.detectAvailableLibraries(undefined, { onlyExisting: true });
    const preferred = settings.smartcardLibPath ? libs.find((lib) => lib.path === settings.smartcardLibPath) : undefined;
    const chosen =
      preferred ?? libs.find((lib) => lib.name === 'p11-kit') ?? (libs.length === 1 ? libs[0] : undefined);

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

    // A driver the user explicitly picked in Settings wins over the per-profile library paths:
    // otherwise an existing profile's own path (e.g. OpenSC) would silently override the choice and
    // unlock the wrong driver. Profiles using a different driver are still unlocked on demand.
    if (preferred) {
      targetSmartcardPaths.clear();
      targetSmartcardPaths.add(preferred.path);
      hasSmartcard = true;
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
      (p) => !this.globalCards.has(p) && !this.globalSmartcardAgentLoads.has(p)
    );

    // Windows' OpenSSH can't load resident FIDO2 keys (`ssh-add -K` always fails there), and its
    // FIDO2 profiles use a key file signed via WebAuthn instead — nothing to unlock at startup, so
    // don't ask for a PIN just to show an error.
    if (process.platform === 'win32') hasFido2 = false;

    if (!hasFido2 && (!hasSmartcard || validPathsToUnlock.length === 0)) {
      return { started: false };
    }

    const fido2Active = this.globalCards.has('__fido2__') || this.globalSmartcardAgentLoads.has('__fido2__');
    const smartcardActive = !hasSmartcard || pathsNeedingUnlock.length === 0;
    if ((!hasFido2 || fido2Active) && smartcardActive) {
      return { started: false };
    }

    const unlockPromise = (async () => {
      // 1. Smartcard / PIV unlock first (if detected and not yet active)
      if (hasSmartcard && pathsNeedingUnlock.length > 0) {
        try {
          console.log(
            `[smartcard] Startup unlock: loading Smartcard into global agent for ${pathsNeedingUnlock.join(', ')}...`
          );
          let transientPin: string | null = null;
          const startupPinPrompt = async (_prompt: string, retry?: AskpassPromptRetryContext) => {
            if (!retry && transientPin !== null) {
              return transientPin;
            }
            transientPin = await this.promptForPinDirect(
              'Enter your smartcard PIN to unlock it for this app session:',
              'smartcard',
              'Startup: Global Agent Cache',
              retry
            );
            return transientPin;
          };

          try {
            for (const libPath of pathsNeedingUnlock) {
              try {
                await this.getOrLoadGlobalSmartcardAgent(libPath, startupPinPrompt);
                this.sendSmartcardStartupUnlockStatus({ kind: 'smartcard', status: 'unlocked', libPath });
              } catch (err) {
                console.warn(`[smartcard] Startup unlock failed for ${libPath}:`, err);
                this.sendSmartcardStartupUnlockStatus({
                  kind: 'smartcard',
                  status: 'error',
                  libPath,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          } finally {
            transientPin = null;
          }
        } catch (err) {
          console.warn('[smartcard] Startup unlock failed or cancelled:', err);
        }
      }

      // 2. FIDO2 resident keys unlock last (if configured and not yet active). A FIDO2 key that needs
      // PIN+touch per signature (verify-required) can only be asked for one once it is in the agent, so
      // loading it after the PIV card keeps those prompts out of the way of the PIV load.
      if (hasFido2 && !this.globalCards.has('__fido2__') && !this.globalSmartcardAgentLoads.has('__fido2__')) {
        try {
          console.log('[fido2] Startup unlock: loading FIDO2 resident keys into global agent...');
          await this.getOrLoadGlobalFido2Agent('startup', 'Startup: Global Agent Cache', 'direct');
          this.sendSmartcardStartupUnlockStatus({ kind: 'fido2', status: 'unlocked' });
        } catch (err) {
          console.warn('[fido2] Startup unlock failed or cancelled:', err);
          this.sendSmartcardStartupUnlockStatus({
            kind: 'fido2',
            status: 'error',
            error: this.describeFido2StartupError(err),
          });
        }
      }
    })();

    onUnlockStarted(unlockPromise);
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
   * The 'agent-global' mode's "lock card" action: makes the app agent forget every key, forcing the
   * next connection that needs any of those cards to prompt for the PIN again. The agent itself keeps
   * running, so its socket stays valid for terminals that are already open. Returns how many cards
   * were cached.
   */
  private async lockAllGlobalSmartcardAgents(): Promise<number> {
    const count = this.globalCards.size;
    await this.appAgent.lockAll();
    this.globalCards.clear();
    this.globalSmartcardCerts.clear();
    this.globalSmartcardAgentFailures.clear();
    this.refreshAgentSshConfig();
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
    if (this.globalCards.size === 0) return [];
    // One agent holds every card, so attribute each identity to the card that contributed it.
    const identities = await this.appAgent.list();
    return Array.from(this.globalCards.entries()).map(([pkcs11LibPath, { fingerprints }]) => {
      const certsByFingerprint =
        this.globalSmartcardCerts.get(pkcs11LibPath) ?? new Map<string, SmartcardCertificateDetails>();
      const mine = identities.filter((identity) =>
        pkcs11LibPath === '__fido2__' ? /-SK$/i.test(identity.keyType) : fingerprints.has(identity.fingerprint)
      );
      return {
        pkcs11LibPath: pkcs11LibPath === '__fido2__' ? 'FIDO2 Security Key' : pkcs11LibPath,
        identities: mine.map((identity) => {
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
    });
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

  /**
   * `ssh-add -K` (load FIDO2 *resident/discoverable* credentials) reports "Provider \"internal\"
   * returned failure -1" / "Unable to load resident keys: invalid format" whenever the
   * authenticator's own CTAP2 stack returns FIDO_ERR_PIN_AUTH_BLOCKED — verified directly with
   * `ssh-add -v -K`, which prints that exact libfido2 error code for this failure. That's a
   * device-side safety lockout (CTAP2 blocks further PIN verification until the key is unplugged
   * and reconnected, after a few failed/rapid PIN submissions in the current power cycle) — it is
   * NOT the persistent PIN-retry counter (`ykman fido info` still showed all attempts remaining
   * while this reproduced), so it is unrelated to whether the PIN typed was actually correct, and
   * unplugging/reconnecting the key is the only way to clear it — retrying in-app cannot help.
   */
  private describeFido2StartupError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (/provider "internal" returned failure -1/i.test(message) && /invalid format/i.test(message)) {
      if (process.platform === 'win32') {
        // The Linux-verified PIN_AUTH_BLOCKED cause above was not confirmed on Windows: the same
        // message persisted after unplugging/reconnecting and entering the PIN once. Windows also
        // blocks direct HID access to FIDO devices for non-elevated processes, which the built-in
        // provider needs to enumerate resident keys — so don't claim a cause we haven't proven.
        return 'Windows could not read the resident keys from the security key (ssh-add -K failed with "Provider internal returned failure -1"). If you already unplugged and reconnected the key and entered the PIN once, this is likely because reading resident credentials needs direct access to the device, which Windows only allows for an elevated (Administrator) process. Resident-key login may need sshs3 started as Administrator, or a key file instead.';
      }
      return 'This security key has temporarily blocked PIN verification (likely after a few failed or rapid attempts) and needs to be unplugged and reconnected before it will accept a PIN again. This is not a wrong PIN.';
    }
    return message;
  }

  private sendSmartcardStartupUnlockStatus(event: {
    kind: 'smartcard' | 'fido2';
    status: 'unlocked' | 'error';
    libPath?: string;
    error?: string;
  }): void {
    const webContents = this.getWebContents();
    if (webContents && !webContents.isDestroyed?.()) {
      webContents.send(IPC_CHANNELS.SMARTCARD_STARTUP_UNLOCK_STATUS, event);
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

  private registerClipboardHistoryHandlers(): void {
    const isShortString = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

    this.registerHandler(IPC_CHANNELS.CLIPBOARD_HISTORY_LIST, async (_event, hostKey?: unknown) => {
      if (hostKey !== undefined && !isShortString(hostKey, 1024)) throw new Error('Invalid host key');
      return await this.clipboardHistoryStore.list(hostKey);
    });

    this.registerHandler(
      IPC_CHANNELS.CLIPBOARD_HISTORY_ADD,
      async (_event, text: unknown, hostKey: unknown, hostLabel: unknown): Promise<void> => {
        if (typeof text !== 'string' || !isShortString(hostKey, 1024) || !isShortString(hostLabel, 1024)) {
          throw new Error('Invalid clipboard history entry');
        }
        await this.clipboardHistoryStore.add(text, hostKey, hostLabel);
      }
    );

    this.registerHandler(IPC_CHANNELS.CLIPBOARD_HISTORY_DELETE, async (_event, id: unknown): Promise<void> => {
      if (!isShortString(id, 128)) throw new Error('Invalid entry id');
      await this.clipboardHistoryStore.delete(id);
    });

    this.registerHandler(IPC_CHANNELS.CLIPBOARD_HISTORY_CLEAR, async (): Promise<void> => {
      await this.clipboardHistoryStore.clear();
    });
  }

  private registerSnippetHandlers(): void {
    this.registerHandler(IPC_CHANNELS.SNIPPETS_LIST, async (_event, hostKey?: unknown) => {
      if (hostKey !== undefined && (typeof hostKey !== 'string' || hostKey.length > 1024)) {
        throw new Error('Invalid host key');
      }
      return await this.snippetStore.list(hostKey);
    });

    this.registerHandler(IPC_CHANNELS.SNIPPETS_SAVE, async (_event, input: unknown) => {
      const s = input as Record<string, unknown> | null;
      const optionalString = (v: unknown, max: number): boolean =>
        v === undefined || (typeof v === 'string' && v.length <= max);
      if (
        !s ||
        typeof s.name !== 'string' ||
        s.name.length > SNIPPET_MAX_NAME_CHARS * 2 ||
        typeof s.command !== 'string' ||
        !optionalString(s.id, 128) ||
        !optionalString(s.hostKey, 1024) ||
        !optionalString(s.hostLabel, 1024)
      ) {
        throw new Error('Invalid snippet');
      }
      return await this.snippetStore.save({
        id: s.id as string | undefined,
        name: s.name,
        command: s.command,
        hostKey: s.hostKey as string | undefined,
        hostLabel: s.hostLabel as string | undefined,
      });
    });

    this.registerHandler(IPC_CHANNELS.SNIPPETS_DELETE, async (_event, id: unknown): Promise<void> => {
      if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid snippet id');
      await this.snippetStore.delete(id);
    });
  }

  private registerSettingsHandlers(): void {
    this.registerHandler(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
      return await this.settingsStore.getSettings();
    });

    this.registerHandler(
      IPC_CHANNELS.SETTINGS_SAVE,
      async (_event, settings: Partial<AppSettings>): Promise<AppSettings> => {
        const saved = await this.settingsStore.saveSettings(settings);
        if (settings.autoSyncLocalSshConfig === true) void this.profileSyncService.autoSyncLocalSshConfig();
        if ('autoSyncLocalSshConfig' in settings || 'smartcardAuthMode' in settings) this.refreshAgentSshConfig();
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
        const provider = await this.getSyncProvider(config.target);
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
      const provider = await this.getSyncProvider(config.target);
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
      const provider = await this.getSyncProvider(config.target);
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
        const provider = await this.getSyncProvider(config.target);

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
        const provider = await this.getSyncProvider(config.target);
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
        const pinHandler = async (_prompt: string, retry?: AskpassPromptRetryContext) => {
          if (options.pin && !retry) return options.pin;
          return await this.promptForPinDirect(
            'Enter your smartcard PIN to link this card to Remote Profile Sync:',
            'smartcard',
            undefined,
            retry
          );
        };

        const settings = await this.settingsStore.getSettings();
        const mode = settings.smartcardAuthMode ?? 'always-prompt';

        let socketPath: string;
        let privateAgentPid: number | undefined;

        if (this.globalCards.has(options.pkcs11LibPath)) {
          socketPath = await this.appAgent.ensure();
        } else if (mode === 'agent-global') {
          socketPath = await this.getOrLoadGlobalSmartcardAgent(options.pkcs11LibPath, pinHandler);
        } else {
          const agent = await this.loadSmartcardIntoPrivateAgentWithPresence(options.pkcs11LibPath, pinHandler);
          socketPath = agent.socketPath;
          privateAgentPid = agent.pid;
        }

        try {
          const identities = this.identitiesForLibrary(
            await getAgentIdentities(socketPath),
            options.pkcs11LibPath,
            privateAgentPid === undefined
          );
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
          this.forgetGlobalCardAfterFailure(options.pkcs11LibPath, privateAgentPid);
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
            const provider = await this.getSyncProvider(config.target);
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
   * The global agent cache is keyed by PKCS#11 library path, but one physical card is often
   * reachable through several modules (e.g. OpenSC's opensc-pkcs11.dll and onepin-opensc-pkcs11.dll
   * on Windows) — so a sync link made against one module would otherwise miss the cache filled by
   * another and ask for the PIN a second time. Returns the socket of any already-cached global
   * PKCS#11 agent that holds the given key, so the caller can reuse it instead.
   */
  private async findCachedGlobalAgentHoldingKey(keyBlobBase64: string | undefined): Promise<string | undefined> {
    if (!keyBlobBase64 || !Array.from(this.globalCards.keys()).some((key) => key !== '__fido2__')) return undefined;
    const socketPath = this.appAgent.getSocketPath();
    if (!socketPath) return undefined;
    try {
      const identities = await getAgentIdentities(socketPath);
      return identities.some((id) => id.keyBlob.toString('base64') === keyBlobBase64) ? socketPath : undefined;
    } catch {
      return undefined; // Agent gone or unreachable.
    }
  }

  /**
   * Narrows an agent's identities to the ones belonging to `pkcs11LibPath` when they come from the
   * shared app agent, which holds every unlocked card: sync linking/unlocking signs with the first
   * identity it is given, and a key from another card would derive the wrong sync secret. A private
   * per-session agent only ever holds this one card's keys, so it is returned untouched.
   */
  private identitiesForLibrary<T extends { keyBlob: Buffer }>(
    identities: T[],
    pkcs11LibPath: string,
    fromAppAgent: boolean
  ): T[] {
    const card = this.globalCards.get(pkcs11LibPath);
    if (!fromAppAgent || !card) return identities;
    return identities.filter((id) => card.fingerprints.has(fingerprintOfKeyBlob(id.keyBlob)));
  }

  /** After a failed sync link/unlock: drop the card's keys from the app agent (never the agent itself). */
  private forgetGlobalCardAfterFailure(pkcs11LibPath: string, privateAgentPid: number | undefined): void {
    if (!this.globalCards.has(pkcs11LibPath) || privateAgentPid !== undefined) return;
    void this.appAgent.remove(pkcs11LibPath);
    this.globalCards.delete(pkcs11LibPath);
    this.globalSmartcardCerts.delete(pkcs11LibPath);
    this.refreshAgentSshConfig();
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
      const preferredLib = (await this.settingsStore.getSettings()).smartcardLibPath;
      if (preferredLib && (await SmartcardDetector.validateLibraryPath(preferredLib))) {
        libPath = preferredLib;
      }
    }
    if (!libPath) {
      const detected = await SmartcardDetector.detectAvailableLibraries(undefined, { onlyExisting: true });
      if (detected.length === 0) {
        throw new Error('No smartcard libraries detected. Please ensure your card reader / PKCS#11 module is installed.');
      }
      libPath = detected[0].path;
    }

    const pinHandler = async (_prompt: string, retry?: AskpassPromptRetryContext) => {
      if (options?.pin && !retry) return options.pin;
      return await this.promptForPinDirect(
        'Enter your smartcard PIN to unlock Remote Profile Sync:',
        'smartcard',
        undefined,
        retry
      );
    };

    const settings = await this.settingsStore.getSettings();
    const mode = settings.smartcardAuthMode ?? 'always-prompt';

    let socketPath: string;
    let privateAgentPid: number | undefined;

    // Windows only: there several PKCS#11 modules for one card (opensc-pkcs11 / onepin-opensc-pkcs11 /
    // libykcs11) share the single system agent; other platforms keep the plain per-library cache lookup.
    const sameCardSocket =
      process.platform !== 'win32' || this.globalCards.has(libPath) || mode !== 'agent-global'
        ? undefined
        : await this.findCachedGlobalAgentHoldingKey(config.smartcardSync?.keyBlobBase64);

    if (this.globalCards.has(libPath)) {
      socketPath = await this.appAgent.ensure();
    } else if (sameCardSocket) {
      socketPath = sameCardSocket;
    } else if (mode === 'agent-global') {
      socketPath = await this.getOrLoadGlobalSmartcardAgent(libPath, pinHandler);
    } else {
      const agent = await this.loadSmartcardIntoPrivateAgentWithPresence(libPath, pinHandler);
      socketPath = agent.socketPath;
      privateAgentPid = agent.pid;
    }

    try {
      const identities = this.identitiesForLibrary(
        await getAgentIdentities(socketPath),
        libPath,
        privateAgentPid === undefined && !sameCardSocket
      );
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
      this.forgetGlobalCardAfterFailure(libPath, privateAgentPid);
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
    const provider = await this.getSyncProvider(config.target);

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

  /**
   * ssh-copy-id: listar installerbara publika nycklar, probar hosten och lägger nycklarna i
   * `authorized_keys`. Fungerar på en osparad profil (formuläret skickar hela configen, på samma sätt som
   * TERMINAL_CREATE och CONNECTION_TEST_SSH redan gör, så det ger ingen ny förmåga). Configen valideras och
   * `agentPath` nollas, eftersom main själv sätter den; nyckelraderna valideras om innan de når ssh.
   */
  private registerKeyInstallHandlers(): void {
    const MAX_KEYS = 50;
    const AUTH_TYPES = new Set(['password', 'privateKey', 'smartcard', 'agent', 'fido2']);
    const LOGIN_METHODS = new Set(['auto', 'password', 'profile', 'smartcard', 'agent']);

    /** Validerar och normaliserar en config från renderern; kastar vid ogiltig form. */
    const resolveDraft = async (raw: unknown): Promise<SSHConnectionConfig> => {
      const c = raw as Partial<SSHConnectionConfig> | undefined;
      if (
        !c ||
        typeof c.host !== 'string' ||
        !c.host.trim() ||
        typeof c.username !== 'string' ||
        !c.username.trim() ||
        typeof c.authType !== 'string' ||
        !AUTH_TYPES.has(c.authType) ||
        (c.port !== undefined && (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535))
      ) {
        throw new Error('A host, a user name and a valid login method are required');
      }
      if (c.authType === 'smartcard' && !c.pkcs11LibPath?.trim()) {
        throw new Error('A PKCS#11 library is required for smartcard login');
      }
      if (c.authType === 'fido2' && !c.fido2Resident && !c.privateKeyPath?.trim()) {
        throw new Error('A key file is required for FIDO2 login (or use a resident key)');
      }
      let config: SSHConnectionConfig = { ...(c as SSHConnectionConfig), agentPath: undefined };
      config = await this.restoreSavedSecrets(config);
      return this.resolveProxyJumpConfig(config);
    };

    /** Laddar kortets/säkerhetsnyckelns agent (PIN/touch). Anropas först när profilens egen inloggning behövs. */
    const prepareHardware = async (config: SSHConnectionConfig, agentId: string): Promise<SSHConnectionConfig> => {
      let prepared = (await this.prepareSftpSmartcardConfig(config as unknown as SFTPConfig, agentId)) as unknown as SSHConnectionConfig;
      prepared = (await this.prepareFido2SftpConfig(prepared as unknown as SFTPConfig, agentId)) as unknown as SSHConnectionConfig;
      return prepared;
    };

    const kindFor = (authType: string, text: string): AskpassPromptKind | undefined => {
      const isPassword = /password/i.test(text) && !/pin|passphrase/i.test(text);
      const isFido2 = authType === 'fido2' || /authenticator|security key|yubikey|fido|sk-/i.test(text);
      return isPassword ? 'password' : isFido2 ? 'fido2' : /passphrase/i.test(text) ? undefined : 'smartcard';
    };

    this.registerHandler(
      IPC_CHANNELS.SSH_LIST_PUBLIC_KEYS,
      async (_event, request?: ListPublicKeysRequest): Promise<LocalPublicKey[]> => {
        let profile: SSHConnectionConfig | undefined;
        if (request?.config?.host && request?.config?.username && request?.config?.authType) {
          try {
            profile = await resolveDraft(request.config);
          } catch {
            // Draft resolution optional for global key discovery
          }
        }
        const lists = [
          await listFilePublicKeys(profile?.privateKeyPath),
          await listAgentPublicKeys('agent', 'Cached key'),
        ];

        // The app-wide agent ('agent-global' PIN caching) holds every unlocked smartcard and FIDO2 key.
        const appSocket = this.globalCards.size > 0 ? this.appAgent.getSocketPath() : null;
        if (appSocket) {
          const keys = await listAgentPublicKeys('smartcard', 'Smartcard key', appSocket);
          lists.push(
            keys.map((k) => (k.type.startsWith('sk-') ? { ...k, source: 'fido2' as const, label: 'Security key' } : k))
          );
        }

        // Query ALL active session agents
        for (const entry of this.smartcardSessionAgents.values()) {
          lists.push(
            await listAgentPublicKeys(
              entry.kind === 'fido2' ? 'fido2' : 'smartcard',
              entry.kind === 'fido2' ? 'Security key' : 'Smartcard key',
              entry.socketPath
            )
          );
        }

        const wantsCard = profile?.authType === 'smartcard' && !!profile?.pkcs11LibPath;
        const wantsFido = profile?.authType === 'fido2' && !!profile?.fido2Resident;
        const cached = lists.some((l) => l.some((k) => k.source === 'smartcard' || k.source === 'fido2'));

        if (!cached && request?.includeHardware && (wantsCard || wantsFido) && profile) {
          const installId = `keylist-${crypto.randomUUID()}`;
          try {
            const config = await prepareHardware(profile, installId);
            if (!config.agentPath) {
              // The loaders swallow their own errors (see resolveFido2AgentPath); don't let that look like "nothing happened".
              throw new Error(
                wantsCard
                  ? 'Could not read the smartcard. Check that it is inserted and the PIN is correct, then try again.'
                  : 'Could not read the security key. Check that it is plugged in, touch it when it blinks, and try again.'
              );
            }
            lists.push(
              await listAgentPublicKeys(wantsCard ? 'smartcard' : 'fido2', wantsCard ? 'Smartcard key' : 'Security key', config.agentPath)
            );
          } finally {
            this.cleanupSmartcardSessionAgent(installId);
          }
        }
        return dedupeKeys(...lists);
      }
    );

    /** Gemensamma prompt-handlers (PIN/lösen/värdnyckel/touch) för probe, test och installation. */
    const promptHandlersFor = (profile: SSHConnectionConfig, installId: string, presenceMessage: string) => {
      const label = profile.name || profile.host;
      const presence = this.makePresenceNotifier(installId, presenceMessage);
      return {
        pinPromptHandler: (prompt: string) => {
          const text = prompt.trim();
          return this.promptForPinDirect(text, kindFor(profile.authType, text), `SSH: ${label}`);
        },
        hostKeyPromptHandler: (info: HostKeyPromptInfo) => this.promptHostKeyTrust(info),
        onPresence: () => presence.onPresenceRequested(),
        onPresenceCleared: () => presence.onPresenceCleared(),
      };
    };

    this.registerHandler(
      IPC_CHANNELS.SSH_PROBE_HOST,
      async (_event, config: SSHConnectionConfig): Promise<ProbeHostResult> => {
        const profile = await resolveDraft(config);
        const installId = `keyprobe-${crypto.randomUUID()}`;
        return probeHost(profile, promptHandlersFor(profile, installId, 'Touch your security key'));
      }
    );

    this.registerHandler(
      IPC_CHANNELS.SSH_TEST_LOGIN,
      async (_event, config: SSHConnectionConfig): Promise<TestLoginResult> => {
        const profile = await resolveDraft(config);
        const installId = `keytest-${crypto.randomUUID()}`;
        try {
          const prepared = await prepareHardware(profile, installId);
          return await testLogin(
            prepared,
            promptHandlersFor(profile, installId, `Touch your security key to log in to ${profile.name || profile.host}`)
          );
        } finally {
          this.cleanupSmartcardSessionAgent(installId);
        }
      }
    );

    this.registerHandler(
      IPC_CHANNELS.SSH_INSTALL_PUBLIC_KEYS,
      async (_event, request: InstallPublicKeysRequest): Promise<InstallPublicKeysResult> => {
        if (
          !request ||
          !Array.isArray(request.publicKeys) ||
          request.publicKeys.length === 0 ||
          request.publicKeys.length > MAX_KEYS ||
          request.publicKeys.some((k) => typeof k !== 'string' || k.length > 2000) ||
          (request.loginMethod !== undefined && !LOGIN_METHODS.has(request.loginMethod)) ||
          (request.serverMethods !== undefined &&
            (!Array.isArray(request.serverMethods) || request.serverMethods.some((m) => typeof m !== 'string')))
        ) {
          throw new Error(`Between 1 and ${MAX_KEYS} public keys are required`);
        }
        const profile = await resolveDraft(request.config);
        const installId = `keyinstall-${crypto.randomUUID()}`;
        const label = profile.name || profile.host;

        try {
          const outcome = await installPublicKeys({
            config: profile,
            publicKeys: request.publicKeys,
            loginMethod: request.loginMethod,
            installsOwnKeyOnly: request.installsOwnKeyOnly === true,
            serverMethods: request.serverMethods,
            prepareProfileConfig: (c) => prepareHardware(c, installId),
            ...promptHandlersFor(profile, installId, `Touch your security key to install the key on ${label}`),
          });

          // Verifiera nycklar som har en oskyddad privat nyckelfil lokalt; allt annat lämnas som "okänt".
          const fileKeys = outcome.success ? await listFilePublicKeys(profile.privateKeyPath) : [];
          const results = await Promise.all(
            outcome.results.map(async (r) => {
              if (!outcome.success || (r.status !== 'installed' && r.status !== 'present')) return r;
              const local = fileKeys.find((k) => k.fingerprint === r.fingerprint);
              const parsed = local ? parsePublicKeyLine(local.line) : null;
              if (!local?.privateKeyPath || !parsed) return r;
              const verified = await verifyKeyLogin(profile, local.privateKeyPath, parsed.type);
              return verified === undefined ? r : { ...r, verified };
            })
          );
          return { ...outcome, results };
        } finally {
          this.cleanupSmartcardSessionAgent(installId);
        }
      }
    );

    this.registerHandler(IPC_CHANNELS.SSH_BUILD_INSTALL_COMMAND, async (_event, publicKeys: string[]): Promise<string> => {
      if (!Array.isArray(publicKeys) || publicKeys.length === 0 || publicKeys.length > MAX_KEYS) {
        throw new Error(`Between 1 and ${MAX_KEYS} public keys are required`);
      }
      return buildInstallCommand(publicKeys);
    });
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
              agentIdentityFiles: config.agentIdentityFiles,
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

  private registerGitHandlers(): void {
    this.registerHandler(
      IPC_CHANNELS.GIT_FETCH_PUBLIC_KEYS,
      async (_event, request: FetchGitKeysRequest): Promise<FetchGitKeysResult> => {
        return await fetchGitPublicKeys(request);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.GIT_GET_SIGNING_CONFIG,
      async (): Promise<GitSigningConfig> => {
        return await GitConfigService.getSigningConfig();
      }
    );

    this.registerHandler(
      IPC_CHANNELS.GIT_CONFIGURE_SIGNING,
      async (_event, request: ConfigureGitSigningRequest): Promise<ConfigureGitSigningResult> => {
        return await GitConfigService.configureSigning(request);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.GIT_SET_SIGNING_ENABLED,
      async (_event, enabled: boolean): Promise<ConfigureGitSigningResult> => {
        return await GitConfigService.setSigningEnabled(Boolean(enabled));
      }
    );

    this.registerHandler(
      IPC_CHANNELS.GIT_GET_STATUS,
      async (_event, directoryPath: string, providerId?: string): Promise<GitRepoStatus> => {
        return await GitStatusService.getStatus(directoryPath, providerId, this.storageRegistry);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.GIT_CLONE,
      async (_event, request: GitCloneRequest): Promise<GitOperationResult> => {
        if (request.sftpConfig) {
          const config = await this.restoreSavedSecrets(request.sftpConfig);
          request.sftpConfig = await this.resolveProxyJumpConfig(config);
        }
        return await RemoteGitService.clone(request);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.GIT_PULL,
      async (_event, directoryPath: string, providerId?: string): Promise<GitOperationResult> => {
        return await RemoteGitService.pull(directoryPath, providerId);
      }
    );

    this.registerHandler(
      IPC_CHANNELS.GIT_TEST_REMOTE_ACCESS,
      async (_event, request: TestRemoteGitAccessRequest): Promise<TestRemoteGitAccessResult> => {
        const config = await this.restoreSavedSecrets(request.config);
        const resolved = await this.resolveProxyJumpConfig(config);
        return await RemoteGitService.testRemoteAccess({ ...request, config: resolved });
      }
    );

    this.registerHandler(
      IPC_CHANNELS.DOTFILES_IMPORT_FROM_GIT,
      async (_event, request: DotfilesImportFromGitRequest): Promise<DotfilesImportFromGitResult> => {
        const res = await DotfileGitImporter.importFromGit(request, this.dotfilePoolStore);
        if (res.success) {
          this.scheduleAutoSync();
        }
        return res;
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

    // Performance bar. The renderer only sends a session id / pod target; host and mux socket are resolved here.
    this.registerHandler(IPC_CHANNELS.PERF_SSH_SAMPLE, async (_event, sessionId: unknown) =>
      this.perfMetricsService.sampleSsh(sessionId)
    );
    this.registerHandler(IPC_CHANNELS.PERF_LOCAL_SAMPLE, async () => this.perfMetricsService.sampleLocal());
    this.registerHandler(IPC_CHANNELS.PERF_K8S_SAMPLE, async (_event, target: unknown) =>
      this.perfMetricsService.sampleK8s(target)
    );

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

    this.registerHandler(
      IPC_CHANNELS.SSH_TUNNEL_START,
      async (
        _event,
        rawConfig: SSHConnectionConfig,
        tunnel: SSHTunnelConfig
      ): Promise<SSHActiveTunnel> => {
        // Same as terminal/SFTP sessions: pre-load a PKCS#11/FIDO2 resident credential
        // into a private agent so the ssh child just points IdentityAgent at it, rather
        // than needing an interactive PIN/passphrase for every standalone tunnel.
        let config = await this.resolveProxyJumpConfig(rawConfig);
        config = await this.prepareSmartcardConfig(config);
        config = await this.prepareFido2Config(config);
        const hostLabel = config.name ? `${config.name} (${config.host})` : config.host;
        return await this.sshTunnelManager.startTunnel(config, tunnel, (rawPrompt) => {
          const isPassword = /password/i.test(rawPrompt) && !/pin|passphrase/i.test(rawPrompt);
          const promptText = isPassword
            ? rawPrompt.trim()
            : `Enter the passphrase/PIN to connect via SSH to ${hostLabel}:`;
          return this.promptForPinDirect(
            promptText,
            isPassword ? 'password' : 'smartcard',
            isPassword ? `SSH: ${hostLabel}` : `Smartcard: ${hostLabel}`
          );
        });
      }
    );

    this.registerHandler(IPC_CHANNELS.SSH_TUNNEL_STOP, async (_event, id: string): Promise<boolean> => {
      return await this.sshTunnelManager.stopTunnel(id);
    });

    this.registerHandler(IPC_CHANNELS.SSH_TUNNEL_LIST, async (): Promise<SSHActiveTunnel[]> => {
      return this.sshTunnelManager.listActive();
    });

    this.registerHandler(IPC_CHANNELS.SSH_TUNNEL_CHECK_PORT, async (_event, port: number): Promise<boolean> => {
      return await this.sshTunnelManager.isPortFree(port);
    });
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

  private getUpdateService(): UpdateService {
    if (!this.updateService) {
      this.updateService = new UpdateService({
        disabled: process.env.SSHS3_DISABLE_UPDATES === '1',
        confirmQuit: this.confirmQuit,
        getAutoCheck: async () => (await this.settingsStore.getSettings()).autoCheckUpdates !== false,
        send: (state) => {
          const webContents = this.getWebContents();
          if (webContents && !webContents.isDestroyed?.()) {
            webContents.send(IPC_CHANNELS.UPDATE_STATE, state);
          }
        },
      });
    }
    return this.updateService;
  }

  /** Starts the periodic update poll; called once the main window exists. */
  public startUpdateChecks(): void {
    this.getUpdateService().start();
  }

  private registerGeneralHandlers(): void {
    this.registerHandler(IPC_CHANNELS.APP_GET_VERSION, async () => {
      try {
        return electronApp.getVersion();
      } catch {
        return '0.1.0';
      }
    });

    this.registerHandler(IPC_CHANNELS.UPDATE_GET_STATE, async () => this.getUpdateService().getState());
    this.registerHandler(IPC_CHANNELS.UPDATE_CHECK, async () => this.getUpdateService().check());
    this.registerHandler(IPC_CHANNELS.UPDATE_DOWNLOAD, async () => this.getUpdateService().download());
    this.registerHandler(IPC_CHANNELS.UPDATE_INSTALL, async () => {
      await this.getUpdateService().install();
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

    this.registerHandler(
      IPC_CHANNELS.DIALOG_SAVE_FILE,
      async (_event, options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
        const result = await electronDialog.showSaveDialog({
          title: options?.title,
          defaultPath: options?.defaultPath,
          filters: options?.filters,
        });
        if (result.canceled || !result.filePath) {
          return null;
        }
        return result.filePath;
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

    this.onPtyAskpass = ({ sessionId, prompt, kind, context, retry, callback }) => {
      const id = crypto.randomUUID();
      this.pendingAskpass.set(id, { sessionId, callback });
      if (sessionId) {
        this.activePresenceSessions.add(sessionId);
      }

      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.ASKPASS_PROMPT, {
          id,
          prompt,
          sessionId,
          kind,
          context,
          error: retry?.error,
          attempt: retry?.attempt,
          maxAttempts: retry?.maxAttempts,
        });
      }
    };
    this.sshPtyManager.on('askpass', this.onPtyAskpass);

    this.onPtyPresence = ({ sessionId, prompt }) => {
      const id = crypto.randomUUID();
      if (sessionId) {
        this.activePresenceSessions.add(sessionId);
      }
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        const message = /touch/i.test(prompt) ? prompt : 'Touch your security key to confirm';
        const event: PresencePromptEvent = { id, sessionId, message };
        webContents.send(IPC_CHANNELS.PRESENCE_PROMPT, event);
      }
    };
    this.sshPtyManager.on('presence', this.onPtyPresence);

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

    this.onSshTunnelChange = (active) => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        webContents.send(IPC_CHANNELS.SSH_TUNNEL_EVENT, active);
      }
    };
    this.sshTunnelManager.on('change', this.onSshTunnelChange);

    this.onK8sConfigChanged = () => {
      const webContents = this.getWebContents();
      if (webContents && !webContents.isDestroyed?.()) {
        // Carries an optional warning (H8 code-review finding) when this
        // reload just introduced a new exec-auth user — see
        // K8sDiscoveryService.checkExecAuthChange.
        webContents.send(IPC_CHANNELS.K8S_CONFIG_CHANGED, this.k8sDiscoveryService.consumePendingExecAuthWarning());
      }
    };
    this.unsubscribeK8sConfig = this.k8sDiscoveryService.onConfigChanged(this.onK8sConfigChanged);
  }

  /**
   * Runs one awaited cleanup step of dispose() so a rejection or a hang in one manager
   * can neither skip the remaining cleanup nor block app quit.
   */
  private async disposeStep(label: string, step: () => Promise<void> | void): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(step),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.warn(`IpcBridge.dispose: ${label} did not finish within ${DISPOSE_STEP_TIMEOUT_MS} ms`);
            resolve();
          }, DISPOSE_STEP_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      console.warn(`IpcBridge.dispose: ${label} failed:`, err instanceof Error ? err.message : err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Empties the clipboard history when the "empty on exit" setting is on. */
  public async clearClipboardHistoryIfConfigured(): Promise<void> {
    const settings = await this.settingsStore.getSettings();
    if (settings.clipboardHistoryClearOnExit) {
      await this.clipboardHistoryStore.clear();
    }
  }

  public async dispose(): Promise<void> {
    this.updateService?.dispose();

    for (const channel of this.handlers) {
      this.ipcMain.removeHandler(channel);
    }
    this.handlers.clear();
    // After the handlers are gone no late selection can be added behind this clear.
    await this.disposeStep('clear clipboard history', () => this.clearClipboardHistoryIfConfigured());

    if (this.onPtyData) {
      this.sshPtyManager.off('data', this.onPtyData);
    }
    if (this.onPtyExit) {
      this.sshPtyManager.off('exit', this.onPtyExit);
    }
    if (this.onPtyAskpass) {
      this.sshPtyManager.off('askpass', this.onPtyAskpass);
    }
    if (this.onPtyPresence) {
      this.sshPtyManager.off('presence', this.onPtyPresence);
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
    await this.disposeStep('k8sTerminalManager.killAll', () => this.k8sTerminalManager.killAll());

    if (this.onK8sLogData) {
      this.k8sLogManager.off('data', this.onK8sLogData);
    }
    if (this.onK8sLogEnd) {
      this.k8sLogManager.off('end', this.onK8sLogEnd);
    }
    await this.disposeStep('k8sLogManager.stopAll', () => this.k8sLogManager.stopAll());

    if (this.onK8sPortForwardChange) {
      this.k8sPortForwardManager.off('change', this.onK8sPortForwardChange);
    }
    await this.disposeStep('k8sPortForwardManager.stopAll', () => this.k8sPortForwardManager.stopAll());

    if (this.onSshTunnelChange) {
      this.sshTunnelManager.off('change', this.onSshTunnelChange);
    }
    // Awaited (unlike the other managers' stopAll() calls above): dispose() is itself awaited by
    // app 'before-quit' before app.quit() runs, so this is what actually guarantees every standalone
    // tunnel process is signalled before the app exits on a normal quit.
    await this.disposeStep('sshTunnelManager.stopAll', () => this.sshTunnelManager.stopAll());

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

    for (const prompt of this.pendingQuitConfirms.values()) {
      try {
        prompt.callback(true);
      } catch {
        // Ignore
      }
    }
    this.pendingQuitConfirms.clear();

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
    this.globalCards.clear();
    this.globalSmartcardCerts.clear();
    // The socket is about to disappear: take the agent block out of ~/.ssh/config first.
    await this.agentConfigRefresh;
    await this.profileSyncService.syncAgentBlockToLocalSshConfig(null).catch(() => {});
    await this.appAgent.shutdown();
    AgentLifecycleManager.killAllPrivateAgents();
    await AgentLifecycleManager.stopManagedAgent();
    await XServerManager.stopServer();
  }
}
