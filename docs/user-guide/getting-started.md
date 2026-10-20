## Overview & Distribution Models

**sshs3** is packaged as a standalone desktop application for modern Linux distributions and Microsoft Windows. It bundles its own Electron, Chromium and Node.js runtime, so you do not install Node.js; it only relies on your system's OpenSSH client and, for smartcards, the usual PC/SC and PKCS#11 components (see [System Requirements](#4-system-requirements)). The UI runs in a sandboxed renderer with `nodeIntegration: false`.

![Landing Screen](/img/landing-screen.png)

### Quick Connect
When launching sshs3 without an open session, the start screen provides a **Quick Connect** bar. Type `user@host` (or `user@host:port`, e.g. `root@192.168.1.50:2222`) and press <kbd>Enter</kbd> to immediately launch an interactive SSH terminal without creating a saved profile first. The connection uses password authentication: public-key and agent authentication are not offered (`PubkeyAuthentication=no`), so you type the password in the terminal. Options from your `~/.ssh/config` for that host, such as `ProxyJump`, still apply. For key-based logins, create a saved profile. The same box also searches **all saved SSH profiles** (by name, host, user or group): other text lists the matches under *Matching Profiles*, and <kbd>Enter</kbd> connects to the first one.

---

## 1. Package Installation & Platform Matrix

<!-- tabs:start -->
<!-- tab:RHEL, Rocky & Fedora (.rpm) -->
```bash
sudo dnf install -y https://github.com/alun-hub/sshs3/releases/download/v{{APP_VERSION}}/sshs3-{{APP_VERSION}}.x86_64.rpm
/opt/sshs3/sshs3
```
<!-- tab:Debian & Ubuntu (.deb) -->
```bash
curl -LO https://github.com/alun-hub/sshs3/releases/download/v{{APP_VERSION}}/sshs3_{{APP_VERSION}}_amd64.deb && sudo apt install -y ./sshs3_{{APP_VERSION}}_amd64.deb
/opt/sshs3/sshs3
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
2. On Linux, the DEB and RPM packages install the app under `/opt/sshs3` (start it from your application menu, or run `/opt/sshs3/sshs3`; there is no `sshs3` command on your `PATH`) and register a desktop entry and app icons; the AppImage runs in place without installing anything.
3. On Windows, the installer bundles a self-contained, portable build of VcXsrv, allowing immediate execution of remote Linux GUI applications over SSH (`ssh -Y`) without separate setup.
4. **Portable Windows builds** (the portable `.exe` and the ZIP) keep all profiles and settings next to the executable instead of in `%APPDATA%\sshs3`: the portable `.exe` uses `<exe-dir>\data`, and the ZIP does too as soon as a `data` folder exists beside `sshs3.exe`. This keeps the data with the program (for example on a USB drive) and separate from any installed copy.
5. sshs3 allows a single running instance: starting it again (installed or portable) brings the existing window to the front instead of opening a second one.

#### ⚠️ Limitations & Caveats
- **Ubuntu 24.04+ AppImage**: Ubuntu 24.04 and newer omit `libfuse2` by default. If running the AppImage fails, install the compatibility library: `sudo apt install libfuse2t64`.
- **Windows SmartScreen**: Because Windows builds are currently unsigned with an EV certificate, Microsoft Defender SmartScreen may display an unknown publisher prompt. Click "More info" and "Run anyway".
- **Wayland vs. X11**: Electron picks the display backend automatically and runs as a native Wayland app in a Wayland session. To force XWayland, launch with `--ozone-platform=x11` (for example if window positioning or focus misbehaves on Wayland); to force Wayland, use `--ozone-platform=wayland`.

#### ⚙️ Technical Internals & Architecture
Packaged via `electron-builder` using configurations in `electron-builder.json`. The packaged app flips these Electron Fuses (`electronFuses` in `electron-builder.json`):
- `runAsNode`: Enabled only for internal auxiliary processes (`askpass`, `certWorker.cjs`, proxy CLI) via `ELECTRON_RUN_AS_NODE=1`.
- `onlyLoadAppFromAsar`: Enforced to guarantee code execution only from inside the read-only ASAR archive.
- `enableNodeCliInspectArguments` and `enableNodeOptionsEnvironmentVariable`: Disabled, so `--inspect` and `NODE_OPTIONS` cannot be used to attach a debugger or inject code.

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

By default, sshs3 checks GitHub Releases about 30 seconds after start and then every 6 hours. Nothing is downloaded or installed without your confirmation (**Download**, then **Restart and install**). Updates work for the AppImage and the DEB/RPM packages (DEB/RPM installs ask for administrator approval through polkit). Windows builds are not code-signed yet, so on Windows the app does not update itself: **Settings → General** shows an **Open releases** button instead.

> [!IMPORTANT]
> **Total Network Silence for Air-Gapped Environments**: For military, industrial control, or air-gapped critical infrastructure, all outbound update network traffic and telemetry can be permanently locked down using an OS environment variable.

```bash
export SSHS3_DISABLE_UPDATES=1
/opt/sshs3/sshs3        # DEB/RPM install path; use the AppImage path instead for an AppImage
```

### Feature: Air-Gap Lockdown Switch (`SSHS3_DISABLE_UPDATES=1`)

#### 🎯 Purpose
Guarantee absolute network silence in sensitive environments where outbound Internet access is forbidden.

#### 🛠️ How to Use
1. Export `SSHS3_DISABLE_UPDATES=1` in `/etc/environment` or your user profile (`~/.bashrc`).
2. Open *Settings → General*.
3. **Check for updates automatically** is disabled and the status line reads "updates are disabled by the administrator".

#### ⚠️ Limitations & Caveats
- On Windows, configure this variable under System Properties (`sysdm.cpl` → Advanced → Environment Variables).
- Updates in air-gapped environments must be distributed manually by administrators via internal package repositories.

#### ⚙️ Technical Internals & Architecture
During startup, `UpdateService` (`src/main/update/UpdateService.ts`) inspects `process.env.SSHS3_DISABLE_UPDATES === '1'`. If set, no updater is created and no timers run, the update state becomes `unsupported` with the reason `disabled`, and `IPC_CHANNELS.UPDATE_CHECK` just returns that state without any network request.

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
| `Cannot connect to X server` (Linux) | Missing `$DISPLAY` variable or broken socket, or X11 forced with `--ozone-platform=x11` in a session without XWayland | Verify `$DISPLAY` is set, or launch with `--ozone-platform=wayland` in a Wayland session. |
| Update toggle locked in Settings | `SSHS3_DISABLE_UPDATES=1` environment variable active | Expected behavior in hardened setups. Remove the variable if network access should be allowed. |
