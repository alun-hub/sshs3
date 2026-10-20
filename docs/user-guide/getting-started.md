## Overview & Distribution Models

**sshs3** is packaged as a standalone desktop application for modern Linux distributions and Microsoft Windows. The application requires zero external runtime dependencies (Node.js 22 runtime is embedded directly within the application binary) and operates inside a strictly sandboxed Electron runtime with `nodeIntegration: false`.

![Landing Screen](/img/landing-screen.png)

### Quick Connect
When launching sshs3 without an open session, the start screen provides a **Quick Connect** bar. Type `user@host` (or `user@host:port`, e.g. `root@192.168.1.50:2222`) and press <kbd>Enter</kbd> to immediately launch an interactive SSH terminal without creating a saved profile first. It inherits your local SSH configuration, default keys, and active SSH agent. The same box also searches **all saved SSH profiles** (by name, host, user or group): other text lists the matches under *Matching Profiles*, and <kbd>Enter</kbd> connects to the first one.

---

## 1. Package Installation & Platform Matrix

<!-- tabs:start -->
<!-- tab:RHEL, Rocky & Fedora (.rpm) -->
```bash
sudo dnf install -y https://github.com/alun-hub/sshs3/releases/download/v{{APP_VERSION}}/sshs3-{{APP_VERSION}}.x86_64.rpm
sshs3
```
<!-- tab:Debian & Ubuntu (.deb) -->
```bash
curl -LO https://github.com/alun-hub/sshs3/releases/download/v{{APP_VERSION}}/sshs3_{{APP_VERSION}}_amd64.deb && sudo apt install -y ./sshs3_{{APP_VERSION}}_amd64.deb
sshs3
```
<!-- tab:Portable Linux (AppImage) -->
```bash
curl -LO https://github.com/alun-hub/sshs3/releases/download/v{{APP_VERSION}}/sshs3-{{APP_VERSION}}.AppImage && chmod +x sshs3-{{APP_VERSION}}.AppImage && ./sshs3-{{APP_VERSION}}.AppImage
```
<!-- tab:Microsoft Windows (.exe) -->
```powershell
Invoke-WebRequest -Uri "https://github.com/alun-hub/sshs3/releases/download/v{{APP_VERSION}}/sshs3-Setup-{{APP_VERSION}}.exe" -OutFile "sshs3-Setup-{{APP_VERSION}}.exe"; Start-Process ".\sshs3-Setup-{{APP_VERSION}}.exe"
```
<!-- tabs:end -->

---

### Feature: Native Enterprise Packaging

#### 🎯 Purpose
Provide hassle-free deployment across standard enterprise server fleets and engineer workstations (RHEL, Ubuntu, Windows) without requiring runtime dependencies, external X-servers, or package rebuilds.

#### 🛠️ How to Use
1. Download and install using your system's package manager.
2. On Linux, a desktop shortcut (`/usr/share/applications/sshs3.desktop`), app icons, and a CLI symlink (`/usr/bin/sshs3`) are provisioned automatically.
3. On Windows, the installer bundles a self-contained, portable build of VcXsrv, allowing immediate execution of remote Linux GUI applications over SSH (`ssh -Y`) without separate setup.
4. **Portable Windows builds** (the portable `.exe` and the ZIP) keep all profiles and settings next to the executable instead of in `%APPDATA%\sshs3`: the portable `.exe` uses `<exe-dir>\data`, and the ZIP does too as soon as a `data` folder exists beside `sshs3.exe`. This keeps the data with the program (for example on a USB drive) and separate from any installed copy.
5. sshs3 allows a single running instance: starting it again (installed or portable) brings the existing window to the front instead of opening a second one.

#### ⚠️ Limitations & Caveats
- **Ubuntu 24.04+ AppImage**: Ubuntu 24.04 and newer omit `libfuse2` by default. If running the AppImage fails, install the compatibility library: `sudo apt install libfuse2t64`.
- **Windows SmartScreen**: Because Windows builds are currently unsigned with an EV certificate, Microsoft Defender SmartScreen may display an unknown publisher prompt. Click "More info" and "Run anyway".
- **Wayland vs. X11**: On Linux, Electron defaults to XWayland compatibility. For native Wayland rendering, append `--ozone-platform-hint=auto` when launching.

#### ⚙️ Technical Internals & Architecture
Packaged via `electron-builder` using configurations in `electron-builder.json`. The application locks down security using hardware Electron Fuses:
- `runAsNode`: Enabled only for internal auxiliary processes (`askpass`, `certWorker.cjs`, proxy CLI) via `ELECTRON_RUN_AS_NODE=1`.
- `onlyLoadAppFromAsar`: Enforced to guarantee code execution only from inside the read-only ASAR archive.
- `enableNodeCliInspectArguments`: Disabled in production builds to prevent memory dumping via debuggers.

---

## 2. Cryptographic Integrity & Supply Chain Attestation

Every release asset is accompanied by SHA-256 checksums and GitHub Actions build provenance attestations.

```bash
curl -LO https://github.com/alun-hub/sshs3/releases/download/v{{APP_VERSION}}/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

### Feature: Provenance Verification via Sigstore

#### 🎯 Purpose
Verify that installed binaries were deterministically generated in an isolated GitHub Actions CI runner without tampering.

#### 🛠️ How to Use
Verify the cryptographic build provenance attestation using the GitHub CLI (`gh`):
```bash
gh attestation verify sshs3_{{APP_VERSION}}_amd64.deb --repo alun-hub/sshs3
```
For RPM packages:
```bash
gh attestation verify sshs3-{{APP_VERSION}}.x86_64.rpm --repo alun-hub/sshs3
```

#### ⚠️ Limitations & Caveats
Requires network connectivity to the GitHub Attestations API / Sigstore public transparency log.

#### ⚙️ Technical Internals & Architecture
Integrates `actions/attest-build-provenance` to generate cryptographic assertions signed by GitHub's OIDC certificate authority, anchoring the binary hash to the exact commit SHA in git.

---

## 3. Automatic Updates & Air-Gap Lockdown

By default, sshs3 checks GitHub Releases every 6 hours for new updates. Nothing is downloaded or installed without user confirmation.

> [!IMPORTANT]
> **Total Network Silence for Air-Gapped Environments**: For military, industrial control, or air-gapped critical infrastructure, all outbound update network traffic and telemetry can be permanently locked down using an OS environment variable.

```bash
export SSHS3_DISABLE_UPDATES=1
sshs3
```

### Feature: Air-Gap Lockdown Switch (`SSHS3_DISABLE_UPDATES=1`)

#### 🎯 Purpose
Guarantee absolute network silence in sensitive environments where outbound Internet access is forbidden.

#### 🛠️ How to Use
1. Export `SSHS3_DISABLE_UPDATES=1` in `/etc/environment` or your user profile (`~/.bashrc`).
2. Open *Settings → General & Appearance*.
3. The "Automatic Updates" setting will display as locked with a padlock indicator and cannot be enabled from the UI.

#### ⚠️ Limitations & Caveats
- On Windows, configure this variable under System Properties (`sysdm.cpl` → Advanced → Environment Variables).
- Updates in air-gapped environments must be distributed manually by administrators via internal package repositories.

#### ⚙️ Technical Internals & Architecture
During startup, `UpdateService` (`src/main/update/UpdateService.ts`) inspects `process.env.SSHS3_DISABLE_UPDATES === '1'`. If set, polling timers are aborted, `electron-updater` is never loaded, and `IPC_CHANNELS.UPDATE_CHECK` returns `{ locked: true, enabled: false }`.

---

## 4. System Requirements

sshs3 bundles its runtime (Chromium, Node.js, the AWS SDK and a built-in SFTP v3 engine), but a few features use tools of your operating system.

### Required
- **OpenSSH client (`ssh`, `ssh-agent`, `ssh-add`)**: the terminal runs your system's `ssh`, and SFTP is carried over `ssh -s sftp`, so OpenSSH must be installed.
  - Fedora / RHEL / Rocky: `sudo dnf install openssh-clients`
  - Debian / Ubuntu / Mint: `sudo apt install openssh-client`
  - Arch: `sudo pacman -S openssh`
  - Windows: the built-in **OpenSSH Client** (*Settings → Apps → Optional features*).
- **OS keyring** for saved passwords, passphrases and sync keys (Electron `safeStorage`): `libsecret` plus a keyring service such as GNOME Keyring or KWallet on Linux; built in on Windows (DPAPI).

### Optional: security keys and smartcards
- **FIDO2 keys (`ed25519-sk` / `ecdsa-sk`)**: OpenSSH 8.2 or newer with FIDO2 support. The `ykman` CLI (`yubikey-manager`) is optional and used to list resident credentials.
- **Smartcards (PIV / CAC / SITHS / Net iD)**: the PC/SC daemon and a CCID reader driver, plus a PKCS#11 module.
  - Fedora / RHEL: `sudo dnf install pcsc-lite pcsc-lite-ccid && sudo systemctl enable --now pcscd`
  - Debian / Ubuntu: `sudo apt install pcscd pcsc-tools libccid && sudo systemctl enable --now pcscd`
  - PKCS#11 modules detected on Linux: `p11-kit` (recommended, it proxies every registered module), Yubico `libykcs11`, Net iD (`libiidp11.so`) and OpenSC.
  - On Windows the Smart Card service is on by default; detected modules are Net iD, OpenSC and `libykcs11`. See [Windows differences](/docs/windows/) for the ssh-agent service that PIN caching needs.

### Nothing extra needed
- **S3 and AWS SSO** run on the bundled AWS SDK; no AWS CLI or Python.
- **TLS / CA certificates**: S3 connections trust your operating system's CA store (the Windows certificate store, or the distribution's CA bundle on Linux), so internally issued certificates work without configuration.

---

## 5. Troubleshooting & Diagnostics Runbook

| Symptom / Error Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| `dlopen(): error loading libfuse.so.2` | Missing FUSE compatibility library on modern Linux | Run `sudo apt install libfuse2t64` (Ubuntu/Debian) and launch the AppImage again. |
| SmartScreen "Unknown Publisher" | Binary lacks commercial EV code-signing | Click "More info" → "Run anyway". Verify the SHA256 checksum against `SHA256SUMS`. |
| `Cannot connect to X server` (Linux) | Missing `$DISPLAY` variable or broken socket | Verify `$DISPLAY` is set. In Wayland-only sessions, pass `--ozone-platform-hint=auto`. |
| Update toggle locked in Settings | `SSHS3_DISABLE_UPDATES=1` environment variable active | Expected behavior in hardened setups. Remove the variable if network access should be allowed. |
