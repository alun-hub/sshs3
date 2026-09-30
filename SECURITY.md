# Security Policy

The **sshs3** project takes security vulnerabilities seriously. We appreciate your efforts to responsibly disclose any security vulnerabilities you find.

---

## Supported Versions

Only the latest released minor version of sshs3 receives active security updates and patches.

| Version | Supported          |
| ------- | ------------------ |
| >= 0.9  | :white_check_mark: |
| < 0.9   | :x:                |

---

## Core Security Principles & Cryptographic Hygiene

sshs3 is built on zero-knowledge and defense-in-depth principles:
- **Ephemeral PINs and Passphrases**: Smartcard PINs, FIDO2 user verification, and key passphrases are strictly ephemeral. They are passed directly to the OpenSSH child process via standard input and immediately discarded and garbage-collected. **They are never saved to the filesystem, cached in memory, or logged in plaintext.**
- **Private Key Isolation**: Private keys on hardware security keys (YubiKey, PKCS#11, FIDO2/WebAuthn, SITHS, Net iD) **never leave the physical cryptographic hardware**. Challenge signatures are computed on-chip. Disk keys are accessed exclusively through your system's OpenSSH client or `ssh-agent`.
- **Operating System Keyring**: Any stored passwords or S3 secret keys in connection profiles are encrypted using the host OS keyring (`safeStorage`: libsecret on Linux, DPAPI on Windows, Keychain on macOS).
- **Protected Local IPC**: The internal askpass mechanism uses a mode `0700` private Unix domain socket on Linux/macOS and a 128-bit cryptographically tokenized loopback interface on Windows.

For full architectural details, see [Security & Privacy in README.md](README.md#security--privacy-private-keys-pins--credentials).

---

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities via public GitHub issues, discussions, or pull requests.**

Instead, please report security issues through one of the following channels:

1. **GitHub Private Vulnerability Reporting (Preferred)**:
   Navigate to the [Security Advisories](https://github.com/alun-hub/sshs3/security/advisories) tab of this repository and click **"Report a vulnerability"**.

2. **Email**:
   Send an email to [info@sshs3.com](mailto:info@sshs3.com) with the subject line `[SECURITY] Potential vulnerability in sshs3`.

### What to Include in Your Report

To help us investigate and triage the report promptly, please include:
- A detailed description of the vulnerability and its potential impact.
- Exact steps to reproduce the issue or a minimal proof-of-concept (PoC).
- Affected version(s) and operating system(s).
- Any recommended remediations or mitigations if you have them.

### Response Timeline

- **Initial acknowledgment**: Within 48 hours of receiving your report.
- **Triage & validation**: We will work with you to confirm the issue and assess its severity.
- **Remediation**: A fix will be developed, reviewed, and published in a security patch release.
- **Public Disclosure**: Once a patched release is published, we will coordinate public disclosure and credit you for the responsible report (unless you prefer anonymity).
