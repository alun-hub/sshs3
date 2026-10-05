## Connection Manager Overview

The Connection Manager in **sshs3** (accessible via <kbd>Ctrl+Shift+O</kbd> or the primary sidebar) centralizes configuration, credentials, and topology management for SSH servers, Kubernetes clusters, and S3 object storage in a unified, searchable workspace.

![SSH Profile Form](/img/docs/profile-new-ssh.png)

---

## 1. SSH Profiles, Folders & Tagging

### Feature: Hierarchical Folder Hierarchy & Instant Search

#### 🎯 Purpose
Allow system administrators managing fleets of hundreds or thousands of servers to organize hosts into logical folders (e.g., `Prod/Database/Stockholm`, `Staging/Web`), tag environments, and filter targets instantly in under two seconds.

#### 🛠️ How to Use
1. Click **New Connection** → **SSH**.
2. Specify **Profile Name**, **Host**, and **Port** (default `22`).
3. In the **Folder** field, choose or type a folder hierarchy using forward slashes (e.g., `Clients/EnterpriseA/Prod`).
4. Type in the filter bar at the top of the manager to search immediately across profile names, hostnames, IPs, tags, or usernames.

#### ⚠️ Limitations & Caveats
- Folder names cannot include reserved characters (`<`, `>`, `:`, `"`, `|`, `?`, `*`).
- Empty folders are purged automatically when all member profiles are deleted or moved.

#### ⚙️ Technical Internals & Architecture
Profiles are serialized into `profiles.json` inside the application user data directory (`~/.config/sshs3/`). Updates execute sequentially via `queueMutation` promises to prevent file corruption during concurrent operations. Secret fields (passwords, private key passphrases) are extracted and encrypted via Electron's `safeStorage` API using the native OS keyring (libsecret on Linux, DPAPI on Windows, Keychain on macOS).

### Complete SSH Profile Field Reference

| Field Name | Default | Purpose & Description | Limitations & Constraints |
| :--- | :--- | :--- | :--- |
| **Profile Name** | *Required* | Friendly display label used in tab headers and connection lists. | Cannot be empty. |
| **Group / Folder** | *Empty* | Organizes profiles into tree folders (e.g. `Production/Web`). | Subfolders supported with forward slashes (`/`). |
| **Hostname / IP** | *Required* | Target FQDN (e.g. `server.internal`) or IPv4/IPv6 address. | Must be resolvable via DNS or reachable directly or via ProxyJump. |
| **Port** | `22` | Target SSH daemon listening port. | Integer between 1 and 65535. |
| **Username** | *Required* | Remote user account (e.g. `ubuntu`, `root`, `deploy`). | POSIX username standards. |
| **Initial SFTP Path** | *Empty* | Default folder opened in the file manager upon connecting. | Leave empty to open your home directory. |
| **Jump Host / ProxyJump** | *None* | Reach the server through another saved profile or a manual bastion (`user@bastion:22`). | Jump host must accept credentials without interactive prompts. |
| **Outgoing Proxy** | *Off* | Route connection through an HTTP, SOCKS4, or SOCKS5 proxy. | Proxy password is encrypted securely in the OS keyring. |
| **Dotfiles Pool & Sync** | *Not assigned* | Assign a dotfiles pool to this profile and select sync behavior. | See [Environment & Profile Sync](/docs/sync-environment/). |

---

## 2. Authentication Methods & Hardware Tokens

sshs3 supports five distinct authentication mechanisms:

![Authentication Methods](/img/docs/profile-auth-key.png)

1. **Password**: Traditional password authentication, encrypted at rest via the OS keyring.
2. **Private Key File**: Path to local private key file (`id_ed25519`, `id_rsa`). Supports passphrase.
3. **SSH Agent**: Delegates authentication to the running SSH agent (`$SSH_AUTH_SOCK`).
4. **FIDO2 / Hardware Security Key**: Hardware WebAuthn/FIDO2 credentials via YubiKey (`ed25519-sk`, `ecdsa-sk`).
5. **Smartcard (PKCS#11)**: Smartcards (PIV, CAC, SITHS) via native PKCS#11 libraries (`p11-kit`, `opensc`, `libykcs11`).

![FIDO2 Authentication](/img/docs/profile-auth-fido2.png)
![Smartcard Authentication](/img/docs/profile-auth-smartcard.png)

### Feature: FIDO2 & Smartcard Hardware Authentication

#### 🎯 Purpose
Eliminate password compromises and enforce Zero Trust security using hardware-backed credentials that cannot be extracted from the physical token.

#### 🛠️ How to Use
- **FIDO2 Resident Credentials**: Select FIDO2 and tick **Use a resident (discoverable) credential stored on the device**. No key file is needed: the app loads whatever resident credentials are on the connected security key when you connect. It scans the key automatically; click **Re-scan connected security key** after swapping keys. (Not available on Windows, whose OpenSSH build cannot read resident keys; use a key file there.)
- **Smartcard (PKCS#11)**: Select Smartcard and click **Scan** next to the library field. The app scans the standard library paths and lists the **Detected modules on system** to pick from.

#### ⚠️ Limitations & Caveats
- FIDO2 requires OpenSSH 8.2+ on both client and target server.
- If password authentication is chosen, sshs3 automatically passes `-o PubkeyAuthentication=no` so an inserted touch-protected hardware token cannot interrupt the login with an unexpected touch prompt.

#### ⚙️ Technical Internals & Architecture
Built on **Zero Private Key Extraction**. Key bytes never traverse Node.js or Chromium heaps. At connection time, sshs3 configures OpenSSH CLI arguments:
- FIDO2: `-i ~/.ssh/id_ed25519_sk` or resident credential lookup via `SecurityKeyProvider`.
- Smartcard: `-o PKCS11Provider=<library-path>` coupled with the app's internal `AskpassServer`, delivering user PINs over an isolated Unix domain socket.

---

## 3. Public Key Deployment (`ssh-copy-id` GUI)

![Public Key Deployment Modal](/img/docs/profile-install-key-modal.png)

### Feature: Idempotent Batch Key Installation

#### 🎯 Purpose
Replace error-prone manual `ssh-copy-id` terminal commands with an intuitive graphical multi-key deployer that safely installs public keys without duplicating lines in `~/.ssh/authorized_keys`.

#### 🛠️ How to Use
1. Right-click any SSH profile and select **Install public key** (or click the key icon in the profile editor).
2. Check the public keys you want to authorize (e.g., workstation key, YubiKey public key, and smartcard public certificate).
3. Select an installation strategy:
   - **Direct Deploy**: Authenticates temporarily via password or existing key to append the keys automatically.
   - **Copy command (Bash)**: Generates a safe, idempotent POSIX shell one-liner ready to paste into web consoles or out-of-band management terminals (iLO, iDRAC):

```bash
mkdir -p -m 700 ~/.ssh && echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG...' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

#### ⚠️ Limitations & Caveats
- Direct Deploy requires temporary administrative or password access to the server.
- Fails if the remote file system is mounted read-only or if SELinux context policies reject file writes under `~/.ssh/`.

#### ⚙️ Technical Internals & Architecture
Invoked through `IPC_CHANNELS.SSH_INSTALL_PUBLIC_KEYS`. `KeyInstallService` establishes an SSH connection, inspects `~/.ssh` (`0700`) and `~/.ssh/authorized_keys` (`0600`) permissions, parses existing public keys, and performs an idempotent comparison: keys that already exist are skipped.

### 5-Stage Access Check Timeline

The Access Check timeline automatically diagnoses remote connection health before or during key installation:
1. **Reach Host**: Verifies raw TCP socket connectivity to the target port.
2. **Host Key**: Confirms the server's public key fingerprint matches `~/.ssh/known_hosts`.
3. **Login Methods**: Silently probes the OpenSSH daemon for permitted authentication methods without requiring PIN entry or hardware touch.
4. **Key Installed**: Scans `~/.ssh/authorized_keys` to determine whether selected public keys are already present.
5. **Login Works**: Executes an end-to-end authentication test verifying full session authorization.

---

## 4. Trust On First Use (TOFU) & `known_hosts`

Connecting to a new host displays an interactive fingerprint dialog:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⚠️  The authenticity of host '10.0.4.12 (ED25519)' can't be established.│
│ Fingerprint: SHA256:d8b248a...                                         │
│ Are you sure you want to continue connecting?                          │
│ [ Trust Host ]                                           [ Cancel ]    │
└────────────────────────────────────────────────────────────────────────┘
```

### Feature: Cryptographic Host Verification & MITM Protection

#### 🎯 Purpose
Protect sysadmins and infrastructure against Man-In-The-Middle (MITM) attacks and DNS spoofing by validating the server's public key against `~/.ssh/known_hosts`.

#### 🛠️ How to Use
- Review the SHA256 fingerprint on first connection (the **Unknown Host** dialog) and click **Trust Host**.
- The key is appended to your system's `~/.ssh/known_hosts`.

#### ⚠️ Limitations & Caveats
- If a server is reinstalled and generates a new host key, OpenSSH detects a mismatch and rejects connection (`HOST KEY VERIFICATION FAILED`).
- A changed key shows the red **Host Key Changed!** dialog with a man-in-the-middle warning; only click **Trust Anyway** if you are sure the change is legitimate. In terminal sessions OpenSSH itself refuses the connection until the old entry is removed with `ssh-keygen -R <host>`.

#### ⚙️ Technical Internals & Architecture
Leverages OpenSSH's native verification engine. When OpenSSH prompts *"Are you sure you want to continue connecting?"*, the prompt is captured by `AskpassServer` (`IPC_CHANNELS.HOSTKEY_PROMPT`). If the user does not respond within 60 seconds or closes the window, the request is answered `no` (fail-closed security).

---

## 5. Advanced SSH Protocol Options

![Advanced SSH Options](/img/docs/profile-advanced-options.png)

### Feature: Granular OpenSSH Protocol Controls

#### 🎯 Purpose
Fine-tune low-level OpenSSH protocol flags for complex enterprise environments, bastions, and high-latency connections.

#### 🛠️ How to Use
In any SSH profile, click **Advanced...**:

| Parameter | Flag | Purpose & Description | Caveat / Limitation |
| :--- | :--- | :--- | :--- |
| **Agent Forwarding** | `-A` | Exposes your local SSH agent to the remote server for chaining outbound connections. | Security warning: Only enable on trusted servers. |
| **X11 Forwarding** | `-Y` | Forwards remote graphical Linux GUI applications to your local display. | On Windows, utilizes the bundled VcXsrv X-server. |
| **Compression** | `-C` | Enables Gzip compression of network traffic across the SSH stream. | Recommended on high-latency/slow links; increases CPU overhead. |
| **ServerAliveInterval** | `0` | Sends periodic null keep-alive packets (in seconds) through the tunnel. | Set to `30` or `60` to prevent firewall NAT timeouts on idle sessions. |
| **X11 Display Location** | `127.0.0.1:0.0` | Target X-server socket where forwarded X11 windows are drawn. | Leave default unless running a custom external display server. |
| **Custom Ciphers / KEX / MACs** | *OpenSSH defaults* | Comma-separated algorithm lists passed to OpenSSH (e.g. `chacha20-poly1305@openssh.com,aes128-gcm@openssh.com`). | Remote server must support at least one specified algorithm. |

---

## 6. Import & Export (`~/.ssh/config` & JSON)

### Feature: Seamless Migration & JSON Backup

#### 🎯 Purpose
Eliminate vendor lock-in by importing existing OpenSSH configuration files and exporting your profiles as JSON backups.

#### 🛠️ How to Use
- **Import from OpenSSH**: In the Connection Manager, click **Import Hosts from ~/.ssh/config**. Parses all `Host` stanzas, hostnames, ports, users, `IdentityFile`, and `ProxyJump` directives into organized sshs3 profiles.
- **JSON backup**: **Export JSON Backup** saves your folders and profiles to a JSON file you choose in the save dialog, and **Import JSON Backup** loads one again. The file is **not encrypted** and does **not contain secrets**: saved passwords, key passphrases, proxy passwords and S3 secret keys / session tokens are left out, so they must be entered again after an import. Keep the file safe anyway; it lists your hosts and usernames.

#### ⚠️ Limitations & Caveats
- Executable directives such as `LocalCommand` and `ProxyCommand` with arbitrary shell scripts are flagged with security warnings.

#### ⚙️ Technical Internals & Architecture
The export is plain JSON written to a path chosen through the save dialog (never a path supplied by the renderer). Secret fields are stripped in the main process before writing. Saved credentials at rest in the app itself are protected separately by the OS keyring (see the security chapter).

---

## 7. Troubleshooting & Diagnostics Runbook

| Symptom / Error Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| `Host key verification failed` | Server's host key does not match `~/.ssh/known_hosts` | Check if the remote host was reinstalled. If valid, purge the stale entry using `ssh-keygen -R <hostname>`. |
| `Permission denied (publickey)` | Server rejects the offered key | Verify key assignment. Use **Install public key** to deploy your public key to the server. |
| `Connection timed out` | Firewall blocking port 22 or incorrect IP address | Test connectivity with `ping` or `nc -zv <host> 22`. Verify if a bastion / ProxyJump is required. |
| `FIDO2 device not found` | Token disconnected or OS lacks FIDO2 support | Reconnect the token. Run `ssh-keygen -K` in a terminal to verify that the OS recognizes the security key. |
