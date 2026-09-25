# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.91] - 2026-09-25

### Fixed
- **Terminal size synchronization on startup & tab activation**:
  - Centralized terminal PTY sizing and fixed issue where terminal dimensions were stuck at 80×24 rows/cols on application startup and tab restoration.
  - Resolved issue where background tabs activating for the first time failed to calculate terminal dimensions due to unmeasured font metrics during `display: none` mount; added forced character metric measurement and scheduled re-sync passes across animation frames and timers.

### Added
- **OpenShift toggle in Settings**:
  - Added an "Enable OpenShift support" setting toggle (`enableOpenShift`) under Settings → General.
  - Conditionally displays the "OpenShift (oc login)" action in the Kubernetes connection tree and starts the local OpenShift CLI shim only when OpenShift support is enabled.
- **OpenShift OAuth token login & CLI shim**:
  - Built-in OpenShift OAuth login and token extraction support.
  - Cross-platform `oc` emulation shim with live kubeconfig watching.

### Changed & Updated Dependencies
- **Tailwind CSS v4 Migration**: Migrated from Tailwind CSS v3 to Tailwind CSS v4 using `@tailwindcss/vite` and native CSS `@theme`.
- **Smartcard Net iD PKCS#11 stability**: Isolated Net iD PKCS#11 crashes and improved fallback when PIN prompting is required.
- Updated dependencies: `jsdom` (30.1.0), `lucide-react` (1.47.0), `typescript-eslint` (8.70.1), and `@types/node` (22.20.4).

---

## [0.9] - 2026-09-24

### Security & Hardening
- **CodeQL workflow permission hardening**: Enforced explicit `permissions: contents: read` in `.github/workflows/ci.yml` adhering to the principle of least privilege.
- **CSS attribute selector sanitization**: Hardened `focusElement` in `FileList.tsx` by escaping backslashes prior to quotes to prevent selector breakout on special path characters.
- **GitHub automated security analysis**: Enabled GitHub Secret Scanning validity checks, non-provider pattern scanning, and Private Vulnerability Reporting (`/security/advisories`).
- **Dependabot configuration & policy**: Added `.github/dependabot.yml` with automated weekly dependency checks, group bundling (`@aws-sdk/*`, `actions/*`), and protection against breaking major peer dependency updates (TypeScript 7, React 19).

### Changed & Updated Dependencies
- Updated AWS SDK packages (`@aws-sdk/client-s3`, `@aws-sdk/client-sso`, `@aws-sdk/client-sso-oidc`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) to `3.1137.0`.
- Updated `electron` to `44.4.3`.
- Updated `eslint` to `10.11.0`, `vitest` to `5.0.1`, and `autoprefixer` to `10.6.1`.
- Upgraded CI and Release GitHub Actions workflows to latest major versions (`actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `softprops/action-gh-release@v3`).
- Added interface screenshots for Kubernetes Pod File Explorer and Live Pod Debugging to `README.md`.

---

## [0.8] - 2026-09-24

### Added
- **Kubernetes Live Pod Debugging (`kubectl debug`)**:
  - Live injection of ephemeral debug containers directly into running pods without restarting them via `K8sDebugService` (`/ephemeralcontainers` subresource).
  - Target container process & IPC namespace sharing (`targetContainerName`), enabling inspecting processes (`ps`), sockets (`netstat`), and filesystems across containers in the same pod.
  - Interactive debugging modal with pre-configured toolsets: **Netshoot** (network troubleshooting), **RHEL Support Tools** (sysstat, strace, gdb, ubi9), **BusyBox** (minimal shell), **Curl** (HTTP/API testing), and **Ubuntu**.
  - Configurable debug image presets in Settings under a new dedicated **Kubernetes & Debug** tab, supporting custom corporate images, registry paths, and default shell commands.
  - Automatically launches an interactive terminal session in the debug container upon attachment.
  - Pod listing and detail views now display ephemeral containers with a distinct `[debug]` / `[Ephemeral Debug]` badge.
- **Kubernetes Pod File Explorer**:
  - Full dual-pane file management inside running Kubernetes/OpenShift containers via `K8sPodStorageProvider` using non-interactive Exec streams.
  - Browse directories, download, upload, create folders, rename, delete, and chmod files directly in container filesystems.
  - In-place file viewing and editing via internal `FileEditorModal` and external editors (`FileEditorService`), streaming changes back on save.
  - "Browse Files" button in `K8sConnectionTree` and `K8sPodDetailModal` to jump directly into a container's filesystem.
  - "Open Terminal Here" inside pod folders to launch an interactive container shell rooted in the current path.

---

## [0.7] - 2026-09-24

### Security & Hardening
- **X11 server isolation & argument sanitization**:
  - Restricted internal X server spawning strictly to Windows platforms.
  - Added binary allowlist (`vcxsrv.exe`, `xming.exe`, `xwin.exe`) preventing execution of arbitrary user-specified binaries.
  - Stripped unsafe `-ac` access control bypass flag from user-supplied server arguments.
- **Smartcard SSH argument injection prevention**:
  - Filtered dangerous OpenSSH directives (`ProxyCommand`, `LocalCommand`, `PermitLocalCommand`, `RemoteCommand`, `Match`, `Include`) from agent argument construction.
  - Stripped newline and carriage return characters from extra option keys and values.
- **Dotfile pool path traversal defense**:
  - Validated pool IDs against path traversal sequences (`..`, path separators) preventing recursive deletion or arbitrary directory wipe.
  - Enforced strict containment within pool master directory for local files.
- **Session credential sanitization**:
  - Recursively scrubbed plaintext passwords and passphrases from session tab trees prior to disk persistence in `session.json` and upon session loading.
- **Electron window navigation hardening**:
  - Added `will-navigate` and `will-redirect` guards to prevent renderer top-level navigation to unauthorized URLs or dropped files.
- **URL scheme validation for AWS SSO**:
  - Enforced `http:`/`https:` scheme validation before launching external browsers for verification URIs.
- **Known hosts line injection defense**:
  - Validated hostnames, ports, and key types to reject line injection and control characters before appending to `~/.ssh/known_hosts`.
- **Command line null-byte stripping**:
  - Stripped null bytes (`\0`) in `quoteShellArg` to prevent POSIX shell command truncation.
- **Cross-platform Kubeconfig resolution**:
  - Used `os.homedir()` instead of `process.env.HOME` for reliable kubeconfig lookup on Windows.

---

## [0.6] - 2026-09-24

### Fixed
- **Kubernetes HTTP/2 stream timeout & process crash**:
  - Intercepted the piped source stream in `K8sLogManager` to handle `undici` HTTP/2 timeouts (`TypeError: terminated`) and remote connection drops gracefully without triggering an unhandled exception dialog.
  - Added stream error listeners in `K8sPortForwardManager` and `K8sTerminalManager`.
  - Added a global `uncaughtException` protection in the Electron main process to safely ignore benign stream timeouts and transient socket disconnects.

---

## [0.5] - 2026-09-24

### Added
- **File manager desktop & Windows ergonomics**:
  - Auto-scroll when dragging items near top or bottom edges of the file list via `requestAnimationFrame`.
  - Neutral drop zone at the bottom of the file list and interactive breadcrumb segments as drop targets, allowing files to be safely dropped into current folder root or ancestor paths.
  - Spring-loaded folders (hover-to-open after 900ms) on folder rows and breadcrumb segments during drag operations.
  - File clipboard operations (`Ctrl+C` copy, `Ctrl+X` cut with visual dimming, `Ctrl+V` paste) available through keyboard shortcuts and context menus.
  - Directory navigation history per pane with toolbar Back/Forward buttons, `Alt+Left`/`Alt+Right` shortcuts, and mouse back/forward button support.
  - Windows keyboard navigation shortcuts: `F2` to rename, `F5` to refresh directory, `Alt+Up` to navigate to parent directory, and `Escape` to cancel active drag operations.
- **Kubernetes pod describe & events viewer**:
  - Detailed pod inspector modal (`K8sPodDetailModal`) showing status, conditions, IP addresses, node placement, containers, and live event stream.
- **Kubernetes port forwarding**:
  - Forward local ports to cluster pods with auto-assignment of non-privileged ports, traffic buffering, and one-click browser launch (`K8sPortForwardModal` & `K8sPortForwardManager`).

### Fixed
- **Smartcard PKCS#11 concurrent access**:
  - Read certificate details prior to `ssh-add -s` invocation to eliminate token session contention and prevent driver crashes (e.g. Net iD SIGTRAP).
- **Kubernetes port forward session initialization**:
  - Fixed variable assignment in port forward manager session creation.

---

## [0.4] - 2026-09-23

### Added
- **OpenShift Projects & RBAC fallback**:
  - Automatic fallback to OpenShift Projects API (`project.openshift.io/v1`) when `client.listNamespace()` fails with `403 Forbidden` for non-cluster-admin users.
  - Secondary fallback to `context.namespace` from `~/.kube/config` for heavily restricted developer accounts.
  - Support for OpenShift project display names (`openshift.io/display-name`) in the tree view.
  - OpenShift cluster detection badge in the cluster list.
  - Real-time search filter in the Kubernetes dialog to quickly filter across clusters, projects, and pods.

### Fixed
- **Terminal title detection** — Added `oc`, `helm`, `minikube`, `k9s`, and `crc` to disallowed title prefixes to prevent active CLI commands from being mistakenly recognized as remote hostnames.
- **File descriptor leak on Linux local terminals** — Wrapped local shell execution in `/bin/sh` to close leaked Electron file descriptors (such as GPU and Dawn caches) before executing the user's shell, preventing SELinux AVC denials when running tools like `kubectl`/`k3s` and `iptables-restore`.

---

## [0.3] - 2026-09-23

### Added
- **Kubernetes / OpenShift cluster exploration & exec terminal** — Added a new "Kubernetes" tab in the Connection Manager and "+" tab menu:
  - `K8sDiscoveryService` parses `~/.kube/config` and lazily inspects cluster contexts, namespaces, pods, and containers without blocking on unreachable clusters.
  - `K8sTerminalManager` runs interactive exec sessions into containers over WebSockets, functioning seamlessly inside the tab/pane layout.
  - `K8sLogManager` & `K8sLogView` stream live container logs into resizable panes with search support via `@xterm/addon-search` and safe abort handling.
  - Lazy-loads `@kubernetes/client-node` on first use to preserve app startup speed.

### Fixed
- **Smartcard certificate cache** — Cached certificate details at agent load instead of querying the PKCS#11 token on every dropdown open, eliminating session contention and process crashes with drivers like Net iD.

---

## [0.2.24] - 2026-09-22

### Added
- **Certificate details in "Cached smartcard identities"** — each cached identity in the top-bar smartcard popover (`TabBar.tsx`) can now be expanded to show its certificate's Subject, UPN (Microsoft `otherName` SAN, common on PIV/CAC/SITHS cards), and validity period. Reads the certificate directly from the same PKCS#11 module (`.so`/`.dll`) already used for `ssh-add -s`, via a new `pkcs11js` native binding ([SmartcardCertificateReader.ts](src/main/smartcard/SmartcardCertificateReader.ts)) — not a vendor CLI tool like OpenSC's `pkcs11-tool`, which isn't installed at all for providers such as Net iD. Matches each certificate to its `ssh-add`-reported identity by independently computing the SSH fingerprint of the certificate's public key ([CertificateParser.ts](src/main/smartcard/CertificateParser.ts)), including a small hand-written DER walker for the UPN extension, which Node's built-in `X509Certificate` doesn't decode.

---

## [0.2.23] - 2026-09-22

### Fixed
- Fixed two tests that deterministically failed the Windows leg of the release build (blocking every release since 0.2.21): both asserted Unix-only `ssh-agent` spawn/injection behavior without accounting for `process.platform === 'win32'`, where that's intentionally skipped ([AgentLifecycleManager.test.ts](tests/main/AgentLifecycleManager.test.ts), [SSHPtyManager.test.ts](tests/main/SSHPtyManager.test.ts)).

---

## [0.2.22] - 2026-09-22

### Added
- New **directory sync** between any two hosts (local/SFTP/S3, including remote↔remote): right-click a folder in the dual-pane file manager and choose "Sync to..." to compute a size+mtime diff against a target (defaulting to the other pane), review a New/Changed/Only-in-target report — including a per-file content **Compare** view — choose what to apply, and optionally delete files missing from the source. Sync pairs can be saved and re-run as named profiles from a "Saved Sync Profiles" list, always re-diffing before applying ([DirectorySyncService.ts](src/main/dirsync/DirectorySyncService.ts), [DirectorySyncModal.tsx](src/renderer/src/components/FileManager/DirectorySyncModal.tsx), [FileDiffModal.tsx](src/renderer/src/components/FileManager/FileDiffModal.tsx)).
- `IStorageProvider` gained an optional `setModifiedTime()`, implemented for local disk and SFTP, so a directory sync copy preserves the source's original modification time on the target instead of taking the write time — otherwise every synced file would look "changed" again on the very next re-sync ([storage.ts](src/shared/types/storage.ts), [LocalStorageProvider.ts](src/main/storage/LocalStorageProvider.ts), [SFTPStorageProvider.ts](src/main/storage/SFTPStorageProvider.ts)).

---

## [0.2.21] - 2026-09-21

### Added
- New opt-in **"Unlock smartcard at app startup"** toggle (Settings → Security & Smartcard, only shown under 'agent-global' PIN caching): prompts for the PIN as soon as the app opens instead of waiting for the first connection that needs it, so the card is already unlocked by the time you open your first terminal — including a local shell tab, which otherwise triggers no smartcard prompt on its own. Prefers `p11-kit` when it's among the detected PKCS#11 libraries (it proxies every other registered module, so e.g. `p11-kit-proxy.so` and `opensc-pkcs11.so` coexisting is one physical card reachable two ways, not two cards to pick between); otherwise only acts when exactly one non-p11-kit library is detected ([IpcBridge.ts](src/main/IpcBridge.ts)).

### Fixed
- Fixed local shell terminal tabs not reliably getting the app's own managed `ssh-agent`: `SSH_AUTH_SOCK` is now set explicitly rather than relying on inherited `process.env`, and — when a smartcard is cached under 'agent-global' PIN caching — points at that same cached agent instead of a generic default one, so an already-unlocked card is immediately usable from a plain shell too ([SSHPtyManager.ts](src/main/ssh/SSHPtyManager.ts), [IpcBridge.ts](src/main/IpcBridge.ts)).
- Fixed a race condition in `AgentLifecycleManager.ensureAgent()` where a caller arriving while a spawn was already in flight got a stale/premature status snapshot instead of the actual final result, which could leave a local shell tab opened right at startup (e.g. one restored from session) with no `SSH_AUTH_SOCK` override at all ([AgentLifecycleManager.ts](src/main/ssh/AgentLifecycleManager.ts)).

---

## [0.2.20] - 2026-09-20

### Added
- Remote Profile Sync now generates the managed `~/.ssh/config` block directly from your saved SSH profiles (host/port/user/identity file/proxy jump/etc.) on every push, instead of only mirroring a hand-written block — so a plain `ssh <alias>` in any terminal picks up the same settings as the matching profile ([SshNativeFileMerger.ts](src/main/services/SshNativeFileMerger.ts), [ProfileSyncService.ts](src/main/services/ProfileSyncService.ts)).
- Terminal tabs and split panes now dynamically retitle themselves to track the current remote host as you `ssh` onward from one machine to another, instead of staying fixed to the original connection ([terminalTitle.ts](src/renderer/src/lib/terminalTitle.ts), [App.tsx](src/renderer/src/App.tsx), [TerminalView.tsx](src/renderer/src/components/TerminalView.tsx)).
- Settings → Terminal and the connection profile form now detect native Linux X11/Wayland and show a Linux-specific status instead of the Windows-only VcXsrv server controls ([XServerManager.ts](src/main/x11/XServerManager.ts), [SettingsModal.tsx](src/renderer/src/components/SettingsModal/SettingsModal.tsx)).

### Fixed
- Fixed private smartcard `ssh-agent` processes/sockets under `~/.ssh/agent` leaking past app quit: `dispose()` detached the PTY-exit listener that normally reaps them before calling `killAll()`, so per-session agents were never killed on exit ([IpcBridge.ts](src/main/IpcBridge.ts)).
- Fixed `PROFILE_SYNC_LINK_SMARTCARD`/`PROFILE_SYNC_UNLOCK_SMARTCARD` always spawning a fresh private agent (and re-prompting for the PIN) even when 'agent-global' PIN caching mode already had one cached for that card ([IpcBridge.ts](src/main/IpcBridge.ts)).
- Fixed local shell terminal tabs not reliably inheriting the app's own managed `ssh-agent`: `SSH_AUTH_SOCK` is now set explicitly from `AgentLifecycleManager` instead of relying on `process.env` inheritance alone ([SSHPtyManager.ts](src/main/ssh/SSHPtyManager.ts)).

### Docs
- Corrected several stale README claims found by auditing recent commits: bundled VcXsrv args no longer document the removed `-ac` (access-control-disabling) flag, ECDSA smartcard sync-unlock limitations are now described accurately, and the `~/.ssh/config` sync bullet reflects profile-based generation.

---

## [0.2.19] - 2026-09-20 15:27

### Fixed
- Fixed the light/dark theme toggle leaving both `dark` and `light` classes on `<html>` simultaneously, so Tailwind `dark:` variant colors (e.g. the destructive-action red in the file manager's right-click menu) kept incorrectly applying while in light mode ([App.tsx](src/renderer/src/App.tsx)).
- Fixed the Security & Smartcard settings panel unconditionally claiming "OS Keychain Encryption Active" regardless of actual status; it now reflects the real `getSecurityStatus()` result, matching the plaintext-credentials warning banner added in 0.2.18 ([SettingsModal.tsx](src/renderer/src/components/SettingsModal/SettingsModal.tsx)).

---

## [0.2.18] - 2026-09-20 11:32

### Security
- Fixed a shell command injection in the SSH `ProxyCommand` built for HTTP/SOCKS proxy connections: proxy host/destination host are now validated against a safe hostname charset, and proxy username/password are passed via environment variables instead of being interpolated into the shell string ([`SmartcardDetector.ts`](src/main/smartcard/SmartcardDetector.ts), [`proxyCli.cjs`](src/main/proxy/proxyCli.cjs), [`SSHPtyManager.ts`](src/main/ssh/SSHPtyManager.ts)).
- Fixed the bundled X11 server (VcXsrv) being reachable with no authentication: removed `-ac` (which disabled X11 access control) and narrowed the Windows Firewall rule from all networks to Private/Domain only ([`XServerManager.ts`](src/main/x11/XServerManager.ts), [`installer.nsh`](build/installer.nsh)).
- Fixed arbitrary ssh_config directive injection (`ProxyCommand`, `LocalCommand`, `PermitLocalCommand`, `RemoteCommand`, `Match`, `Include`) via Remote Profile Sync's `~/.ssh/config` mirroring: these directives are now stripped before any synced block is written to the user's real ssh config ([`SshNativeFileMerger.ts`](src/main/services/SshNativeFileMerger.ts)).
- Fixed a path traversal in dotfiles pool sync that allowed a `remotePath` with `../` segments to write outside the connected server's home directory ([`DotfileSyncService.ts`](src/main/dotfiles/DotfileSyncService.ts)).
- Fixed smartcard-only Remote Profile Sync unlock (no saved master password) deriving a different, non-reproducible key on every unlock for ECDSA-backed cards; now refuses that mode for ECDSA keys with a clear error, and uses a fixed derivation message (instead of the random liveness challenge) for the Ed25519/RSA cards where it can work reliably ([`SmartcardSyncService.ts`](src/main/smartcard/SmartcardSyncService.ts), [`IpcBridge.ts`](src/main/IpcBridge.ts)).
- Added a UI warning when saved SSH/S3 credentials can't be encrypted via the OS keyring and are falling back to plaintext on disk ([`CredentialEncryptionWarningBanner.tsx`](src/renderer/src/components/CredentialEncryptionWarningBanner.tsx)).
- Hardened the external file editor's temporary directory/file permissions to owner-only (`0700`/`0600`) on multi-user systems ([`FileEditorService.ts`](src/main/editor/FileEditorService.ts)).

---

## [0.2.9] - 2026-09-17 19:41

### Security
- Upgraded `electron` from `31.7.7` to `44.4.1`, resolving 23 Chromium/V8 vulnerabilities and replacing vulnerable `extract-zip` and `cacheable-request` subdependencies with secure modern packages (0 audit vulnerabilities).

---

## [0.2.8] - 2026-09-17 19:33

### Added
- Virtual scrolling in [`FileList.tsx`](src/renderer/src/components/FileManager/FileList.tsx) using `@tanstack/react-virtual` for fast rendering of directories with 10,000+ files.
- Dynamic code-splitting in Vite / Rolldown build separating `xterm`, `react-vendor`, and `lucide-react` bundles.
- Terminal scrollback replay buffer (128 KB) and auto-reconnect logic in [`SSHPtyManager.ts`](src/main/ssh/SSHPtyManager.ts) when SSH connections drop unexpectedly.
- End-to-end cross-provider transfer integration test suite [`TransferCrossProviderE2E.test.ts`](tests/main/TransferCrossProviderE2E.test.ts).
- Local shell terminals for Windows (PowerShell/CMD) and Linux/macOS (bash/zsh) via [`LocalPtyManager.ts`](src/main/ssh/LocalPtyManager.ts).
- SSH agent auto-spawning and Windows Pageant/OpenSSH service detection in [`AgentLifecycleManager.ts`](src/main/ssh/AgentLifecycleManager.ts).
- Opt-in dotfiles pool synchronization on SSH connections ([`DotfilePoolStore.ts`](src/main/dotfiles/DotfilePoolStore.ts) & [`DotfileSyncService.ts`](src/main/dotfiles/DotfileSyncService.ts)).
- Open source project documentation: [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), [`SECURITY.md`](SECURITY.md), and GitHub issue/PR templates.
- Explicit MIT License in [`LICENSE`](LICENSE) and [`package.json`](package.json).

### Fixed
- Fixed ESM `ReferenceError: __dirname is not defined` and missing `proxyCli.cjs` packaging in electron-builder.
- Fixed directory duplicate subfolder nesting bug in [`TransferPipeline.ts`](src/main/transfer/TransferPipeline.ts) and [`TransferQueue.ts`](src/main/transfer/TransferQueue.ts).
- Resolved Vite Fast Refresh component export warnings in `DragDropLayer.tsx` and `FilePane.tsx`.
- Resolved tab recycling, system trust store, and S3/SFTP transfer boundary bugs.

---

## [0.2.7] - 2026-09-17 18:00

### Added
- Opt-in dotfiles pool synchronization on SSH connections (`DotfilePoolStore.ts` & `DotfileSyncService.ts`).
- Dual-pane file manager with drag-and-drop transfers across Local, SFTP, and S3 providers.
- Smartcard PKCS#11 authentication detector and native Askpass server.
- TOFU (Trust On First Use) host key verification and encrypted known hosts storage.
- Comprehensive `ARCHITECTURE.md` developer guide.
