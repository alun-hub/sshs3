# Security, Hardware Keys & Smartcards

Security and privacy are the foundations of **sshs3**. The application is designed around the principles of **Zero Private Key Extraction** and strict memory isolation.

---

## 1. Zero Private Key Extraction Architecture

A crucial difference between sshs3 and other clients is that **private keys are never exposed to JavaScript, Node or renderer memory**:

- **FIDO2 / WebAuthn keys (YubiKey)**:
  The cryptographic signatures are performed directly on the security chip in the hardware. The private key technically cannot be extracted by any software on the computer.
- **Smartcards (PKCS#11)**:
  The keys live in the smartcard's protected element. Signing is delegated through the PKCS#11 module (`p11-kit`, `libykcs11`, `opensc`).
- **Software keys on disk (`id_ed25519`, `id_rsa`)**:
  Read and handled exclusively by your operating system's own `ssh` binary. sshs3 never reads, parses or stores your private key bytes in the application's memory.

---

## 2. Visual Touch-Presence Banner

When you authenticate to a server with a FIDO2 hardware key (`ed25519-sk` or `ecdsa-sk`), the security key requires physical user presence:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🔑 Touch your security key to authenticate...                          │
└────────────────────────────────────────────────────────────────────────┘
```

### Why the Banner Is Critically Important:
- In traditional CLI terminals the connection often seems to "freeze" or hang while waiting for the user to notice that the YubiKey is blinking discreetly under the desk.
- sshs3 detects when the OpenSSH handshake requests user verification and shows an animated, gold-shimmering banner at the top of the window:
  > *"Touch your security key to authenticate..."*
- **Timeout**: If you do not touch the key within OpenSSH's time limit (usually ~30 seconds), the handshake is aborted with a clear error message instead of hanging.

---

## 3. Resident vs. Non-Resident FIDO2 Keys

When you configure a FIDO2 profile in sshs3 you can choose between two modes:

### A. Non-Resident Keys (File-Based)
- **How it works**: A small pointer key (`id_ed25519_sk` and `id_ed25519_sk.pub`) is generated and saved on your hard drive. The file contains a "key handle" that points to the hardware key.
- **Advantage**: Easy to manage through standard OpenSSH configuration files.
- **Limitation**: If you change computers, you must bring your `id_ed25519_sk` file to the new machine.

### B. Resident / Discoverable Credentials (Built-in)
- **How it works**: The key and its metadata are stored directly inside the hardware key itself (for example a YubiKey 5).
- **How it is used**: Click **Scan Security Key** in the profile form. sshs3 loads all resident keys directly from the key without you needing any files on disk.
- **Advantage**: Maximum mobility. You can plug your YubiKey into any computer and connect immediately without copying any files.

---

## 4. Ephemeral PIN Caching Strategies

To protect smartcards and PIN-protected security keys, sshs3 offers three fine-grained policies:

![Security settings](/img/docs/settings-security.png)

1. **Always Prompt (default)**:
   - No caching between connections: reconnecting always asks for the PIN again. Use this where policy requires fresh authentication on every login.
2. **Once Per Terminal Connection**:
   - The PIN is entered once into a private, app-managed `ssh-agent` shared by the terminal tab and its dotfiles sync. The agent is closed when the terminal disconnects; automatic reconnects after a network interruption reuse the open agent.
3. **Global (App Lifetime) — most convenient, least strict**:
   - The PIN is entered once per card and shared by all terminals and profiles for as long as sshs3 runs.
   - When you open new shared split panes, new tabs, start SFTP or run `git pull` in a local shell, the unlocked card is reused automatically, so you don't have to type your PIN twenty times a day.
   - **Security guarantee**: The PIN is **NEVER written to disk**. The moment you quit sshs3 (<kbd>Ctrl+Q</kbd>), memory is cleared completely.
   - A card icon in the top bar (shown only in this mode) lists what is cached and has the **Lock All Now** button.
   - **One shared agent**: all unlocked smartcards and FIDO2 keys live in *one* private ssh-agent for the whole app, on a stable socket (`$XDG_RUNTIME_DIR/sshs3/agent.sock`, which only you can access). Local terminals get it as `SSH_AUTH_SOCK`; even tabs that were opened *before* you unlocked the card work once you have unlocked it, because the agent stays in place. **Lock All Now** makes the agent forget all keys without restarting it. When nothing is unlocked, the same button becomes **Unlock Now**, which unlocks again whenever you want (PIN prompt) without restarting the app.
   - For FIDO2 keys that require PIN and touch on every signature, the PIN you entered when unlocking is kept in memory only and reused for signatures until you lock, so connecting asks only for the touch.
   - The app's own connections through the agent are pinned to that profile's card (`IdentitiesOnly` + a public key file), so the server does not see all your unlocked cards and a FIDO2 key doesn't get a needless touch prompt.
   - If you would rather use the system's own agent in local terminals, choose **System Only** under **Settings → Local Terminal SSH Agent**.

---

## 5. Encryption of Saved Credentials at Rest

When you choose to save passwords, proxy passwords or S3 access keys in sshs3, they are protected by the operating system's hardware-backed keyrings:
- **Linux**: GNOME Keyring / KWallet through `libsecret` (Secret Service API).
- **Windows**: Windows Credential Manager / DPAPI (Data Protection API).
- **macOS**: Apple Keychain Services.
- **Passphrase Vault (fallback)**: If you run in a minimal environment without an active Secret Service daemon, the database is encrypted with **AES-256-GCM** protected by a master password.
