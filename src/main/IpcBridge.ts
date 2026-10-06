import crypto from 'node:crypto';
import { ipcMain as electronIpcMain } from 'electron';
import type { IpcMain } from 'electron';
import { SSHPtyManager, type InternalSSHPtySession } from './ssh/SSHPtyManager';
import { withResolvedProxyJump } from './ssh/resolveProxyJump';
import { describeFido2StartupError, paneTreeHasAuthType } from './ipc/ipcHelpers';
import { AgentLifecycleManager } from './ssh/AgentLifecycleManager';
import { AppAgent, fingerprintOfKeyBlob } from './ssh/AppAgent';
import { assignHostAliases, type AgentHostEntry } from './services/SshNativeFileMerger';
import { SmartcardDetector } from './smartcard/SmartcardDetector';
import { loadSmartcardIntoPrivateAgent, loadFido2ResidentKeysIntoPrivateAgent, pinPromptKind } from './smartcard/SmartcardAgentLoader';
import type { AskpassPromptHandler, AskpassPromptRetryContext, AskpassServer } from './smartcard/AskpassServer';
import { readSmartcardCertificates } from './smartcard/SmartcardCertificateReader';
import type { SmartcardCertificateDetails } from './smartcard/CertificateParser';
import { StorageRegistry } from './storage/StorageRegistry';
import { TransferQueue } from './transfer/TransferQueue';
import { ProfileStore } from './profile/ProfileStore';
import { SessionStore } from './session/SessionStore';
import { ClipboardHistoryStore } from './clipboard/ClipboardHistoryStore';
import { SnippetStore } from './snippets/SnippetStore';
import { SettingsStore } from './settings/SettingsStore';
import { UpdateService } from './update/UpdateService';
import { createHostVerifier, type HostKeyPromptInfo } from './ssh/HostKeyVerifier';
import { DotfilePoolStore } from './dotfiles/DotfilePoolStore';
import { DotfileSyncService } from './dotfiles/DotfileSyncService';
import { DirectorySyncProfileStore } from './dirsync/DirectorySyncProfileStore';
import { FileEditorService } from './editor/FileEditorService';
import { FileTailService } from './editor/FileTailService';
import { SearchOrchestrator } from './search/SearchOrchestrator';
import { K8sDiscoveryService } from './services/K8sDiscoveryService';
import { K8sDebugService } from './services/K8sDebugService';
import { K8sPortForwardManager } from './services/K8sPortForwardManager';
import { SSHTunnelManager } from './services/SSHTunnelManager';
import { K8sTerminalManager } from './terminal/K8sTerminalManager';
import { PerfMetricsService } from './services/PerfMetricsService';
import { K8sLogManager } from './terminal/K8sLogManager';
import { AwsSsoAuthService } from './aws/AwsSsoAuthService';
import { SyncConfigStore, type SyncConfigData } from './services/SyncConfigStore';
import { SyncCryptoService, SyncDecryptionError, generateSalt } from './services/SyncCryptoService';
import { ProfileSyncService } from './services/ProfileSyncService';
import { getAgentIdentities, signChallengeWithAgent, verifyAgentSignature, deriveSecretFromSignature, getKeyAlgorithm, KEY_DERIVATION_MESSAGE } from './smartcard/SmartcardSyncService';
import { decryptSecretValue } from './crypto/SecretFieldCrypto';
import { XServerManager } from './x11/XServerManager';
import { IPC_CHANNELS, type StorageConnectConfig, type HostKeyPromptEvent, type PresencePromptEvent, type PresenceClearEvent, type TransferConflictPromptEvent, type TransferConflictResolution, type QuitConfirmPromptEvent, type AskpassPromptKind } from '../shared/types/ipc';
import type { K8sActivePortForward } from '../shared/types/kubernetes';
import type { DotfilesSyncPromptEvent, DotfilesSyncResolution } from '../shared/types/dotfiles';
import type { SSHConnectionConfig, SSHPtyExitEvent, CachedSmartcardAgent, SSHActiveTunnel } from '../shared/types/ssh';
import type { TransferProgress, SFTPConfig } from '../shared/types/storage';
import type { ProfileSyncStatus } from '../shared/types/sync';
import { registerSessionHandlers, registerClipboardHistoryHandlers, registerSnippetHandlers, registerSettingsHandlers } from './ipc/appDataHandlers';
import { registerFileEditorHandlers } from './ipc/fileEditorHandlers';
import { registerSearchHandlers } from './ipc/searchHandlers';
import { registerAwsSsoHandlers } from './ipc/awsSsoHandlers';
import { registerDirSyncHandlers } from './ipc/dirSyncHandlers';
import { registerGeneralHandlers } from './ipc/generalHandlers';
import { registerConnectionTestHandlers } from './ipc/connectionTestHandlers';
import { registerGitHandlers } from './ipc/gitHandlers';
import { registerTerminalHandlers } from './ipc/terminalHandlers';
import { registerSmartcardHandlers } from './ipc/smartcardHandlers';
import { registerStorageHandlers } from './ipc/storageHandlers';
import { registerTransferHandlers } from './ipc/transferHandlers';
import { registerProfileHandlers } from './ipc/profileHandlers';
import { registerDotfileHandlers } from './ipc/dotfileHandlers';
import { registerK8sHandlers } from './ipc/k8sHandlers';
import { registerKeyInstallHandlers } from './ipc/keyInstallHandlers';
import { registerSyncHandlers } from './ipc/syncHandlers';
const DISPOSE_STEP_TIMEOUT_MS = 5000;

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
  public readonly perfMetricsService: PerfMetricsService;
  public readonly k8sLogManager: K8sLogManager;
  public readonly k8sPortForwardManager: K8sPortForwardManager;
  public readonly sshTunnelManager: SSHTunnelManager;
  private updateService: UpdateService | null = null;
  private confirmQuit: (() => Promise<boolean>) | undefined;
  public getWebContents: () => Electron.WebContents | null | undefined;

  // The members below are public only so the handler groups in src/main/ipc can reach them. Each group
  // declares the exact subset it uses as a Pick<IpcBridge, ...> (see ipc/*Handlers.ts), and
  // tests/main/ipcHostAccess.test.ts pins which groups may touch the prompt maps and agent state.
  public pendingAskpass = new Map<string, PendingAskpassPrompt>();
  public pendingHostKeyPrompts = new Map<string, PendingHostKeyPrompt>();
  public pendingTransferConflicts = new Map<string, PendingTransferConflictPrompt>();
  public pendingQuitConfirms = new Map<string, PendingQuitConfirmPrompt>();
  public pendingDotfilesSyncPrompts = new Map<string, PendingDotfilesSyncPrompt>();
  public pendingAwsSsoLogins = new Map<string, PendingAwsSsoLogin>();
  private handlers = new Set<string>();
  /** sessionId -> the private ssh-agent pre-loaded with a smartcard for 'agent-per-session' mode. */
  public smartcardSessionAgents = new Map<
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
  public appAgent = new AppAgent();
  /** pkcs11LibPath or '__fido2__' -> what that unlocked card/key contributed to the app agent (its key fingerprints), so keys can be attributed to a card. */
  public globalCards = new Map<string, { fingerprints: Set<string> }>();
  private agentConfigRefresh: Promise<void> = Promise.resolve();
  /** pkcs11LibPath or '__fido2__' -> in-flight load, so concurrent connections to the same card don't each prompt separately. */
  private globalSmartcardAgentLoads = new Map<string, Promise<string>>();
  private globalSmartcardAgentFailures = new Map<string, number>();
  public startupUnlockPromise?: Promise<void>;
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
  /**
   * pkcs11LibPath -> certificates read ahead of the first `ssh-add -s` of a startup unlock that loads several
   * modules. Reading a module's certificates opens its own PKCS#11 session against the token, which makes the
   * token drop the PIN login of any session another process (the agent's ssh-pkcs11-helper) already holds
   * ("agent refused operation" on the next signature, verified with libykcs11 after p11-kit-proxy). So every
   * module is read before any card is loaded, and the loader uses these instead of reading again.
   */
  private prefetchedSmartcardCerts = new Map<string, Map<string, SmartcardCertificateDetails>>();
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
    this.storageRegistry =
      options.storageRegistry ??
      new StorageRegistry({
        sftpHostVerifierFactory: (host, port) =>
          createHostVerifier({
            host,
            port,
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
    // The local agent block is derived from the managed block, so refresh it after every managed-block sync.
    this.profileSyncService.onLocalSshConfigSynced = () => this.refreshAgentSshConfig();
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
    registerTerminalHandlers(this);
    registerSmartcardHandlers(this);
    registerStorageHandlers(this);
    registerTransferHandlers(this);
    registerProfileHandlers(this);
    registerDotfileHandlers(this);
    registerSessionHandlers(this);
    registerClipboardHistoryHandlers(this);
    registerSnippetHandlers(this);
    registerSettingsHandlers(this);
    registerSyncHandlers(this);
    void this.syncConfigStore
      .getConfig()
      .then((config) => {
        if (config.autoSync && config.target) {
          this.startAutoPullTimer();
        }
      })
      .catch(() => {});
    registerConnectionTestHandlers(this);
    registerKeyInstallHandlers(this);
    registerGitHandlers(this);
    registerAwsSsoHandlers(this);
    registerFileEditorHandlers(this);
    registerSearchHandlers(this);
    registerGeneralHandlers(this);
    registerDirSyncHandlers(this);
    registerK8sHandlers(this);
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

  public registerHandler(channel: string, handler: (...args: any[]) => any): void {
    // async, not a plain arrow function: assertTrustedSender's throw must
    // surface as a rejected promise (what ipcMain.invoke's caller expects)
    // rather than a synchronous exception out of the handle() dispatch.
    this.ipcMain.handle(channel, async (event, ...args) => {
      this.assertTrustedSender(event);
      return handler(event, ...args);
    });
    this.handlers.add(channel);
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
  public loadSmartcardIntoPrivateAgentWithPresence(
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
  public makePresenceNotifier(
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

  public requireS3Capability<K extends keyof import('../shared/types/storage').IStorageProvider>(
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
  public async restoreSavedSecrets(config: SSHConnectionConfig): Promise<SSHConnectionConfig> {
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

  public async resolveProxyJumpConfig<T extends { proxyJumpProfileId?: string; proxyJump?: string }>(
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

  public async prepareSmartcardConfig(config: SSHConnectionConfig): Promise<SSHConnectionConfig> {
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
  public async prepareFido2Config(config: SSHConnectionConfig): Promise<SSHConnectionConfig> {
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
  public async prepareSftpSmartcardConfig(config: SFTPConfig, providerId: string): Promise<SFTPConfig> {
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
  public async getSyncProvider(target: StorageConnectConfig): ReturnType<StorageRegistry["getOrCreate"]> {
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
  public async prepareFido2SftpConfig(config: SFTPConfig, providerId: string): Promise<SFTPConfig> {
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
   * Which of a card's certificates (by SSH fingerprint) this app may use and offer: the
   * authentication-capable ones. Never an empty set while the card has certificates — if none look
   * authentication-capable the heuristic is not trusted and every certificate is kept, as before. A key
   * already linked for smartcard sync is always kept, since sync unlock must keep finding it.
   */
  private async selectAuthFingerprints(certs: Map<string, SmartcardCertificateDetails>): Promise<Set<string>> {
    const auth = new Set<string>();
    for (const [fingerprint, details] of certs) {
      if (details.authCapable) auth.add(fingerprint);
    }
    if (auth.size === 0) {
      if (certs.size > 0) {
        console.warn('[smartcard] no authentication-capable certificate found on the card; keeping all of them');
      }
      return new Set(certs.keys());
    }
    const linkedKey = await this.linkedSyncKeyFingerprint();
    if (linkedKey && certs.has(linkedKey)) auth.add(linkedKey);
    return auth;
  }

  /**
   * SSH fingerprint of the key linked for smartcard sync, if any. Links store the key blob and its
   * sha256 in hex; an older link may only have the latter, which is the same digest as the SSH
   * fingerprint (base64, no padding).
   */
  private async linkedSyncKeyFingerprint(): Promise<string | undefined> {
    try {
      const link = (await this.syncConfigStore.getConfig()).smartcardSync;
      if (link?.keyBlobBase64) return fingerprintOfKeyBlob(Buffer.from(link.keyBlobBase64, 'base64'));
      if (link?.keyFingerprint && /^[0-9a-f]{64}$/i.test(link.keyFingerprint)) {
        return `SHA256:${Buffer.from(link.keyFingerprint, 'hex').toString('base64').replace(/=+$/, '')}`;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Reads the certificates of several PKCS#11 modules up front (see `prefetchedSmartcardCerts`). Skipped for a
   * single module, where nothing can be disturbed, and whenever the app agent already holds a PKCS#11 card:
   * reading now would break that card's session, so the loader falls back to reading as it goes.
   */
  private async prefetchSmartcardCertificates(libPaths: string[]): Promise<void> {
    if (libPaths.length < 2) return;
    if (Array.from(this.globalCards.keys()).some((key) => key !== '__fido2__')) return;
    for (const libPath of libPaths) {
      try {
        this.prefetchedSmartcardCerts.set(libPath, await readSmartcardCertificates(libPath));
      } catch (err) {
        console.warn(`[smartcard] failed to read certificate details for ${libPath}:`, err);
      }
    }
  }

  /**
   * Returns the app agent's socket after making sure the given PKCS#11 library's card is loaded into
   * it (prompting for the PIN once if it isn't). Concurrent callers for the same library share the
   * same in-flight load rather than each prompting separately.
   */
  public async getOrLoadGlobalSmartcardAgent(
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
        const prefetched = this.prefetchedSmartcardCerts.get(pkcs11LibPath);
        this.prefetchedSmartcardCerts.delete(pkcs11LibPath);
        certs = prefetched ?? (await readSmartcardCertificates(pkcs11LibPath));
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
      const authFingerprints = await this.selectAuthFingerprints(certs);
      if (alreadyLoaded.length > 0) {
        console.log(
          `[smartcard] getOrLoadGlobalSmartcardAgent: ${pkcs11LibPath} is the same card as one already loaded; not loading it again`
        );
        this.globalCards.set(pkcs11LibPath, { fingerprints: authFingerprints });
        this.refreshAgentSshConfig();
        return await this.appAgent.ensure();
      }
      await this.addSmartcardToAppAgentWithPresence(
        pkcs11LibPath,
        pinHandler,
        typeof sessionIdOrPinPrompt === 'string' ? sessionIdOrPinPrompt : undefined
      );
      const socketPath = await this.appAgent.ensure();
      // `ssh-add -s` loads every key the module exposes; drop the ones that must not be used or offered
      // (signing, key management, …) now, rather than leaving them in the shared agent.
      const unwanted = Array.from(certs.keys()).filter((fingerprint) => !authFingerprints.has(fingerprint));
      if (unwanted.length > 0) {
        const removed = await this.appAgent.removeIdentities(unwanted);
        console.log(`[smartcard] ${pkcs11LibPath}: removed ${removed} of ${unwanted.length} non-authentication key(s) from the app agent`);
      }
      // Which keys are this card's: its authentication certificates' fingerprints; if the certificates
      // couldn't be read, whatever this add contributed (excluding security keys, which belong to FIDO2).
      const fingerprints = new Set(authFingerprints);
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
    const filesByCard = new Map<string, string[]>();
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
      let identityFiles = filesByCard.get(cardKey!);
      if (!identityFiles) {
        identityFiles = await this.appAgent.writePublicKeyFiles(card.fingerprints);
        filesByCard.set(cardKey!, identityFiles);
      }
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
  public async resolveLocalShellAgentSocket(smartcardAuthMode: string | undefined): Promise<string | undefined> {
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
   * for security credentials (FIDO2 resident keys and/or smartcard PIN) and loads them
   * into app-lifetime global agents sequentially before terminal sessions start.
   * Concurrent terminal session restorations await this startup unlock so that
   * multiple connections never race against the physical security key hardware.
   */
  public async maybeUnlockSmartcardAtStartup(options: { force?: boolean } = {}): Promise<{ started: boolean }> {
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
    const ownGuard = new Promise<void>((resolve) => {
      resolveGuard = resolve;
    });
    // An unlock that is still waiting for the PIN must keep gating terminal/SFTP creation even if
    // another unlock request (e.g. clicking Unlock Now again) finishes sooner: chain, don't replace.
    const previousGuard = this.startupUnlockPromise;
    const guardPromise = previousGuard ? Promise.all([previousGuard, ownGuard]).then(() => undefined) : ownGuard;
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
      }, options.force);
    } finally {
      if (!unlockKickedOff) {
        resolveGuard();
      }
    }
  }

  /**
   * `force` is the on-demand "Unlock" action (top bar): it runs the same detection and unlock as the
   * startup flow but doesn't require the "unlock at startup" setting — the user asked for it now.
   */
  private async runSmartcardStartupUnlockWork(
    onUnlockStarted: (unlockPromise: Promise<void>) => void,
    force = false
  ): Promise<{ started: boolean }> {
    // An explicit retry must not be refused by the cooldown a just-failed (wrong/cancelled PIN) attempt set.
    if (force) this.globalSmartcardAgentFailures.clear();
    const settings = await this.settingsStore.getSettings();
    if ((!settings.smartcardUnlockAtStartup && !force) || (settings.smartcardAuthMode ?? 'always-prompt') !== 'agent-global') {
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
          if (paneTreeHasAuthType(tab.paneTree, 'fido2')) hasFido2 = true;
          if (paneTreeHasAuthType(tab.paneTree, 'smartcard')) hasSmartcard = true;
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
            await this.prefetchSmartcardCertificates(pathsNeedingUnlock);
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
            this.prefetchedSmartcardCerts.clear();
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
            error: describeFido2StartupError(err),
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
  public cleanupSmartcardSessionAgent(sessionId: string): void {
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
  public async lockAllGlobalSmartcardAgents(): Promise<number> {
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
  public async listGlobalSmartcardAgents(): Promise<CachedSmartcardAgent[]> {
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
  public async runDotfilesSyncCheck(sessionId: string, config: SSHConnectionConfig): Promise<void> {
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

    let provider: Awaited<ReturnType<DotfileSyncService['computeDiff']>>['provider'] | undefined;
    try {
      const diff = await this.dotfileSyncService.computeDiff(config, pool, {
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
          // `config` is the resolved runtime config (agent socket, resolved jump host, …); persist the
          // policy on the saved profile instead, so those runtime values never leak into it.
          const saved = (await this.profileStore.getProfiles()).ssh.find((p) => p.id === config.id);
          if (saved) await this.profileStore.saveSSH({ ...saved, dotfilesSyncPolicy: 'always' });
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
  public startAutoPullTimer(): void {
    this.stopAutoPullTimer();
    this.autoPullTimer = setInterval(() => {
      void this.runAutoPull();
    }, IpcBridge.AUTO_PULL_INTERVAL_MS);
    // node's timer would otherwise keep the process alive just for this.
    this.autoPullTimer.unref?.();
  }

  public stopAutoPullTimer(): void {
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

  public async buildSyncStatus(): Promise<ProfileSyncStatus> {
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
  public identitiesForLibrary<T extends { keyBlob: Buffer }>(
    identities: T[],
    pkcs11LibPath: string,
    fromAppAgent: boolean
  ): T[] {
    const card = this.globalCards.get(pkcs11LibPath);
    if (!fromAppAgent || !card) return identities;
    return identities.filter((id) => card.fingerprints.has(fingerprintOfKeyBlob(id.keyBlob)));
  }

  /** After a failed sync link/unlock: drop the card's keys from the app agent (never the agent itself). */
  public forgetGlobalCardAfterFailure(pkcs11LibPath: string, privateAgentPid: number | undefined): void {
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
  public async unlockWithSmartcardInternal(
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

  public async unlockSyncInternal(
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
      try {
        await this.profileSyncService.pullFromRemote(provider, config.remoteBasePath ?? '');
      } catch (err) {
        // unlock() only derives keys and never verifies them; a wrong master
        // password would otherwise stay cached and let the next push encrypt
        // (and overwrite) the remote data with the wrong key.
        if (err instanceof SyncDecryptionError) this.syncCryptoService.lock();
        throw err;
      }
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

  public getUpdateService(): UpdateService {
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
