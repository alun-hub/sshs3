# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 2D spatial keyboard navigation (Ctrl+Shift+Arrows) across tabs, terminal splits, file manager panes, modals, menus, landing view and unconnected panes; Enter activates, Escape closes/backs out
- local terminals inherit the system/login-shell ssh-agent (setting: Local Terminal SSH Agent)
- saved SSH profiles are kept in the sshs3-managed block of `~/.ssh/config` (setting: Keep ~/.ssh/config in sync; on by default)

### Changed
- **Global (App Lifetime)** PIN caching now keeps every unlocked smartcard and FIDO2 key in **one** app-wide ssh-agent with a stable socket (`$XDG_RUNTIME_DIR/sshs3/agent.sock`) instead of one agent per card. Local terminals always point at it (so a card unlocked later works in already-open tabs), the lock icon makes the agent forget its keys without restarting it, and Remote Profile Sync picks the right card's key. The app's own SSH/SFTP connections through it are pinned to the profile's card with `IdentitiesOnly` and a public key file
- startup unlock loads the PIV card before the FIDO2 key
- under Global PIN caching, unlocked smartcards and FIDO2 keys now also work for a plain `ssh <alias>` in any terminal: a local-only block in `~/.ssh/config` (never synced, removed on lock/quit) points those hosts at the app agent with `IdentitiesOnly` and the card's public key, so no PIN prompt
- a PKCS#11 module that exposes a card already unlocked through another module (e.g. libykcs11 after p11-kit-proxy) is no longer loaded again, so there is no second PIN prompt or PKCS#11 session
- the lock button in the cached smartcard identities menu toggles: **Lock All Now** while something is unlocked, **Unlock Now** when nothing is, so you can unlock again after locking without restarting the app (works regardless of the "unlock at startup" setting)

### Fixed
- Enter/Escape inside a modal were swallowed while the tab bar had keyboard focus
- focus returns to the opener when a top-level modal closes
- keyboard focus in the file manager: Ctrl+Shift+Arrows now actually focus the file list (inactive tabs no longer swallow it, the pane wrapper isn't focusable), and focus stays in the list after opening a folder with Enter
- a FIDO2 key's per-signature PIN prompt through the app agent was labelled "Smartcard / PIV"; it is now a FIDO2 prompt, and the PIN entered when the keys were unlocked is reused for signatures (only the touch is asked for) until the keys are locked
- concurrent `~/.ssh/config` writes are serialized; failures are logged; profile fields can no longer inject extra directive lines

## [0.96.22] - 2026-10-04

### Added
- dotfiles pool manager redesign: pick individual files explicitly, files grouped by target directory with read-only preview, source status (up to date / changed / missing) and Refresh
- unsaved/saved indicator when editing a pool

### Fixed
- dotfile target path keeps the directory (e.g. ~/.kube/config instead of ~/.config)
- device-local dotfile source paths are no longer accepted from remote sync

### Changed
- dotfile pool content is no longer edited in the modal (use Open Master Directory)

## [0.96.21] - 2026-10-04

### Added
- clickable links/paths, snippets, search, copy last output

### Fixed
- address code-review findings and document new terminal features

## [0.96.20] - 2026-10-04

### Added
- encrypted clipboard history for terminal selections
- prune old GitHub releases after a release

### Fixed
- address code-review findings
- never persist history in plaintext
- hide the Ping cell in the performance bar for local shell panes

### Changed
- restore SettingsModal formatting
- refresh README screenshots for the updated Breeze UI

## [0.96.19] - 2026-10-04

### Added
- Overflow ("...") menu for the secondary actions on SSH profile rows in the Connection Manager (install public key, tunnels, duplicate, delete), with arrow-key navigation
- Source | Preview segmented control in the Markdown editor, so the current mode is always visible
- Collapsible "Recently Used" section in the Connection Manager
- Contrast audit tool for the desktop app (`contrast-audit.mjs` in the run-desktop skill)

### Changed
- Denser desktop layout: smaller file-list rows, compact pane toolbars, tab bar, transfer drawer and performance bar, right-aligned tabular numbers, and a shorter "Perms" column header aligned with its values
- Terminal: the redundant single-pane title bar is gone and the performance bar follows the theme in dark, light and Breeze
- Fixed-height Settings and Connection Manager dialogs, so they no longer jump between tabs and categories
- Much stronger contrast in the light theme (borders, text, filled buttons, markdown preview, terminal palette), and stronger text, borders and filled buttons in Breeze and dark
- Softer hairlines between rows and sections via a dedicated divider colour, and a single line under the tab bar
- Top-right notices stack instead of overlapping; "Overwrite" is shown as a destructive action; the host-key and conflict prompts focus the safe option by default
- All dialogs expose `role="dialog"` and accessible names, and `prefers-reduced-motion` is respected (spinners keep turning)

### Fixed
- Escape closed both a dialog and the one underneath it (tunnels, install key, PIN prompts, ...); it now goes to the topmost dialog only, including while a save is in progress
- Several dialogs could not be closed with Escape (new folder, diff, K8s login/debug, sync bootstrap, dotfile pools, master password, SFTP password prompt)
- Undefined colour tokens that rendered nothing (hover borders, some backgrounds) and a focus ring that overlapped field labels
- Markdown preview headings were white on white in the light theme
- Optional sshs3-site deploy in `deploy.sh` now stops on the first failing step instead of reporting success

## [0.96.18] - 2026-10-03

### Added
- add Git & GitHub integration hub and SFTP file manager Git support

### Changed
- update landing and privacy-safe markdown editor screenshots
- clean up internal persona tags from user guide headings
- integrate privacy-safe screenshots, performance metrics, and senior UX guide
- expand user guides with complete field reference, limitations and UI screenshots
- add modular user guides, sync script, CI workflow and PR checklist

## [Unreleased]

### Added
- **Git & GitHub / GitLab integration hub (`Settings → Git & GitHub`).**
  - **Developer SSH Keys:** Centralized discovery of public keys across `~/.ssh`, active SSH agents, and unlocked smartcard/FIDO2 hardware caches. Includes one-click copy to clipboard and one-click direct browser registration on GitHub (`/settings/ssh/new`) and GitLab (`/-/user_settings/ssh_keys`).
  - **Cryptographic SSH Git commit signing (`~/.gitconfig`):** Inspect active signing format and key, toggle `commit.gpgsign`, configure signing key with one-click "Git Sign" / "Sign Active", automatically update `~/.ssh/allowed_signers` for local signature verification, and enter custom signing keys.
  - **SFTP & File Manager Git integration:** Automatic Git repository detection in dual-pane file manager panes (local and remote SFTP hosts). Shows branch badge, uncommitted/untracked status, ahead/behind commit indicators (`↑`/`↓`), Git Pull, and "Open in GitHub/GitLab". Includes dedicated toggle switch under *Settings → Git & GitHub* to turn off Git polling and hide Git controls if preferred.
  - **Git Clone:** Clone Git repositories into the active pane folder or selected subfolder with branch selection and shallow clone depth options.
  - **Remote key lookup (`username.keys`):** Inspect and copy public SSH keys from GitHub, GitLab, or self-hosted GitLab accounts.
  - **Dotfiles Git import:** Clone and import dotfiles directly from Git repositories into dotfile pools.
  - **Key Installation with Developer Keys:** Pick public keys directly from local files, active SSH agents, or smartcards when installing keys on remote hosts via SSHProfileForm / InstallKeyModal.

### Security
- **Git clone over SFTP:** the target directory is now shell-quoted in the remote command (previously a directory name such as `x$(cmd)` could execute commands on the server). Control characters in paths are rejected.
- **Git status in untrusted local folders:** git is run with `core.fsmonitor=false`, hooks disabled and no optional locks, so a malicious `.git/config` can no longer run code when browsing into a folder. `.git` files are only followed into `worktrees`/`modules`.
- **Git clone hardening:** URLs and folder names starting with `-` are rejected, `--` separates arguments, `depth` must be an integer, and transports are restricted to https/http/ssh/git. The same protections apply to dotfile Git import and `git pull`.

## [0.96.17] - 2026-10-03

### Added
- **Windows portable data isolation.** Portable Windows builds now detect `PORTABLE_EXECUTABLE_DIR` (or a local `data/` directory) and store user profiles and settings in `<exe-dir>/data` rather than `%APPDATA%\sshs3`, preventing profile collisions with installed copies on the same machine and making USB usage truly portable.
- **Windows Portable ZIP format.** Added `sshs3-<version>.zip` as a pre-extracted Windows target for instant startup without temporary extraction overhead.
- **Single-instance window focusing.** Launching a second instance of sshs3 now brings the existing window to the front and focuses it instead of failing silently or causing profile lock conflicts.

### Changed
- **Windows portable artifact naming.** Portable Windows executables are now explicitly named `sshs3-<version>-portable.exe` on GitHub Releases.

## [0.96.16] - 2026-10-03

### Fixed
- **Last terminal row clipped.** Padding sat on the xterm container, so FitAddon sized the terminal ~16 px too tall and cut off the bottom row (worst on Windows). Padding now lives on a wrapper element, in both the terminal and the Kubernetes log view.
- **Performance bar on Windows.** The non-interactive `ssh` fallback is now limited to login methods that need no per-login prompt, so sampling never triggers a password, PIN or passphrase prompt.

## [0.96.15] - 2026-10-03

### Fixed
- **Performance bar on Windows.** Remote SSH sessions showed "Not connected" because Windows OpenSSH has no ControlMaster socket to reuse. On Windows each sample now uses a short-lived, non-interactive `ssh` connection (key/agent auth; password-only profiles are not supported) and polls at most every 10 s. Latency is measured as TCP connect time to sshd (hidden behind a proxy or ProxyJump). Linux and macOS are unchanged.

## [0.96.14] - 2026-10-03

### Added
- **Performance bar** above SSH, local-shell and Kubernetes terminals. Off by default; enable it under *Settings → Performance*. While it is off nothing is polled.
  - SSH sessions are sampled over the already open ControlMaster connection (no extra login or PIN prompt) with one fixed, read-only `/proc` script: CPU, RAM, load, swap, disk, network, disk I/O, iowait/steal, processes, per-core CPU, cache, all filesystems, uptime and latency. Linux hosts only.
  - Local shells show your own machine (full set on Linux; CPU, RAM, uptime and disk elsewhere).
  - Kubernetes pods use `metrics.k8s.io` (like `kubectl top pod`): CPU/memory against request and limit, restarts, Ready, age and node.
  - Three layouts (text, bars, sparklines), selectable metrics and update interval. Hover for a tooltip with every value; click for up to 15 minutes of history with donuts, bars and stat tiles.

### Fixed
- Prevent double-paste and scroll-to-top when clicking an inactive pane.

## [0.96.13] - 2026-10-03

### Added
- **Update notifications.** The app checks GitHub Releases 30 seconds after start and every 6 hours and shows a banner when a new version exists. Nothing is downloaded or installed until you click *Download* and then *Restart and install*, and the restart goes through the normal quit confirmation (active transfers, confirm before quit). Works for the AppImage and the DEB/RPM packages (DEB/RPM ask for administrator rights). *Settings → App Behavior* has the on/off switch, the current version and a *Check now* button.
- **Air-gap switch.** `SSHS3_DISABLE_UPDATES=1` turns the feature off completely: no network requests, and the setting is locked.

### Changed
- Updates are off on Windows until the installer is code-signed; download new versions from the releases page.

## [0.96.12] - 2026-10-02

### Fixed
- FIDO2 key-file profiles use only their own key
- route remote profile sync through the unlocked smartcard agent
- clear detect-secrets findings, raise src/main/ssh coverage, pin runners to ubuntu-24.04

## [0.96.11] - 2026-10-02

### Added
- **Install public key (ssh-copy-id).** New key icon on every SSH profile row, and an **Access** section in the profile form that works on a profile you have not saved yet. Pick one or more keys (key files, keys already loaded in your ssh-agent, smartcard/FIDO2 keys, or paste one) and they are added to `~/.ssh/authorized_keys` on the host in a single connection, so you enter one password/PIN/touch. Idempotent (reports "installed" / "already present" per key), goes through the profile's jump host/proxy, and verifies key login afterwards when the private key file is unprotected. **Copy command** gives a short, readable script to paste on hosts the app cannot reach, and updates as you change the selection.
- **Access check in the profile form.** A timeline shows where the chain breaks: reach host → host key → login methods → key installed → login works. The first three come from one silent probe that needs no PIN or touch and shows which methods the server allows. It replaces the old Test Connection button, which only validated settings for smartcard/FIDO2. Saving a new key-based profile that was never verified asks first (never blocks).
- **Smart login for the install.** The app never logs in with the key it is installing: installing only a profile's own key uses the password (or a smartcard still configured in the profile, tried first, e.g. after switching PIV to FIDO2) and skips needless PIN prompts. "Log in with" lets you force Password, the profile's key, the smartcard or already-unlocked ssh-agent keys, and the automatic order is shown.
- **New Profile** shortcut on the welcome screen.

### Changed
- **p11-kit is now the default PKCS#11 library** for new smartcard profiles (else the first module found), and the example path is no longer a Net iD library. Install key and Test connection stay disabled until the profile has the library (or key file) it needs.
- Keys already unlocked in the app (global PIN cache) or an open session are read without a PIN or touch.

## [0.96.10] - 2026-10-02

### Added
- **Recursive file-name search in the file manager.** The Ctrl+F filter has a new "Recursive" checkbox that searches names in the current folder and all subfolders (works for SFTP, local, S3 and K8s). Hits show their relative path and open/copy/transfer like normal entries. Capped at 1000 hits / 3000 folders; symlinked folders are never followed, and hidden folders are skipped unless "show hidden files" is on. Rename is disabled while recursive hits are shown, and the filter survives a refresh (it only resets when you change folder).
- **Delete button for saved SSH tunnels** in the global SSH Tunnels menu (asks for confirmation, stops a running tunnel first).
- **Wildcards `*` and `?` in the file filter**, both normal and recursive (e.g. `*.log`, `app-?.txt`). Without wildcards it stays a substring match.

### Fixed
- Proxy passwords are stripped from SSH and S3 profiles in JSON export.
- SFTP stream hardening: guard against overlapping reads, unhandled rejection after protocol init, stderr drain and child cleanup in `createExecStream`, and a 16 MB packet-length limit.
- Memory leak in `TransferQueue` job contexts, async k8s cleanup in `IpcBridge.dispose`, and transfer-progress refresh debounced by 300 ms.
- Security CI: detect-secrets baseline refreshed, and `npm audit` now runs through `scripts/npm-audit-gate.mjs` with a reviewed allowlist for node-forge GHSA-86w9-cpqp-85rv (only reachable via `win-ca`, signature verification unused, no patched release).

### Changed
- bump vitest 5.0.1 → 5.0.2, vite 8.3.0 → 8.3.1 and the aws-sdk group (5 packages).

## [0.96.9] - 2026-10-01

### Fixed
- stop electron-builder publishing from the build job, skip POSIX-only tests on Windows

### Changed
- bump lucide-react from 1.47.0 to 1.48.0 (#29)
- bump jsdom from 30.1.0 to 30.1.1 (#27)

## [0.96.8] - 2026-10-01

### Changed
- **SFTP now runs over the system OpenSSH client (`ssh -s sftp`)** instead of the `ssh2` / `ssh2-sftp-client` JavaScript libraries, with a built-in SFTP v3 protocol engine. The file manager now honours `~/.ssh/config`, ProxyJump (`-J`), FIDO2 security keys and PKCS#11 smartcards exactly like the terminal. `ssh2` and `ssh2-sftp-client` are removed.
- **FIDO2 profiles can use the SFTP file manager** (the buttons are no longer disabled). PIN prompts use the app's PIN dialog and the touch banner is shown. Resident keys remain Linux-only; on Windows use a key file.
- **Host keys for SFTP** are verified by OpenSSH against `~/.ssh/known_hosts`; unknown keys open the trust dialog (rejected if it can't be shown), changed keys are refused.
- Remote tail and search previews run through OpenSSH (`exec`) instead of the old SSH channel.

### Fixed
- Password profiles no longer hang in the terminal/SFTP when the default ssh-agent holds a touch/PIN-protected key (pubkey auth is disabled for password profiles).
- Restored terminal tabs reuse the profile's saved password/passphrase instead of prompting again.
- The SFTP multiplexing socket now lives in a private (0700) temp directory with an unguessable name.

## [0.96.7] - 2026-10-01

### Added
- **Post-transfer integrity & checksum verification (P1 #15)**: automatic SHA-256 / MD5 digest verification on completed file transfers with auto-removal of corrupted destinations and a configurable settings toggle.
- **Headless CI smoke test**: automated Playwright/CDP smoke test in CI verifying rapid app launch, DOM mounting, and UI rendering under 1 second.
- **Directory transfer worker pool**: concurrent worker pool for recursive directory transfers with aggregate real-time progress reporting.
- **Automatic retry on transient transfer failures**: resilient retry logic for socket drops (`ECONNRESET`, `ETIMEDOUT`, `Connection lost`).
- **Security hardening & fuses**: enabled Electron fuses at build time, pinned proxy CLI execution through the signed main executable, and added comprehensive security tests with strict coverage floors.

### Changed
- **Startup time & bundle optimization**: externalized `@kubernetes/client-node` from main process bundle, cutting 4.6 MB and speeding up build time by 88%; non-blocking background initialization of login shell env, trust store, and orphan cleanup.
- **Terminal performance & memory bounds**: added configurable terminal scrollback buffer limit (default 5000 lines) and debounced resize synchronization to prevent IPC message flooding.
- **SFTP stream buffer sizing**: increased read and write stream buffer chunk sizes to 128 KB for 4x fewer roundtrips.

### Fixed
- **Host key verification & argument escaping**: hardened remote file names and argument inputs.
- **AES-GCM crypto**: pinned AES-GCM auth tag length strictly to 16 bytes on decryption.

## [0.96.6] - 2026-09-30

### Added
- **Directory-sync profiles in Remote Profile Sync**: saved directory-sync pairs are now backed up and synced to your S3/SFTP target (new `dirsync-profiles.enc`, per-record merge with tombstones). Deleting a profile is now a soft delete so the deletion propagates; remotes pushed by older versions still pull fine.
- **Home button**: clicking the sshS3 logo in the header shows the landing page again; open tabs stay mounted.

### Fixed
- **Edited S3/SFTP profiles were ignored** until restart: the file manager's cached connection is now dropped when a profile is saved or deleted.
- **"Import Hosts from ~/.ssh/config" dialog** was clipped inside a short Connection Manager.
- **Clean start showed old tabs/profiles**: removed the legacy `multissh` config migration.

### Changed
- README: new screenshot set and a corrected note that FIDO2 profiles have no SFTP on any platform.

## [0.96.5] - 2026-09-30

### Added
- **Windows support fixes**: installer sets the OpenSSH Authentication Agent service to Automatic; Settings gets a "Fix Windows ssh-agent" button (adds a PKCS#11 driver's folder to PATH); global default PKCS#11 driver setting; friendlier driver/certificate names; OpenSC preferred over libykcs11 in detection; new "Windows vs. Linux" README section.

### Fixed
- **FIDO2 on Windows**: resident credentials are disabled in the UI (unavailable there), `ssh-add -K` uses `SSH_SK_PROVIDER=internal`, and a non-empty shared agent no longer hides a failed load.
- **`~/.ssh/config`**: paths containing spaces are quoted in the managed block.
- **SFTP for FIDO2 profiles**: the SFTP button is greyed out with an explanation on all platforms — the file manager's `ssh2` library cannot use security-key (`-sk`) keys, so it could never authenticate.

## [0.96.3] - 2026-09-30

### Added
- **Automated Deploy Script**: added `scripts/deploy.sh` and `npm run deploy` to automatically run pre-flight checks, bump patch versions, stage all changes, commit, create annotated tags, and push to GitHub to trigger GitHub Actions release builds.

### Fixed
- **Smartcard PIN Error Surfacing & Retry**:
  - Added a retry loop (up to 3 attempts) in the smartcard PIN modal with the actual error reason shown inline instead of failing silently after one attempt.
  - Added a non-intrusive status notification banner for background startup-unlock failures.
  - Prevented empty PIN submissions directly in the modal to avoid burning retry attempts.
  - Reclassified smartcard error strings to distinguish between retryable wrong PIN attempts and permanent CTAP2/PIV lockouts.
- **Dependency Security Updates**: resolved all GitHub Dependabot security alerts by updating `brace-expansion` (1.1.21, 2.1.7, 5.0.12) and `fast-uri` (3.1.8).
- **FIDO2 User Presence & PIN Prompts**:
  - Prevented false-positive touch prompt notices during startup PIN entry (`ssh-add -K`).
  - Fixed touch presence banner not displaying when connecting to FIDO2 hosts that require user presence verification while reusing cached PIN.
  - Forwarded askpass presence events through SSHPtyManager and IPC to display the user touch prompt.

## [0.96.2] - 2026-09-29

### Changed
- **New App Branding & Icon**:
  - Replaced application icons across all desktop formats (`.svg`, `.ico`, and `.png` in 16x16 through 512x512) with modern dark squircle and yellow cloud terminal mark (`> _`).
  - Added solid color cloud terminal icon assets (`cloud_icon_yellow`, `cloud_icon_red`, `cloud_icon_blue`, `cloud_icon_orange`).
  - Integrated `BrandLogo` component in header and hero empty state with `sshS3` color-matched styling.
  - Configured Linux desktop file binding (`setDesktopName`) and native image window icon in Electron main process for desktop environments.

## [0.96.1] - 2026-09-28

### Added
- **Named tunnels, managed only from the Tunnels panel**: tunnels now have their own display name, independent of the underlying SSH profile's name; tunnel definitions are created/edited exclusively in the Tunnels panel (removed from the profile editor), and terminal sessions no longer auto-start a profile's saved tunnels — only the Tunnels panel starts them.
- **ProxyJump can reference a saved profile**: the Jump Host / ProxyJump setting can point at another saved SSH profile instead of only free text, resolved to that profile's host/user/port at connect time (falls back to manual text for external bastions). Applies to terminal sessions, SFTP connections (file manager, directory sync, pane auto-reconnect), and the exported `~/.ssh/config` (writes a real `ProxyJump <alias>` instead of a frozen string).
- New README section, "Jump hosts & tunnels explained", documenting ProxyJump and the Tunnels panel end to end.

### Fixed
- **SSH tunnel/terminal port conflicts**, root cause: terminal sessions previously re-started a profile's saved tunnels on every connect, which could collide with the same tunnel already running from the Tunnels panel ("Address already in use"). Terminals no longer auto-start tunnels at all.

## [0.96] - 2026-09-28

### Added
- **SSH Tunnels management UI**:
  - New global "SSH Tunnels" toolbar button (icon colored gray/green/red for none/active/error) opening a cross-connection tunnel dashboard, plus a per-connection tunnels modal reachable from the Connection Manager.
  - Added a guided 3-step wizard (Type → Details → Done) for creating local/remote/dynamic (SOCKS) port-forward tunnels, with plain-language explanations, a live summary sentence, and an in-wizard local-port-in-use check.
  - Standalone tunnels now run as independent `ssh -N` processes with live status (active/error), start/stop, and in-place editing, decoupled from any open terminal session.

### Fixed
- **SSH tunnel & terminal port conflicts**: opening a terminal or another tunnel that would collide with an already-bound local port (from a running standalone tunnel or another open terminal session) now silently skips that forward instead of surfacing a raw "Address already in use" error from OpenSSH.
- **Orphaned processes on shutdown**: standalone tunnel processes and terminal ControlMaster ("mux") connections are now reliably terminated on app quit, including when the process receives an external SIGINT/SIGTERM (e.g. `kill`/`pkill`, a session/system shutdown) — previously this bypassed Electron's quit lifecycle entirely and left `ssh` processes running.
- Fixed a race where saving an edit to a running tunnel could briefly fail with "Address already in use" before the old process had fully released its port.
- Fixed a stale "phantom" tunnel entry lingering in the UI after a tunnel failed to start.

## [0.94] - 2026-09-26

### Added
- **FIDO2 & Hardware Security Keys (YubiKey)**:
  - Added native FIDO2 resident credential discovery and key generation (`ed25519-sk`, `ecdsa-sk`) via `ykman` and `ssh-keygen -K`.
  - Added in-app touch presence notification banner ("Touch your security key to authenticate") when security keys require physical verification.
  - Added support for both resident credentials and file-based security keys (`id_ed25519_sk`, `id_ecdsa_sk`) in SSH connection profiles.
  - Added global agent pre-loading for FIDO2 credentials at application startup with a single PIN verification.
  - Added OpenSSH connection multiplexing (`ControlMaster`/`ControlPath`) for background dotfiles sync, allowing synchronization over existing FIDO2 sessions without requiring multiple physical touches.
  - Added automated private `ssh-agent` cleanup on process exit to avoid orphaned agent processes.
- **In-App File Editor with Live Markdown Preview**:
  - Added Edit/Preview mode toggle for `.md`, `.markdown`, and `.mdx` files in the dual-pane file manager editor.
  - Integrated GitHub Flavored Markdown (GFM) renderer using `react-markdown` and `remark-gfm` with support for tables, task lists, code formatting, and theme styling.
  - Lazy-loaded markdown preview bundle to maintain instant app startup.

### Fixed
- **Smartcard & PKCS#11 Startup Preload & Detection**:
  - Enhanced PKCS#11 library detection with SONAME matching (`.so.2`, `.so.1`) and realpath deduplication, resolving detection of `libykcs11` (YubiKey PIV).
  - Preloaded all detected/configured profile PKCS#11 libraries at startup using a transient PIN verification without storing or caching the PIN in application memory.

---

## [0.93] - 2026-09-25

### Added
- **Quick Start workspace dashboard**:
  - Replaced empty tab state with a welcoming 4-card dashboard (New Terminal, New File Manager, Saved Connections, Cloud Sync & Backup) with keyboard shortcuts and descriptions.
  - Added shortcut badges (`Ctrl+Shift+T`, `Ctrl+Shift+F`) to TabBar New Tab dropdown menu.
  - Added quick split horizontally and vertically buttons to split view top bar.
- **Split pane active indicator & click-to-focus**:
  - Added active focus glow ring, accented header, and live pulsing status dot to the active terminal split pane.
  - Added capture-phase event listeners to activate split panes immediately upon clicking anywhere inside the terminal area or focusing xterm.
- **Dual-pane File Manager enhancements**:
  - Added active pane state tracking (`activeSide`) with distinct focus ring and "Active" badge.
  - Reorganized toolbar buttons into 5 logical separator-delimited groups (Navigation, Breadcrumbs, File Operations, Management, Search & Tools).
  - Added manual edit button and full-path text selection in Breadcrumbs.
  - Added failed transfers count badge in Transfer Queue drawer header.
- **Modal sizing & window consistency**:
  - Expanded `FileEditorModal` and `DirectorySyncModal` default sizes to `94vw` / `88vh`.
  - Added Maximize/Restore toggle buttons and titlebar double-click to toggle fullscreen across all modals.
  - Added global `Esc` key handling to close modals safely.

---

## [0.92] - 2026-09-25

### Added
- **Search in Files UI overhaul**:
  - Significantly expanded default window size (`95vw` / `90vh`, up to 1600px width).
  - Added Maximize/Restore button and titlebar double-click to toggle fullscreen.
  - Added draggable splitter divider to adjust results list and preview pane widths, with double-click to reset.
  - Added full path copy and "Reveal in Explorer" buttons to the preview pane.
  - Added clear button (`✕`) in the search input query box and `Esc` shortcut to close modal.

### Fixed
- **Search in Files warning visibility**:
  - Removed line truncation on search warnings so long paths and permission-denied messages (e.g., `/tmp/systemd-private-*`) are fully readable without being cut off.
  - Added native tooltips for paths and snippets in both results and warning lists.
  - Added one-click "Copy all warnings" and dismiss action to collapse or hide skipped object notices.
- **Terminal session preservation on pane split & unsplit**:
  - Preserved active terminal sessions across pane split and unsplit actions by keying portals and connection identity.
  - Prevented unnecessary session teardowns and restarts when splitting views.
  - Fixed Linux GPU crash fallback handling during pane layout transitions.

---

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
