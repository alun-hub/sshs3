# Connection Manager & Profiles

The Connection Manager is the central hub in sshs3 for organising, searching, and managing all your remote and local environments.

---

## Supported Profile Types

sshs3 provides unified profile management across four core target types:

1. **SSH Connection**: Standard OpenSSH sessions to Linux/UNIX/BSD/Windows hosts.
2. **Local Shell**: Terminal running directly on your local workstation ($SHELL on Linux/macOS; CMD, PowerShell, pwsh, or WSL on Windows).
3. **Kubernetes Cluster**: Direct access to Kubernetes / OpenShift contexts, namespaces, pods, and container workloads.
4. **S3 Storage**: Direct file-manager access to Amazon S3, Cloudflare R2, MinIO, Wasabi, Backblaze B2, or custom S3-compatible endpoints.

---

## Configuring an SSH Profile

When adding or editing an SSH profile, the following options are available:

### Basic Settings
- **Display Name**: Friendly label displayed in the profile list and tab header.
- **Group / Folder**: Optional category for grouping profiles in the sidebar tree.
- **Host & Port**: Target hostname or IPv4/IPv6 address, and SSH port (default `22`).
- **Username**: Remote user account.
- **Color Tag**: Visual tag to quickly distinguish production, staging, and development environments.

### Authentication Methods
- **Password**: Authenticate using standard password prompt. Passwords can be stored encrypted in your operating system's native keychain (see [Security & Authentication](./08-security-hardware-keys-and-smartcards.md)).
- **Private Key File**: Path to standard OpenSSH private key (e.g. `~/.ssh/id_ed25519`, `~/.ssh/id_rsa`). Passphrases can be cached ephemerally.
- **System SSH Agent**: Inherits keys currently held in your local running `ssh-agent` or Windows OpenSSH agent service.
- **Hardware Security Key (FIDO2)**: Hardware-backed keys (`sk-ssh-ed25519@openssh.com` or `sk-ecdsa-sha2-nistp256@openssh.com`). Automatically activates the **Touch-Presence Banner**.
- **Smartcard & PKCS#11**: Hardware tokens utilising PIV / PKCS#11 modules (YubiKey PIV, p11-kit, OpenSC, Net iD).

### Advanced SSH Options
- **ProxyJump (Bastion / Jump Host)**: Chain connections through one or more intermediate jump hosts (e.g. `bastion.company.com`).
- **HTTP / SOCKS5 Proxy**: Connect to sshd through an external corporate proxy.
- **X11 Forwarding**: Forward X11 graphical applications from the remote server to your local display.
- **Custom SSH Arguments**: Pass raw `-o Option=Value` parameters directly to the system `ssh` binary.
- **Initial Working Directory**: Automatically `cd` into a specific directory upon login.
- **Dotfiles Sync**: Seamlessly sync selected shell configuration files upon connecting.

---

## Profile Management Operations

### Searching & Filtering
Use the search bar at the top of the Connection Manager (shortcut: <kbd>Ctrl+F</kbd>) to instantly filter profiles by name, hostname, username, or tag.

### Import and Export
- **Exporting Profiles**: Profiles can be exported to JSON for backup or sharing across machines.
- **Automatic Secret Sanitisation**: When exporting to JSON, sshs3 automatically strips sensitive credentials (such as saved proxy passwords and private tokens) to prevent accidental credential leakage.
- **Importing Profiles**: Import profiles from JSON backups or auto-discover hosts defined in `~/.ssh/config`.

### Host Key Verification (Host Key Trust Modal)
When connecting to a host for the first time, or if a host's key changes:
1. sshs3 captures the host's public key fingerprint (SHA256).
2. The modal displays the key type, bit length, and fingerprint.
3. If a host key has changed unexpectedly, a prominent **Security Warning** is triggered, preventing Man-in-the-Middle (MITM) attacks until explicitly confirmed by the user.
