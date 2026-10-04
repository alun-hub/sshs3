# Getting Started with sshs3

**sshs3** is a modern, security-conscious desktop client that unifies terminal sessions, dual-pane file management, S3 object storage, and Kubernetes workload debugging into a single cohesive interface.

Under the hood, sshs3 is built upon proven system building blocks: your system's actual `ssh` binary drives the terminal and SFTP operations (preserving `~/.ssh/config`, host aliases, and SSH agents), while the AWS SDK communicates natively with S3-compatible endpoints, and a built-in Kubernetes client inspects clusters via the standard Kubernetes API.

---

## System Requirements

- **Linux**: Any modern 64-bit Linux distribution (Ubuntu 20.04+, Debian 11+, Fedora 38+, RHEL 9+, Arch Linux). Requires system `ssh` and standard glibc/musl.
- **Windows**: Windows 10 (1809+) or Windows 11 (64-bit). The Windows build bundles VcXsrv for seamless X11 forwarding.
- **macOS**: Supported via local builds.

---

## Installation

### Linux

Download the latest release package for your distribution from the [GitHub Releases](https://github.com/alun-hub/sshs3/releases/latest) page:

#### 1. Standalone AppImage
The AppImage requires no installation or root privileges:
```bash
chmod +x sshs3-*.AppImage
./sshs3-*.AppImage
```

#### 2. Debian & Ubuntu (.deb)
Install via `dpkg` or `apt`:
```bash
sudo dpkg -i sshs3_*_amd64.deb
# If missing dependencies:
sudo apt-get install -f
```

#### 3. Fedora, RHEL & openSUSE (.rpm)
Install via `dnf` or `rpm`:
```bash
sudo dnf install sshs3-*.x86_64.rpm
```

---

### Windows

Download the preferred format from [GitHub Releases](https://github.com/alun-hub/sshs3/releases/latest):

1. **Setup Installer (`sshs3-Setup-*.exe`)**: Standard Windows installer that registers file associations and includes the bundled VcXsrv X11 server.
2. **Portable Executable (`sshs3-*-portable.exe`)**: Single-file executable requiring no installation.
3. **Portable ZIP (`sshs3-*.zip`)**: Pre-extracted standalone target. When placed on a USB drive or run alongside a `data/` folder, all user profiles and settings are stored locally in `<exe-dir>/data` rather than `%APPDATA%\sshs3`, ensuring true data isolation and mobility.

---

## Automatic Updates & Air-Gap Environments

- **Update Mechanism**: sshs3 automatically queries GitHub Releases 30 seconds after launch and subsequently every 6 hours. When a new release is detected, an update banner is displayed.
- **Explicit Consent**: Nothing is downloaded or installed without explicit user confirmation. Clicking **Download** retrieves the asset, and **Restart and install** applies the update after checking for active file transfers.
- **Air-Gap Mode**: For high-security or offline environments without external internet access, you can completely disable all update network traffic by setting the environment variable:
  ```bash
  export SSHS3_DISABLE_UPDATES=1
  ```
  When this flag is active, the update check is locked off and no network requests are made.

---

## Your First Connection

1. Launch sshs3. You will be greeted by the **Welcome Screen**.
2. Click **New Profile**.
3. Fill in your remote host details:
   - **Profile Name**: E.g. `Production Web 01`
   - **Host / IP**: `192.168.1.50` or `web01.internal`
   - **Port**: `22` (default)
   - **User**: `ubuntu` or your username
   - **Authentication**: Choose between **Password**, **Private Key File**, **ssh-agent**, **FIDO2 Security Key**, or **Smartcard (PKCS#11)**.
4. Click **Connect** (or press <kbd>Enter</kbd>).
5. On your first connection to a new server, the **Host Key Trust Modal** will display the remote server's cryptographic fingerprint (SHA256). Verify it and click **Trust & Connect**.
