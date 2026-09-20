# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
