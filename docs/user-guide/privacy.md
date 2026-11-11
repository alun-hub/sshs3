## Privacy Policy

**sshs3** is a desktop application that runs entirely on your own computer. It has no sshs3 account, no sshs3 servers and no telemetry: the developer does not receive, store or process any data about you or your use of the app. This page is the privacy policy for sshs3 on all platforms, including the Microsoft Store version.

Last updated: 2026-11-11.

---

## 1. What sshs3 Collects

| Question | Answer |
| :--- | :--- |
| Does sshs3 send telemetry, analytics or crash reports? | **No.** |
| Does sshs3 have an account, sign-in or tracking identifier? | **No.** |
| Does the developer receive any of your data? | **No.** Nothing is sent to the developer or to any sshs3-operated service. |
| Does sshs3 contain advertising or third-party tracking code? | **No.** |
| Does sshs3 sell or share personal information? | **No.** It has no personal information to sell or share. |

> [!NOTE]
> The Microsoft Store, Windows and your operating system may collect their own data about installing and running apps. That is governed by Microsoft's privacy statement, not by this policy.

---

## 2. Data Stored on Your Computer

sshs3 keeps what you enter on your own device, in its data folder in your user profile:

| Data | How it is protected |
| :--- | :--- |
| Connection profiles (hosts, user names, ports, folders, tunnels) | Stored locally. |
| Saved passwords, passphrases and tokens | Encrypted at rest with the operating system keyring. |
| Private keys on hardware tokens (FIDO2, YubiKey, smartcards) | Never leave the device. PINs are not written to disk or logs. |
| Settings, snippets, session layout | Stored locally. |
| Application logs | Stored locally, with sensitive content masked. |

Uninstalling the app and deleting its data folder removes all of it. sshs3 does not keep a copy anywhere else.

---

## 3. Network Connections

sshs3 connects only to servers and services that **you** configure or ask it to contact:

| Feature | What it contacts |
| :--- | :--- |
| SSH, SFTP, tunnels | The hosts and jump hosts in your profiles, through your system's OpenSSH client. |
| S3 storage | The S3-compatible endpoint in your profile (for example AWS S3 or a self-hosted service). |
| Kubernetes and OpenShift | The API servers in your kubeconfig. |
| SSH certificate authority | Your own Step-CA, Vault or OpenBao server and your OIDC identity provider. |
| Profile sync and Team Vault (optional, off by default) | The S3 or SFTP location you choose. Data is encrypted on your device before upload, and the storage provider cannot read it. |
| Fetching a public SSH key or importing dotfiles from GitHub or GitLab | That site, only when you start the action. |

Data you send to these servers is handled by their operators under their own policies.

### Update check

Builds installed outside the Microsoft Store can check GitHub Releases for new versions. The request is a plain release lookup and contains no personal information. It can be switched off under **Settings → App Behavior**, or with the environment variable `SSHS3_DISABLE_UPDATES=1`. The Microsoft Store version does not run this check; the Microsoft Store delivers updates.

---

## 4. Children

sshs3 is a developer and system administration tool and is not directed at children. It collects no personal information from anyone.

---

## 5. Changes to This Policy

If this policy changes, the new version is published on this page with an updated date. Because sshs3 collects no data, changes would concern new optional features, not existing data.

---

## 6. Contact

Questions about privacy can be raised as an issue at [github.com/alun-hub/sshs3/issues](https://github.com/alun-hub/sshs3/issues). To report a security vulnerability, follow the [Security Policy](https://github.com/alun-hub/sshs3/blob/master/SECURITY.md).

Technical details on how secrets and PINs are handled are in [Security & smartcards](/docs/security/smartcards/).

---

## 7. Troubleshooting & Diagnostics

| Symptom | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| You see outgoing traffic you did not expect | A connection you configured (profile, sync target, S3 endpoint, Kubernetes cluster), or the update check in a non-Store build | Check the profiles and sync settings. Switch the update check off under **Settings → App Behavior** or set `SSHS3_DISABLE_UPDATES=1`. |
| You want to remove all stored data | Profiles and settings live in the local data folder | Uninstall sshs3 and delete its data folder in your user profile. |
