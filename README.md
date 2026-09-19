# sshs3

[![CI](https://github.com/alun-hub/sshs3/actions/workflows/ci.yml/badge.svg)](https://github.com/alun-hub/sshs3/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **A modern, security-focused, cross-platform SSH, SFTP, and S3 client** for Linux and Windows, with smartcard support (PKCS#11 / SITHS / Net iD), split terminal views, a dual-pane file manager, and object storage.

![sshs3 icon](build/icons/128x128.png)

---

## Overview

**sshs3** is an Electron desktop app that pairs a full xterm.js terminal with a dual-pane file explorer for SFTP and S3-compatible object storage (AWS, MinIO, NetApp). It's built for sysadmins, DevOps, and developers who work across many servers, connect through jump hosts/bastions, and need hardware-token (smartcard) authentication.

Under the hood it's a fairly thin, security-conscious shell around a handful of proven building blocks: your system's own `ssh` binary drives the terminal (so `~/.ssh/config`, agents, and aliases just work), `ssh2`/`ssh2-sftp-client` power file transfers, and the AWS SDK talks to any S3-compatible endpoint. See [How it works](#how-it-works) below for the architecture, and [Built on open source](#built-on-open-source) for the full list of libraries this project depends on.

---

## Features

### Terminal, tabs & split view
- **Real OpenSSH process via `node-pty`** — the terminal spawns your system's actual `ssh` binary, not a JS reimplementation, so `~/.ssh/config`, `ssh-agent`, host aliases, and every OpenSSH option behave exactly as they do on the command line.
- **Local shell terminals** — open a plain local shell tab (your `$SHELL` on Linux/macOS, or a chosen `cmd`/PowerShell/`pwsh` on Windows) alongside your SSH sessions.
- **Recursive split panes (Konsole-style)** — split any pane right or down from its own mini toolbar, any number of times, nesting freely; each pane keeps its own connection picker and isolated session. Splitting never recreates an existing pane's session (it reparents the pane into a new split, exactly like Konsole's `ViewSplitter`), and closing one specific pane leaves every other pane's session untouched — the tree collapses a split down to its remaining child automatically, so no empty slots are left behind. A one-click "Unsplit" action keeps the active pane and closes the rest.
- **Session persistence** — tabs, pane layouts, and per-pane working directories are saved and restored automatically between restarts.
- **SSH agent lifecycle management** — detects whether `ssh-agent` is already running and, if not, can spawn and manage one itself (Linux/macOS), or detect the Windows OpenSSH Authentication Agent service.

### Smartcard & PKCS#11 authentication
- Built-in support for **SITHS cards**, **Net iD**, **OpenSC**, and **p11-kit**, with automatic detection of installed PKCS#11 modules on Linux and Windows.
- A local **Askpass server** intercepts OpenSSH's PIN prompts over a loopback socket and surfaces them as an in-app PIN dialog, instead of falling back to a terminal prompt or failing silently.
- **PIN caching modes** — one setting under Settings → Security & Smartcard, applied uniformly to every smartcard profile (no per-profile override, since almost everyone has a single physical card and mixing modes for the same card can cause the same PIN to be asked for redundantly, or reintroduce PKCS#11 reader contention between differently-scoped agents):
  - **Always Prompt** *(default)* — no caching. Every connection that needs the card — the interactive terminal and, separately, a dotfiles-sync connection if one is enabled — prompts for its own PIN. Use this where policy requires re-authenticating the card on every login.
  - **Once Per Terminal Connection** — the PIN is entered once into a private, app-managed `ssh-agent` shared by that terminal tab and its dotfiles sync, so opening one tab means one prompt even with dotfiles sync on. The agent is scoped to that terminal, not the app: it's killed the moment the terminal disconnects, and reconnecting — even within the same app run — asks for the PIN again. Auto-reconnects on a dropped connection *do* reuse the still-open agent, so a flaky network doesn't repeatedly ask for the PIN either.
  - **Global (App Lifetime)** — the PIN is entered once per physical card and shared by every terminal and profile using it, for as long as the app keeps running. Most convenient, least strict: the card stays usable by anything in the app until you quit or lock it manually. A **card icon in the top bar** (shown only while this mode is active) opens a popover listing exactly what's currently cached — each unlocked PKCS#11 library and the certificate label(s)/key type it's holding, queried live from the agent — with a **Lock All Now** button to clear it on demand.
  - Every mode spawns its own private `ssh-agent`, never the process's inherited `SSH_AUTH_SOCK` — loading a smartcard into the desktop's own agent (GNOME Keyring, KWallet, …) was found to make the OS prompt for the PIN independently, outside sshs3's own dialog, and to leave the card usable by other applications. Loading the card is retried a few times with a short backoff without re-prompting, since most PIV/CAC readers only support one active transaction at a time and a stray concurrent PKCS#11 session can transiently collide with it; the user is only ever asked for the PIN once per agent load.

### Dual-pane file manager
- Two independent panes, each pointed at local disk, SFTP, or S3, with drag-and-drop between panes and to/from the OS file manager.
- **Background transfer queue** with per-job progress, pause/resume/cancel, and live directory-scan feedback before large folder transfers start.
- **Conflict resolution** dialog (overwrite / skip / rename-with-`(1)`-suffix), with an "apply to all remaining" option.
- **Permissions editor (chmod)** — graphical read/write/execute grid per owner/group/other, octal input, recursive apply — for SFTP and local files.
- Properties, tags, and quick in-pane filtering (`Ctrl+F`).
- **"Open in Terminal"** from an SFTP pane, landing directly in the browsed directory.

### S3 & object storage
- **AWS S3**, **MinIO**, **NetApp StorageGRID**, and any other S3-compatible endpoint, with custom endpoints, region selection, path-style addressing, and self-signed CA support.
- **AWS SSO (IAM Identity Center) login** — sign in through the same OIDC device-authorization flow as `aws sso login`: approve once in your browser, then pick an account and role from the list sshs3 fetches for you. Issues short-lived, browser-approved credentials for an S3 profile instead of a long-lived static access key/secret pair.
- **Bucket/object tagging**, a **bucket policy editor**, **CORS configuration**, and **object versioning** (list, restore, delete specific versions).

### Networking, proxies & SSH tunnels
- **Jump Host / ProxyJump (`-J`)** for both the terminal and SFTP, to reach hosts behind a bastion.
- **Port forwarding**: local (`-L`), remote (`-R`), and dynamic SOCKS (`-D`) tunnels per profile.
- **Outgoing proxy** support (HTTP, SOCKS4, SOCKS5) with authentication, used for both SFTP and S3 connections.
- **Advanced SSH options**: compression, `ServerAliveInterval`, and custom ciphers/KEX algorithms/MACs for older or hardened servers.
- **Host key verification (TOFU)** — SFTP connections are checked against `~/.ssh/known_hosts`-equivalent local storage, with an interactive trust dialog on first contact or on a changed key.
- **System trust store integration** — S3/TLS connections trust your OS's CA bundle (Windows certificate store via `win-ca`, or the Linux distro's CA bundle), so internal/corporate certificate authorities work without extra configuration.

### Dotfiles pool sync *(opt-in)*
- Define a reusable pool of files (`.bashrc`, `.vimrc`, etc.) and assign it to specific SSH profiles.
- On connect, a short-lived background SFTP check compares the pool against the live server and, depending on the profile's policy, either shows a non-blocking banner to review and apply the diff, or updates silently.
- Disabled by default at two levels: a global settings switch, and a per-host pool/policy assignment — nothing runs until both are explicitly turned on.

### Remote profile sync *(opt-in, "own your data")*
- Back up and sync connection profiles, dotfile pools, and app settings to your own S3 bucket or SFTP server — no sshs3-operated cloud service involved.
- **Zero-knowledge, client-side encryption**: everything is encrypted with AES-256-GCM (scrypt-derived keys) before it's uploaded, under **two independent master passwords** — one for topology (hostnames, ports; safe to eventually share with a team) and one for credentials (usernames, saved passwords, API keys, dotfile contents). Neither password, nor the keys derived from them, ever leaves the device.
- **Per-record merge, not overwrite**: pulling changes reconciles each profile/dotfile individually by last-edited timestamp (with tombstones so deletions propagate correctly too), so two machines edited independently don't clobber each other.
- Can optionally sync a managed block inside `~/.ssh/config` and append new entries to `~/.ssh/known_hosts` — everything else in those files is left untouched, and a host-key mismatch between machines is surfaced as a conflict rather than ever auto-resolved.
- **"Import existing profile from the cloud"** bootstraps a brand-new machine straight from an already-configured sync target.
- Configured under Settings → Synchronization.

### Profiles & security
- Organize SSH and S3 profiles into folders/groups, with quick filtering and "recently used" ordering.
- All secrets (passwords, SSH passphrases, S3 keys) are encrypted at rest via Electron's `safeStorage`, backed by the OS keyring (libsecret on Linux, DPAPI on Windows, Keychain on macOS).

### Customization
- Dark, light, and system-following themes.
- Configurable terminal font family/size with a live preview.
- Fully rebindable keyboard shortcuts with interactive key-capture and a reset-to-default option.

---

## How it works

sshs3 is a standard three-process Electron application, kept deliberately thin: the main process owns every privileged operation, and the renderer only ever talks to it through a typed IPC contract.

```
renderer (React, sandboxed, no Node access)
   │  window.multissh.*  (exposed by the preload script via contextBridge)
   ▼
preload  (src/preload) — thin wrapper around ipcRenderer.invoke/on
   ▼
main process (src/main) — IpcBridge routes every channel to a dedicated service
```

- **`IpcBridge`** (`src/main/IpcBridge.ts`) is the single entry point for all `ipcMain.handle` registrations. It doesn't implement logic itself — it wires typed IPC channels (defined once in `src/shared/types/ipc.ts`, shared between main, preload, and renderer) to the services below, and also drives a few main→renderer "prompt" flows (host-key trust, transfer conflicts, dotfiles sync) where the main process needs an answer from the user before it can continue.
- **Terminal sessions** (`SSHPtyManager`, on top of `node-pty`) spawn the real `ssh` binary as a pseudo-terminal process rather than reimplementing the SSH protocol, which is what makes existing `~/.ssh/config` files, agents, and CLI muscle memory work unmodified. Local shell tabs use the same manager to spawn `$SHELL`/`cmd`/PowerShell instead.
- **File transfers** go through a separate path built on `ssh2`/`ssh2-sftp-client` for SFTP and `@aws-sdk/client-s3` for S3, behind a common `IStorageProvider` interface (`src/main/storage/`) implemented by `LocalStorageProvider`, `SFTPStorageProvider`, and `S3StorageProvider`. This abstraction is what lets the dual-pane file manager copy transparently between local disk, SFTP, and S3 without caring which side is which. Transfers themselves run through a `TransferPipeline`/`TransferQueue` pair that streams data with pause/resume support and progress events, rather than buffering whole files in memory.
- **Host key trust** (`KnownHostsStore`, `HostKeyVerifier`) implements TOFU (trust-on-first-use) verification independent of the OS's own `known_hosts`, since the SFTP path goes through the `ssh2` library rather than the system `ssh` client.
- **Smartcard auth** (`SmartcardDetector`, `AskpassServer`) detects installed PKCS#11 modules on disk and, when a smartcard profile connects, starts a loopback TCP server that OpenSSH's askpass mechanism talks to for the PIN prompt, relayed to an in-app dialog.
- **Smartcard PIN caching** (`SmartcardAgentLoader`, plus agent bookkeeping in `IpcBridge`) implements the three caching modes described above. `loadSmartcardIntoPrivateAgent` always spawns a fresh, private `ssh-agent` via `AgentLifecycleManager.spawnPrivateAgent()` — deliberately never the inherited `SSH_AUTH_SOCK` — loads the card into it via `ssh-add -s`, and retries the mechanical load (not the PIN prompt, which is cached after the first ask) a few times on failure to absorb transient PKCS#11 reader contention. `IpcBridge` then either scopes that agent to one PTY session (killed in the `SSHPtyManager`/`IpcBridge` exit handlers), or caches it in a `pkcs11LibPath`-keyed map for the app's lifetime ('agent-global' mode, cleared on quit or via the top-bar lock action). The interactive terminal authenticates through the cached agent via OpenSSH's `IdentityAgent` option instead of a second direct `-I` login. The same caching resolution runs for the file manager's own SFTP connections (`STORAGE_CONNECT`) and for the dotfiles-sync connection, so a smartcard SFTP profile reuses the cached agent instead of opening a second, independent PKCS#11 session against the same reader — which most PIV/CAC readers reject with "agent refused operation" since they only allow one transaction at a time. It falls back to loading its own short-lived agent only when no cached one is available (e.g. 'always-prompt' mode).
- **`AgentLifecycleManager`** probes for a running `ssh-agent` (or the Windows OpenSSH Authentication Agent service) and can spawn/manage one itself so key-based auth works even if the user hasn't started an agent manually; it also exposes `spawnPrivateAgent()`/`killPrivateAgent()`, used exclusively by the smartcard PIN caching above.
- **`AwsSsoAuthService`** drives the AWS SSO OIDC device-authorization flow (client registration → device code → browser approval → token polling), caching the client registration and issued token the same way the AWS CLI does under `~/.aws/sso/cache`, then uses `@aws-sdk/client-sso` to list accounts/roles and mint short-lived credentials for an S3 profile.
- **Remote profile sync** (`SyncCryptoService`, `ProfileSyncService`, `SyncConfigStore`, `SshNativeFileMerger`) is a separate, opt-in layer on top of the same `IStorageProvider` used by the file manager: it derives two AES-256-GCM keys via scrypt (one per master password), splits each profile into a non-secret "topology" half and a secret "credentials" half before encrypting them into separate files, and merges pulled data back in per-record by timestamp rather than overwriting local state wholesale. `~/.ssh/config`/`known_hosts` handling lives in its own pure-text-merge module, kept deliberately separate from the JSON-record merge logic since they're real files shared with the system's own SSH client.
- **`SystemTrustStore`** reads the OS's CA bundle (via `win-ca` on Windows, or the known Linux distro bundle paths) at startup so S3/TLS connections to internally-issued certificates succeed without manual CA configuration.
- **Persistence** (`ProfileStore`, `SettingsStore`, `SessionStore`, `DotfilePoolStore`, `KnownHostsStore`, `SyncConfigStore`) is all flat JSON under Electron's per-OS `userData` directory, written through a serialized mutation queue to avoid concurrent-write corruption, with secret fields passed through `safeStorage` before hitting disk.
- **Dotfiles sync** (`DotfileSyncService`) opens its own short-lived SFTP connection — separate from the interactive PTY session — to diff and, on approval, atomically write (`temp file + rename`) pool files to a host.

---

## Built on open source

sshs3 wouldn't exist without these projects:

| Project | Role |
| :--- | :--- |
| [Electron](https://www.electronjs.org/) | Cross-platform desktop app shell (Chromium + Node.js) |
| [React](https://react.dev/) | Renderer UI |
| [xterm.js](https://xtermjs.org/) (`xterm`, `@xterm/addon-fit`) | In-browser terminal emulator that renders the PTY output |
| [node-pty](https://github.com/microsoft/node-pty) | Spawns and drives the real `ssh`/shell process as a pseudo-terminal |
| [ssh2](https://github.com/mscdex/ssh2) | SSH2 protocol client used for SFTP connections, tunnels, and host-key handling |
| [ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client) | Promise-based SFTP convenience layer on top of `ssh2` |
| [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3) (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) | S3-compatible object storage operations (AWS, MinIO, NetApp StorageGRID, etc.) |
| [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3) (`@aws-sdk/client-sso`, `@aws-sdk/client-sso-oidc`, `@aws-sdk/credential-provider-sso`) | AWS SSO (IAM Identity Center) device-authorization login, account/role listing, and temporary credentials |
| [win-ca](https://github.com/ukoloff/win-ca) | Reads the Windows certificate store so corporate/self-signed CAs are trusted |
| [Tailwind CSS](https://tailwindcss.com/) | Utility-first styling for the renderer UI |
| [lucide-react](https://lucide.dev/) | Icon set used throughout the UI |
| [TanStack Virtual](https://tanstack.com/virtual) | Virtualized rendering for large file listings |
| [Vite](https://vitejs.dev/) + [vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron) | Dev server and build tooling for renderer, main, and preload bundles |
| [TypeScript](https://www.typescriptlang.org/) | Strict typing shared across main/preload/renderer via `src/shared/types` |
| [Vitest](https://vitest.dev/) + [Testing Library](https://testing-library.com/) | Unit and component test suite |
| [ESLint](https://eslint.org/) + [typescript-eslint](https://typescript-eslint.io/) | Linting |
| [electron-builder](https://www.electron.build/) | Packaging (AppImage/deb/rpm for Linux, NSIS/portable for Windows) and GitHub Releases publishing |

---

## Default keyboard shortcuts

| Action | Default key | Description |
| :--- | :--- | :--- |
| **New Terminal** | `Ctrl+Shift+T` | Opens a new terminal tab |
| **New File Manager** | `Ctrl+Shift+F` | Opens a new file manager tab |
| **Close Tab** | `Ctrl+W` | Closes the active tab |
| **Next Tab** | `Ctrl+Tab` | Cycles to the next tab |
| **Previous Tab** | `Ctrl+Shift+Tab` | Cycles to the previous tab |
| **Connection Manager** | `Ctrl+Shift+O` | Opens saved profiles and connections |
| **Settings** | `Ctrl+,` | Opens the settings panel |
| **Split Vertically** | `Ctrl+Shift+D` | Splits the active pane into two columns |
| **Split Horizontally** | `Ctrl+Shift+E` | Splits the active pane into two rows |

*(All shortcuts are rebindable under Settings → Keyboard Shortcuts.)*

---

## Installation

Prebuilt binaries are available on [GitHub Releases](https://github.com/alun-hub/sshs3/releases):

### Linux
- **AppImage** — no installation required:
  ```bash
  chmod +x sshs3-*.AppImage
  ./sshs3-*.AppImage
  ```
- **DEB (Debian / Ubuntu / Linux Mint)**:
  ```bash
  sudo dpkg -i sshs3_*_amd64.deb
  ```
- **RPM (Fedora / RHEL / openSUSE)**:
  ```bash
  sudo rpm -Uvh sshs3-*.x86_64.rpm
  ```

### Windows
- **NSIS Installer**: `sshs3-Setup-<version>.exe` (installation wizard with a desktop shortcut).
- **Portable**: `sshs3-<version>.exe` (runs directly, no installation).

---

## Development

### Prerequisites
- Node.js 20+
- npm 10+
- A C/C++ build toolchain (for the native `node-pty` module via `node-gyp`)
- On Linux, `rpm` if you intend to package RPMs

### Getting started
```bash
# 1. Clone
git clone https://github.com/alun-hub/sshs3.git
cd sshs3

# 2. Install dependencies
npm install

# 3. Start the dev server with hot reload
npm run dev
```

### Tests & quality checks
```bash
# TypeScript type checking
npm run typecheck

# Lint
npm run lint

# Unit tests (Vitest)
npm run test
```

### Packaging
```bash
# Linux AppImage only
npm run package:appimage

# All Linux targets (AppImage, deb, rpm)
npm run package:linux

# Windows (requires a Windows build environment)
npm run package:win
```

---

## Known Limitations

- **Linux Drag & Drop Cursor Icon**: On some Linux desktop environments (notably GNOME/Wayland or KDE Plasma with certain cursor themes like Breeze), Chromium's native drag-and-drop implementation does not update the mouse cursor bitmap during internal pane-to-pane drags, displaying a "forbidden" or "no-drop" icon (white circle with red slash). This is an upstream Chromium window manager integration quirk; dragging and dropping files between panes and into folders works normally and completely reliably.

---

## Community & Contributing

Contributions are welcome! Please see our:
- [Contributing Guide](CONTRIBUTING.md) for local development setup, code standards, and PR process.
- [Code of Conduct](CODE_OF_CONDUCT.md) for community standards.
- [Security Policy](SECURITY.md) to report vulnerabilities responsibly.
- [Changelog](CHANGELOG.md) for release history and recent updates.

---

## License

This project is licensed under the [MIT License](LICENSE).
