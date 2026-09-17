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
│  Node.js environment: node-pty, ssh2, AWS S3 SDK, fs, net   │
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
sshs3/
├── src/
│   ├── main/                       # Electron main process (Node.js)
│   │   ├── index.ts                # Application lifecycle, window creation, quit hooks
│   │   ├── IpcBridge.ts            # Central IPC handler registration & event dispatching
│   │   ├── crypto/                 # System CA certificate trust store (SystemTrustStore)
│   │   ├── dotfiles/               # Dotfiles pool store and SFTP sync service
│   │   ├── profile/                # OS keychain encrypted profile store (safeStorage)
│   │   ├── proxy/                  # HTTP/SOCKS socket creation & proxyCli helper
│   │   ├── session/                # Window tab & layout persistence (SessionStore)
│   │   ├── settings/               # App configuration & default settings (SettingsStore)
│   │   ├── smartcard/              # PKCS#11 detection & AskpassServer for PIN prompt
│   │   ├── ssh/                    # SSH PTY manager, HostKeyVerifier, KnownHostsStore
│   │   ├── storage/                # Local, SFTP, and S3 Storage Providers & Registry
│   │   └── transfer/               # Streaming TransferPipeline, ByteMeter & TransferQueue
│   ├── preload/                    # Electron preload script exposing window.multissh
│   ├── renderer/                   # React frontend
│   │   └── src/
│   │       ├── App.tsx             # Root component, keyboard shortcuts, tab views
│   │       ├── components/
│   │       │   ├── ConnectionModal/# Profile management for SSH and S3
│   │       │   ├── FileManager/    # DualPaneExplorer, FileList, FilePane, ContextMenu
│   │       │   ├── SettingsModal/  # Preferences & shortcut configuration
│   │       │   ├── TabBar.tsx      # Draggable/closable tab bar
│   │       │   └── TerminalView.tsx# xterm.js terminal instance & FitAddon
│   │       └── lib/
│   │           └── format.ts       # Byte/speed formatting, date formatters, path utils
│   └── shared/                     # Types shared between main and renderer
│       └── types/
│           ├── dotfiles.ts         # Dotfiles sync pool contracts
│           ├── ipc.ts              # IPC_CHANNELS and MultiSSHApi interface
│           ├── session.ts          # Tab, pane, and split layout types
│           ├── settings.ts         # AppSettings and keyboard shortcut definitions
│           ├── ssh.ts              # SSHConnectionConfig, PtyOptions, Smartcard
│           └── storage.ts          # IStorageProvider, FileEntry, S3Config, SFTPConfig
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
```
