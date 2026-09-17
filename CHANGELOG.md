# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
