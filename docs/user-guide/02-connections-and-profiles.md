# Connection Manager & Profiles (Complete Reference)

The Connection Manager is the hub of **sshs3** for creating, editing, grouping and securing all your connection targets: SSH servers, local terminals, Kubernetes clusters and S3-compatible cloud storage.

### SSH Agent in Local Terminals

Under **Settings → Local Terminal SSH Agent** you choose how `SSH_AUTH_SOCK` is set in local shell tabs:

| Option | Behavior |
|---|---|
| **Auto** (default) | Uses, in order: an unlocked smartcard agent (Global PIN cache), the app's own agent if it is already running, the system / login-shell agent, and otherwise starts an agent of its own. |
| **System Only** | Uses only the system / login-shell `SSH_AUTH_SOCK`, if there is one. The app starts no agent and does not use the smartcard agent. |
| **Disabled** | No `SSH_AUTH_SOCK` is set in the terminal. |

The change applies to new terminal tabs; tabs that are already open keep their environment.

### `~/.ssh/config` Stays in Sync with Your Profiles

sshs3 writes its own marked block into `~/.ssh/config` from your SSH profiles (host, port, user, key file, ProxyJump and so on). That is why `ssh <profile-name>` and tab completion work in any terminal exactly as they do in the app. The block is updated at startup and whenever you save, delete or import an SSH profile. Everything outside the block is left untouched, passwords and passphrases are never written there, and directives that can execute code (`ProxyCommand`, `LocalCommand`, `Match`, `Include` and others) are filtered out. You can turn the feature off under **Settings → Keep `~/.ssh/config` in sync with saved SSH profiles**.

**Unlocked cards work in every terminal (Linux/macOS).** When PIN caching is *Global* and a smartcard or FIDO2 key is unlocked in the app, sshs3 also adds a second, purely local block (`# BEGIN sshs3-agent … # END sshs3-agent`, never synced). It points those hosts at the app's agent, so a plain `ssh <profile-name>` in any terminal (including IDEs and other terminal programs) signs with the unlocked key without another PIN prompt. If you lock the card, quit the app or leave Global mode, the block is removed and `ssh` asks for the PIN itself via the profile's `PKCS11Provider`. If the app crashes, the block can stay behind pointing at a dead socket until sshs3 is started again (it is cleaned up at startup).

---

## 1. Overview of Profile Types

sshs3 supports four basic profile types:

1. **SSH profiles**: Connections through the system's own OpenSSH binary (`node-pty`) to Linux, UNIX, BSD and Windows hosts, with SFTP and background tunnel support.
2. **Local shell profiles**: Run terminals directly on your local computer (`$SHELL` on Linux/macOS; PowerShell, `pwsh`, CMD or WSL on Windows) with an automatically integrated `SSH_AUTH_SOCK` (see [SSH Agent in Local Terminals](#ssh-agent-in-local-terminals)).
3. **Kubernetes profiles**: Direct connection to contexts, namespaces, pods and containers in `~/.kube/config` or via OpenShift `oc login`.
4. **S3 storage profiles**: Cloud and object storage against AWS S3, Cloudflare R2, MinIO, Wasabi and Backblaze B2.

---

## 2. The SSH Profile Form: Complete Field Reference

When you click **New Profile** (or edit an existing SSH profile), the profile form opens:

![SSH profile form](/img/docs/profile-new-ssh.png)

### 2.1 Basic Properties (General)

| Field | Default | Purpose & Description | Limits & Edge Cases |
| :--- | :--- | :--- | :--- |
| **Profile Name** | `e.g. Production Server` | A readable display name for the profile, shown in the connection list, tabs and split panes. | Must not be empty. Special characters are allowed, but short, clear names are recommended so tab titles are not truncated. |
| **Group / Folder** | *Empty* (optional) | Groups profiles in the tree in the Connection Manager (for example `Production`, `Staging`, `Customers/Customer-A`). | Subfolders are created with a slash (`/`). If the field is left empty, the profile is placed at the root level. |
| **Hostname / IP** | *Required* | The remote host's FQDN (for example `web01.corp.internal`) or IPv4/IPv6 address. | Must resolve through DNS or be reachable by IP. With ProxyJump this is the hostname as the bastion reaches it. |
| **Port** | `22` | The TCP port of the SSH daemon on the target host. | Integer between 1 and 65535. The default is always 22. |
| **Username** | *Required* | The username for logging in to the remote host (for example `ubuntu`, `root`, `deploy`). | Follows standard POSIX username rules. |
| **Initial SFTP Path** | *Empty* (optional) | The default directory the file manager opens automatically on an SFTP connection (for example `/var/www` or `/home/user`). | If the path does not exist on the remote server, the file manager automatically falls back to the user's home directory. |

---

### 2.2 Authentication Methods (`authType`)

sshs3 supports five separate authentication methods in the **Authentication** drop-down:

#### A. Password
- **Purpose**: Standard password authentication. Also required by SFTP unless key-based login is used.
- **How it is used**: Enter the password in the input field. The password is encrypted in the OS keychain (Linux Secret Service / Windows DPAPI / macOS Keychain).
- **Limits**: If the password field is left empty, you are prompted to enter the password interactively in the terminal when connecting. Interactive password login is not supported by the background-based Performance Bar on Windows.

#### B. SSH Key (Private Key File)
![SSH key authentication](/img/docs/profile-auth-privatekey.png)
- **Purpose**: Asymmetric key authentication with a private key stored on disk.
- **How it is used**: Click **Browse…** to select your private key file (for example `~/.ssh/id_ed25519` or `~/.ssh/id_rsa`). If the key is encrypted with a passphrase, it can be entered in the **Passphrase** field.
- **Limits**: The file must be readable by the local user. The passphrase is stored encrypted in the system keyring.

#### C. SSH Agent
- **Purpose**: Reuses keys that are already unlocked in your local `ssh-agent` or the Windows OpenSSH Authentication Agent.
- **How it is used**: Select "SSH Agent". No passwords or key paths need to be entered in the profile.
- **Limits**: Requires an agent to be running in the operating system and the key to have been added already (`ssh-add`). If the agent does not have the key loaded, the login is denied.

#### D. Smartcard (PKCS#11)
![Smartcard PKCS#11 authentication](/img/docs/profile-auth-smartcard.png)
- **Purpose**: Hardware authentication with a smartcard or YubiKey PIV through a PKCS#11 cryptographic library.
- **How it is used**: sshs3 automatically scans known library paths and shows quick buttons:
  - **p11-kit** (`p11-kit-proxy.so`): The default on Linux; proxies all registered tokens in the system.
  - **YubiKey (`libykcs11`)**: Direct library for YubiKey PIV (`libykcs11.so` / `libykcs11.dll`).
  - **OpenSC (`opensc-pkcs11.so` / `opensc-pkcs11.dll`)**: General open-source driver for most smartcards.
  - **Net iD**: Support for corporate and government cards.
- **Limits**: The library file must be installed locally on the computer. The PIN is cached according to the selected policy (Always Prompt, Once Per Terminal Connection or Global) and is never written to disk.

#### E. FIDO2 / Security Key (Hardware Key)
![FIDO2 hardware key](/img/docs/profile-auth-fido2.png)
- **Purpose**: Hardware authentication with FIDO2/WebAuthn keys (for example the YubiKey 5 series).
- **How it is used**:
  - **Discoverable / Resident Credentials**: Load built-in resident keys directly from the connected security key with the **Scan Security Key** button.
  - **Key File**: Select a generated `id_ed25519_sk` or `id_ecdsa_sk` file on disk.
  - **Built-in key generator**: Click **Generate FIDO2 Key** to create a new FIDO2 key directly in the app, with options for type (`ed25519-sk` vs `ecdsa-sk`), resident credential (`-O resident`) and user verification (`-O verify-required`).
- **Limits**: The remote server's OpenSSH daemon must be at least version 8.2 to support FIDO2 cryptographic algorithms. When logging in, a physical touch of the key is required when the **Touch-Presence Banner** is shown.

---

### 2.3 Access Check & Key Installation (`ssh-copy-id` GUI)

At the bottom of the profile form is the **Access** section:

![Access check and key installation](/img/docs/profile-install-key-modal.png)

- **Test Connection / Access Check Timeline**:
  A 5-step visual timeline that tests the whole connection chain:
  1. `Reach Host`: TCP connection to the IP/port (including via ProxyJump).
  2. `Host Key`: Verifies that the server's host key matches `known_hosts`.
  3. `Login Methods`: Quietly asks sshd which login methods are allowed (password, publickey and so on) without requiring a PIN or a touch.
  4. `Key Installed`: Checks whether the selected public key is in `~/.ssh/authorized_keys`.
  5. `Login Works`: Tests an actual login.
- **Install Key…**:
  Installs one or more selected public keys directly into the server's `~/.ssh/authorized_keys` in a single session. Automatically sets `0700` on `~/.ssh` and `0600` on `authorized_keys`.
- **Copy Command**:
  Generates a readable shell script with one click, for servers that cannot be reached directly from your workstation.

---

### 2.4 Advanced SSH Options

Expanding the **Advanced SSH Options** section gives you access to fine-grained network and protocol parameters:

![Advanced SSH options](/img/docs/profile-advanced-options.png)

| Field / Option | Default | Purpose & Description | Limits |
| :--- | :--- | :--- | :--- |
| **Agent Forwarding (`-A`)** | Off | Forwards your local SSH agent to the remote host so you can hop on to other servers without copying private keys. | **Security warning**: Enable only on servers you trust. An administrator on the remote host can temporarily access your local agent through the exposed socket. |
| **X11 Forwarding (`-Y`)** | Off | Forwards X11 windows from graphical Linux programs to your local screen. | On Windows the app automatically starts the bundled VcXsrv server. On Linux a local `$DISPLAY` (X11 or XWayland) is required. |
| **Custom X11 Display** | *Empty* (auto) | Manual display identifier (for example `127.0.0.1:0.0` on Windows or `:0` on Linux). | Overrides automatic detection. |
| **Compression (`-C`)** | Off | Enables gzip compression of SSH traffic. | Improves performance over slow mobile connections, but can increase CPU load on fast gigabit networks. |
| **ServerAliveInterval** | `0` (off) | Sends periodic keepalive packets to the server (in seconds) to prevent firewalls and NAT from closing idle connections. | Value in seconds (for example `30` or `60`). 0 turns the feature off. |
| **Custom Ciphers** | *System default* | Restricts the allowed encryption algorithms (for example `chacha20-poly1305@openssh.com,aes256-gcm@openssh.com`). | The algorithms must be supported by both the client's and the server's OpenSSH binaries. |
| **KEX Algorithms** | *System default* | Restricts the accepted key exchange algorithms (for example `curve25519-sha256,diffie-hellman-group16-sha512`). | Used for strict security requirements or when connecting to older hardware. |
| **MAC Algorithms** | *System default* | Restricts Message Authentication Codes (for example `hmac-sha2-512-etm@openssh.com`). | Only relevant for non-AEAD ciphers. |
| **Custom SSH Arguments** | *Empty* | Free-form `-o Option=Value` parameters passed straight to the `ssh` command. | Incorrect flags can make OpenSSH refuse to start. |
| **Dotfiles Pool Sync** | *Off* | Links the profile to a dotfile pool for automatic environment loading at startup. | Requires the Dotfiles Pool to be enabled in the app settings. |

---

## 3. The S3 Profile Form: Complete Field Reference

Click the **S3 Object Storage** tab and then **New Profile** to configure an object storage profile:

![S3 profile form](/img/docs/s3-profile-form.png)

| Field | Default | Purpose & Description | Limits |
| :--- | :--- | :--- | :--- |
| **Profile Name** | `e.g. Backup Bucket` | Display name in the tree list and the file manager. | Must not be empty. |
| **Group / Folder** | *Empty* (optional) | Subfolder for structuring cloud accounts and environments. | Optional. |
| **Region** | `us-east-1` | AWS or cloud region (for example `eu-north-1`, `auto` for Cloudflare R2, or `us-east-1` for MinIO). | Must match the bucket's actual region. |
| **Endpoint URL** | *Empty* (AWS) | Custom S3 endpoint for MinIO, R2, Wasabi or a local Ceph cluster (for example `https://s3.wasabisys.com` or `http://localhost:9000`). | Leave empty if you use official Amazon Web Services (AWS). |
| **Initial Path** | *Empty* (`/`) | Automatically opens a specific bucket or virtual folder (for example `my-bucket/logs/`). | Must be a valid path. |
| **Access Key ID** | *Required for static auth* | Static access key for the S3 IAM user. | Stored encrypted in the OS keychain. |
| **Secret Access Key** | *Required for static auth* | Secret access key for the S3 IAM user. | Stored encrypted in the OS keychain. |
| **Session Token** | *Empty* (optional) | Temporary security token (STS) for temporary credentials. | Expires when the STS session expires. |
| **Path-style addressing** | On | Forces requests in the `endpoint/bucket/key` format instead of virtual hosting `bucket.endpoint/key`. | **Critical for MinIO**, Ceph and local Docker containers where DNS subdomains do not point to the right IP. |
| **Use SSL/TLS** | On | Encrypts all S3 data traffic with HTTPS. | Can be turned off for local development against `http://localhost:9000`. |
| **Allow self-signed certs** | Off | Allows self-signed TLS certificates on private MinIO servers. | Should only be used in internal lab environments. |
| **Server-Side Encryption** | `None` | Encryption at rest on the server: `None`, `SSE-S3 (AES256)` or `SSE-KMS`. | With SSE-KMS the correct KMS Key ID must be configured on the server. |
| **Outgoing Proxy** | Off | Routes all S3 API traffic through an HTTP or SOCKS5 proxy. | Supports a username and password for the proxy. |
