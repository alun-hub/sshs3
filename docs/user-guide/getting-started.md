## Overview & Distribution Models

**sshs3** is packaged as a standalone desktop application for modern Linux distributions and Microsoft Windows. The application requires zero external runtime dependencies (Node.js 22 runtime is embedded directly within the application binary) and operates inside a strictly sandboxed Electron runtime with `nodeIntegration: false`.

![Landing Screen](/img/landing-screen.png)

---

## 1. Package Installation & Platform Matrix

<!-- tabs:start -->
<!-- tab:RHEL, Rocky & Fedora (.rpm) -->
```bash
sudo dnf install -y https://github.com/alun-hub/sshs3/releases/download/v0.96.22/sshs3-0.96.22.x86_64.rpm
sshs3
```
<!-- tab:Debian & Ubuntu (.deb) -->
```bash
curl -LO https://github.com/alun-hub/sshs3/releases/download/v0.96.22/sshs3_0.96.22_amd64.deb && sudo apt install -y ./sshs3_0.96.22_amd64.deb
sshs3
```
<!-- tab:Portable Linux (AppImage) -->
```bash
curl -LO https://github.com/alun-hub/sshs3/releases/download/v0.96.22/sshs3-0.96.22.AppImage && chmod +x sshs3-0.96.22.AppImage && ./sshs3-0.96.22.AppImage
```
<!-- tab:Microsoft Windows (.exe) -->
```powershell
Invoke-WebRequest -Uri "https://github.com/alun-hub/sshs3/releases/download/v0.96.22/sshs3-Setup-0.96.22.exe" -OutFile "sshs3-Setup-0.96.22.exe"; Start-Process ".\sshs3-Setup-0.96.22.exe"
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
curl -LO https://github.com/alun-hub/sshs3/releases/download/v0.96.22/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

### Feature: Provenance Verification via Sigstore

#### 🎯 Purpose
Verify that installed binaries were deterministically generated in an isolated GitHub Actions CI runner without tampering.

#### 🛠️ How to Use
Verify the cryptographic build provenance attestation using the GitHub CLI (`gh`):
```bash
gh attestation verify sshs3_0.96.22_amd64.deb --repo alun-hub/sshs3
```
For RPM packages:
```bash
gh attestation verify sshs3-0.96.22.x86_64.rpm --repo alun-hub/sshs3
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

## 4. Troubleshooting & Diagnostics Runbook

| Symptom / Error Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| `dlopen(): error loading libfuse.so.2` | Missing FUSE compatibility library on modern Linux | Run `sudo apt install libfuse2t64` (Ubuntu/Debian) and launch the AppImage again. |
| SmartScreen "Unknown Publisher" | Binary lacks commercial EV code-signing | Click "More info" → "Run anyway". Verify the SHA256 checksum against `SHA256SUMS`. |
| `Cannot connect to X server` (Linux) | Missing `$DISPLAY` variable or broken socket | Verify `$DISPLAY` is set. In Wayland-only sessions, pass `--ozone-platform-hint=auto`. |
| Update toggle locked in Settings | `SSHS3_DISABLE_UPDATES=1` environment variable active | Expected behavior in hardened setups. Remove the variable if network access should be allowed. |
