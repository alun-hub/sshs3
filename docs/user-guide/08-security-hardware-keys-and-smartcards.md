# Security, Hardware Keys & Smartcards

Security is the core design priority of sshs3. All cryptographic operations and credentials follow strict isolation and zero-trust principles.

---

## 1. Zero Private Key Extraction

A fundamental security principle of sshs3 is that **private keys are never exposed to the JavaScript or renderer environment**:
- **Hardware Security Keys (FIDO2)**: Cryptographic signatures are calculated directly on the physical authenticator chip (e.g. YubiKey). The private key cannot be extracted by any software.
- **Smartcards (PKCS#11)**: Keys reside inside the secure element of the smartcard. Operations are delegated via the PKCS#11 module to the card hardware.
- **Software Private Keys**: Standard OpenSSH private keys on disk (`id_ed25519`, `id_rsa`) are read and processed exclusively by your operating system's native `ssh` binary. sshs3 never reads, parses, or retains your private key bytes in memory.

---

## 2. FIDO2 / WebAuthn Hardware Security Keys

sshs3 natively supports OpenSSH FIDO2 hardware keys:
- Supported algorithms: `sk-ssh-ed25519@openssh.com` and `sk-ecdsa-sha2-nistp256@openssh.com`.
- **Touch-Presence Banner**: When a remote connection requires user verification, sshs3 displays a prominent visual touch-presence banner with an animated indicator:
  > *"Touch your security key to authenticate..."*
  This ensures you always know when your hardware key is awaiting physical interaction, preventing timeouts and confusing UI hangs.
- Pin-protected FIDO2 tokens are supported with secure ephemeral PIN entry.

---

## 3. Smartcards & PKCS#11 Authentication

sshs3 provides built-in discovery and support for PKCS#11 security modules:

### Supported Smartcard Providers & Libraries
- **p11-kit** (Default on Linux: `/usr/lib/x86_64-linux-gnu/p11-kit-proxy.so` or `/usr/lib64/p11-kit-proxy.so`). Proxies all system-registered cryptographic tokens.
- **Yubico PIV Tool (`libykcs11`)**: Direct module for YubiKey PIV smartcard functionality on Linux, macOS, and Windows (`C:\Program Files\Yubico\Yubico PIV Tool\bin\libykcs11.dll`).
- **OpenSC (`opensc-pkcs11.so` / `opensc-pkcs11.dll`)**: Universal open-source driver for standard cryptographic cards (CAC, PIV, Feitian, Nitrokey).
- **Net iD (Enterprise PKCS#11)**: Supported for government and healthcare PKI environments.

---

## 4. Ephemeral PIN Caching Policies

To balance security and productivity, sshs3 offers three configurable PIN caching policies:

1. **Per-Session (Default)**:
   - Your PIN is prompted upon connection and held in volatile memory only for the duration of that specific SSH session handshake.
2. **Global (App Lifetime)**:
   - Your PIN is securely cached in volatile application memory for the duration of the current sshs3 app run.
   - Opening new split panes, additional tabs, SFTP sessions, or local shell tabs will automatically reuse the unlocked smartcard/key without re-prompting for a PIN.
   - When sshs3 quits, the cache is completely purged.
3. **Never (Highest Security)**:
   - Every single cryptographic signature request triggers a PIN prompt.

> [!IMPORTANT]
> PIN codes and passphrases are **never** written to disk under any circumstance.

---

## 5. Stored Secrets Encryption at Rest

When you choose to save passwords or S3 access keys in sshs3:
- **Operating System Keychain**: Credentials are encrypted using your system's native security infrastructure:
  - **Linux**: Secret Service API via `libsecret` (GNOME Keyring or KWallet).
  - **Windows**: Windows Credential Manager / DPAPI.
  - **macOS**: Apple Keychain Services.
- **Passphrase Fallback**: On headless systems or minimal environments without a running Secret Service daemon, sshs3 offers an AES-256-GCM master passphrase vault to protect stored secrets on disk.
