# sshs3 Architecture & Developer Guide

This document outlines the architecture, process boundaries, design patterns, and conventions of **sshs3**. It is designed to help developers and AI assistants navigate, modify, and extend the codebase safely and consistently.

---

## 1. System Overview & Process Boundaries

The application is built on Electron, Vite, and React with a strictly separated architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                       Renderer Process                      │
│  React 18 · Tailwind CSS · Lucide Icons · xterm.js · Vite   │
│  UI: Dual-pane explorer, TabBar, Terminals, Modals          │
└──────────────────────────────┬──────────────────────────────┘
                               │ (ContextBridge: window.multissh)
┌──────────────────────────────▼──────────────────────────────┐
│                        Preload Layer                        │
│  src/preload/index.ts · contextBridge.exposeInMainWorld     │
│  Strict typed API facade (MultiSSHApi)                      │
└──────────────────────────────┬──────────────────────────────┘
                               │ (IPC Channels)
┌──────────────────────────────▼──────────────────────────────┐
│                         Main Process                        │
│  src/main/index.ts · src/main/IpcBridge.ts                  │
│  Node.js environment: node-pty, AWS S3 SDK, fs, net, ssh CLI │
│  StorageRegistry · TransferQueue · ProfileStore (safeStorage)│
│  SSHPtyManager · AskpassServer · AgentLifecycleManager       │
└─────────────────────────────────────────────────────────────┘
```

### Process Sandboxing & Security
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- The renderer has **zero** direct access to Node.js built-ins (`fs`, `child_process`, `net`).
- All communication must go through `src/shared/types/ipc.ts` and `src/preload/index.ts`.

---

## 2. Directory Structure & Key Modules

```
├── docs/                           # Architecture, comparison, and subsystem guides
│   ├── COMPARISON.md               # Detailed comparison vs PuTTY, MobaXterm, WinSCP, S3 Browser
│   └── KUBERNETES.md               # Kubernetes architecture, file access & ephemeral container limits
├── scripts/                        # Automated deploy and release scripts (deploy.sh)
├── src/
│   ├── main/                       # Electron main process (Node.js)
│   │   ├── index.ts                # Application lifecycle, window creation, quit hooks
│   │   ├── IpcBridge.ts            # Central IPC handler registration & event dispatching
│   │   ├── aws/                    # AWS SSO OIDC device auth service (AwsSsoAuthService)
│   │   ├── crypto/                 # System CA trust store & SecretFieldCrypto
│   │   ├── dirsync/                # Directory diff and synchronization engine
│   │   ├── dotfiles/               # Dotfiles pool store and SFTP sync service
│   │   ├── editor/                 # Temporary external file editor service
│   │   ├── profile/                # OS keychain encrypted profile store (safeStorage)
│   │   ├── proxy/                  # HTTP/SOCKS socket creation & proxyCli helper
│   │   ├── search/                 # Local/remote regex search & live log tailing (tail -f)
│   │   ├── services/               # K8s discovery, debug containers, port forward & OpenShift
│   │   ├── session/                # Window tab & layout persistence (SessionStore)
│   │   ├── settings/               # App configuration & default settings (SettingsStore)
│   │   ├── update/                 # Auto-update polling & state machine (UpdateService, electron-updater)
│   │   ├── smartcard/              # PKCS#11 detection, cert parsing & isolated AskpassServer
│   │   ├── ssh/                    # SSH PTY manager, HostKeyVerifier, SSHTunnelManager, AgentLifecycle
│   │   ├── storage/                # Local, SFTP, S3, and K8s Pod Storage Providers & Registry
│   │   │   └── sftp/               # OpenSSH-based SFTP engine (protocol, streams, process, adapter)
│   │   ├── terminal/               # K8s container exec PTY & live log streaming managers
│   │   ├── transfer/               # Streaming TransferPipeline, ByteMeter & TransferQueue
│   │   └── x11/                    # X11 server lifecycle manager (VcXsrv integration)
│   ├── preload/                    # Electron preload script exposing window.multissh
│   ├── renderer/                   # React frontend
│   │   └── src/
│   │       ├── App.tsx             # Root component, keyboard shortcuts, tab views
│   │       ├── components/
│   │       │   ├── ConnectionModal/# Profile management for SSH, S3, and Kubernetes
│   │       │   ├── FileManager/    # DualPaneExplorer, FileList, FilePane, ContextMenu
│   │       │   ├── K8s/            # Pod inspector, port forward modal, debug container UI
│   │       │   ├── SettingsModal/  # Preferences & shortcut configuration
│   │       │   ├── TabBar.tsx      # Draggable/closable tab bar
│   │       │   ├── TerminalView.tsx# xterm.js terminal instance & FitAddon
│   │       │   └── Tunnels/        # Independent SSH port-forwarding management dashboard
│   │       └── lib/
│   │           └── format.ts       # Byte/speed formatting, date formatters, path utils
│   └── shared/                     # Types shared between main and renderer
│       └── types/
│           ├── dotfiles.ts         # Dotfiles sync pool contracts
│           ├── ipc.ts              # IPC_CHANNELS and MultiSSHApi interface
│           ├── k8s.ts              # Kubernetes cluster, pod, and container exec types
│           ├── session.ts          # Tab, pane, and split layout types
│           ├── settings.ts         # AppSettings and keyboard shortcut definitions
│           ├── ssh.ts              # SSHConnectionConfig, PtyOptions, Smartcard
│           ├── storage.ts          # IStorageProvider, FileEntry, S3Config, SFTPConfig
│           └── tunnel.ts           # Standalone tunnel configs & lifecycle events
└── tests/                          # Unit and integration tests (Vitest)
    ├── e2e/                        # End-to-end workflow tests
    ├── main/                       # Main process tests (providers, stores, transfers)
    └── renderer/                   # React component testing (Testing Library, JSDOM)
```

---

## 3. Storage Provider Architecture (`IStorageProvider`)

All file and object interactions adhere to the `IStorageProvider` interface in [`src/shared/types/storage.ts`](file:///home/alun/sshs3/src/shared/types/storage.ts):

```typescript
export interface IStorageProvider {
  readonly id: string;
  readonly name: string;
  readonly type: StorageType; // 'local' | 'sftp' | 's3'

  list(remotePath: string, options?: { force?: boolean }): Promise<FileEntry[]>;
  stat(remotePath: string): Promise<FileEntry>;
  createFolder(remotePath: string): Promise<void>;
  delete(remotePath: string, isDirectory: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  createReadStream(remotePath: string, start?: number, end?: number): Promise<NodeJS.ReadableStream>;
  createWriteStream(remotePath: string, options?: WriteStreamOptions): Promise<NodeJS.WritableStream>;
  chmod?(remotePath: string, mode: number | string): Promise<void>;
  disconnect?(): Promise<void>;
}
```

### SFTP engine (`src/main/storage/sftp/`)

`SFTPStorageProvider` no longer uses a JavaScript SSH library. It drives the system OpenSSH client:

- `OpenSshSftpProcess` spawns `ssh <args from SmartcardDetector.buildSSHArguments> -o BatchMode=no -s -- [user@]host sftp` and watches stderr for touch-presence prompts. The `-s` flag makes the trailing word a *subsystem name*, so it must come after the destination. Authentication, ProxyJump, `~/.ssh/config`, FIDO2 and PKCS#11 are therefore handled by OpenSSH exactly as in the terminal.
- `AskpassServer` supplies passwords/PINs/passphrases (`SSH_ASKPASS`) and routes PIN prompts to the renderer PIN modal. OpenSSH's "continue connecting" host-key question is answered through the TOFU dialog (`hostVerifier.hostKeyPrompt`) and rejected if no handler exists (fail closed).
- `SftpPacketProtocol` implements SFTP v3 framing and request/response routing; `SftpStreams` provides `SftpReadStream`/`SftpWriteStream` with Node backpressure.
- `OpenSshSftpClientAdapter` exposes the `ssh2-sftp-client`-style surface that `SFTPStorageProvider` consumes, and provides `exec()`/`createExecStream()` for tail and remote search (multiplexed over the `ControlPath` socket, kept in a private 0700 temp directory).
- Password profiles pass `PubkeyAuthentication=no` (in `buildSSHArguments`) so a touch/PIN-protected agent key can't block the password login.

See `docs/openssh-sftp-migration-plan.md` for the design and deviations.

### In-Memory Streaming Pipeline
Transfers between different storage providers (e.g. SFTP -> S3, S3 -> Local, Local -> SFTP) stream directly in-memory via Node.js streams through [`TransferPipeline.ts`](file:///home/alun/sshs3/src/main/transfer/TransferPipeline.ts):
- `ByteMeter` calculates speed and throttles progress events to 100ms intervals.
- `PauseController` provides pause/resume capabilities over streams without closing connections.
- Path normalization uses `joinPaths` and prevents duplicate nesting by ensuring `getBaseName(targetPath) !== baseName`.

---

## 4. How to Add a New Feature (AI Guide)

### Adding an IPC Method
1. **Define Channel & Types**:
   - Open [`src/shared/types/ipc.ts`](file:///home/alun/sshs3/src/shared/types/ipc.ts).
   - Add channel constant to `IPC_CHANNELS`.
   - Add method signature to `MultiSSHApi`.
2. **Preload Exposure**:
   - Open [`src/preload/index.ts`](file:///home/alun/sshs3/src/preload/index.ts).
   - Implement the method on `api` using `ipcRenderer.invoke` or `ipcRenderer.on`.
3. **Main Process Implementation**:
   - Open [`src/main/IpcBridge.ts`](file:///home/alun/sshs3/src/main/IpcBridge.ts).
   - Register the handler using `this.registerHandler(IPC_CHANNELS.MY_ACTION, async (...) => { ... })`.
4. **Renderer Usage**:
   - Access via `window.multissh.myAction(...)`.

---

## 5. Coding & Formatting Conventions

- **Date Format**: Always display and persist timestamps in `yyyy-mm-dd HH:mm` (24-hour) format. Use `formatDateTime()` from [`src/renderer/src/lib/format.ts`](file:///home/alun/sshs3/src/renderer/src/lib/format.ts) or `formatDate()` from [`src/main/storage/StorageProvider.ts`](file:///home/alun/sshs3/src/main/storage/StorageProvider.ts).
- **Release Versioning**: Bump the patch segment by default (`0.96.6` → `0.96.7`); bump minor only for real milestones. Tag as `vX.Y.Z` and add a `CHANGELOG.md` entry in every release.
- **Security & Ephemeral Secrets**: Private keys must never leave hardware tokens. PINs and passphrases are strictly ephemeral and must never be stored on the filesystem, cached in memory, or logged in plaintext.
- **Electron Fuses**: set in `electron-builder.json` (`electronFuses`). `runAsNode` must stay enabled: askpass, `certWorker.cjs`, the K8s shims and the proxy `ProxyCommand` (`proxyCli.cjs`) run through the app binary with `ELECTRON_RUN_AS_NODE=1`. `NODE_OPTIONS` and `--inspect` are disabled for the app itself and `onlyLoadAppFromAsar` is on. Verify a packaged build with `npx @electron/fuses read --app <path-to-binary>`.
- **Fast Refresh Cleanliness**: React component files should only export React components. Helper functions belong in `types.ts` or utility files, and hooks belong in dedicated files or contexts.
- **Fail Closed for Security**: Host key verification (TOFU) and smartcard askpass operations must default to rejecting/aborting if the UI is unmounted or unavailable.
- **Async Write Safety**: All stores (`ProfileStore`, `SessionStore`, `SettingsStore`, `DotfilePoolStore`) use `queueMutation` promises to ensure sequential, atomic writes to disk.

---

## 6. Verification & Quality Commands

Always run these checks before finishing any task:
```bash
npm run typecheck   # Static typecheck with TypeScript
npm run lint        # ESLint verification (must be 0 errors, 0 warnings)
npm run test        # Unit & integration tests via Vitest
npm run build       # Verify Vite & electron-builder bundle compilation
npm run deploy      # Bump patch version, commit, tag, and push to GitHub Actions (scripts/deploy.sh)
```
