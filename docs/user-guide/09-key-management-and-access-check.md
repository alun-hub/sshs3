# Public Key Deployment & Access Check

Deploying public keys to remote servers can often be tedious and error-prone. sshs3 includes an intelligent, graphical `ssh-copy-id` tool and a multi-stage **Access Check Timeline** directly inside the profile configuration workflow.

---

## 1. Install Public Key (`ssh-copy-id` GUI)

Every SSH profile in sshs3 features an **Install Key** icon (<kbd>🔑</kbd>) and a dedicated **Access** section in the profile editor:

### Selecting Keys for Installation
You can select one or more public keys to deploy to the server simultaneously:
- **Local Key Files**: Browse and select any `.pub` file on your computer.
- **Active SSH Agent Keys**: Select keys currently unlocked in your running `ssh-agent`.
- **Smartcard & FIDO2 Public Keys**: Automatically extract and select the public key corresponding to an inserted hardware token (YubiKey PIV or FIDO2).
- **Paste Public Key**: Directly paste an `ssh-ed25519 AAAAC3...` string.

### Idempotent Single-Session Deployment
- sshs3 establishes a single secure connection to the remote host.
- It parses `~/.ssh/authorized_keys` and installs only keys that are not already present.
- Each key is reported with an explicit status: **"Installed"** or **"Already Present"**.
- Fixes permissions automatically: Ensures `~/.ssh` has `0700` and `authorized_keys` has `0600`.
- Routes seamlessly through any configured **ProxyJump** bastion hosts.

### Smart Authentication Selection
During key deployment, the app ensures you are not prompted unnecessarily:
- The app never attempts to authenticate using the very key it is trying to install.
- If you have an existing password, smartcard, or agent key configured, sshs3 selects the optimal authentication method automatically, or allows you to force a specific method.

---

## 2. 5-Stage Access Check Timeline

When configuring or troubleshooting a connection, sshs3 provides a real-time diagnostic timeline that shows exactly where a connection chain succeeds or breaks:

```
[1. Reach Host] ───► [2. Host Key] ───► [3. Login Methods] ───► [4. Key Installed] ───► [5. Login Works]
```

1. **Reach Host**: Verifies TCP connectivity to the target host and port (or through the ProxyJump bastion chain).
2. **Host Key**: Verifies that the remote host key matches `~/.ssh/known_hosts` (or prompts for initial trust).
3. **Login Methods**: Probes the remote OpenSSH daemon (`sshd`) silently to determine which authentication methods are permitted (e.g. `publickey`, `password`, `keyboard-interactive`). This probe requires no PIN, passphrase, or physical touch.
4. **Key Installed**: Inspects whether the selected public key exists in the remote user's `~/.ssh/authorized_keys`.
5. **Login Works**: Executes a non-interactive authentication test to confirm end-to-end access.

---

## 3. Offline / Copy Command Generator

If your remote host cannot be reached directly from your workstation (e.g. behind an air-gapped firewall, private VPC, or VPN requiring dual-hop bastions):
- Click **Copy Command** in the Access section.
- sshs3 generates a self-contained, human-readable shell one-liner:
  ```bash
  mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@workstation' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
  ```
- Simply paste this into your remote terminal to install your key instantly.
