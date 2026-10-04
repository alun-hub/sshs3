# Environment & Profile Sync

sshs3 provides intelligent synchronisation tools designed to keep your development environment comfortable and your connection profiles synchronised across machines without compromising privacy.

---

## 1. Dotfiles Pool Sync (Opt-In)

When working across dozens of remote servers, having to configure `.bashrc`, custom aliases, `.vimrc`, or `.tmux.conf` on every machine is tedious. sshs3 offers an opt-in **Dotfiles Pool Sync**:

### How It Works:
- Configure a local pool folder on your workstation containing your custom environment files (e.g. `~/.config/sshs3/dotfiles/`).
- In any SSH profile, enable **Sync Dotfiles on Connect**.
- When the session opens, sshs3 securely stages these dotfiles in an isolated remote session directory without overwriting or polluting permanent server-wide files.
- Your familiar aliases, prompts, and settings become immediately active in your session shell.
- In the file manager, right-click a file **or a directory** and choose **Add to Dotfiles Pool...**. The suggested target keeps the path from the first dot-folder (`~/.kube/config`, `~/.config/nvim/init.vim`). A directory is added recursively (up to 200 text files, max 1 MB each; symlinks and binary files are skipped). In the Dotfiles Pool Manager, **Upload Files** and **Upload Directory** use the same path rule. Pooled files are stored unencrypted on this device, so avoid directories containing credentials.

---

## 2. Remote Profile Sync ("Own Your Data")

For users working across multiple laptops and desktops, sshs3 offers end-to-end encrypted profile synchronisation.

### Core Philosophy: "Own Your Data"
sshs3 does **not** maintain any proprietary cloud servers or require a proprietary third-party account to sync your data. You choose your own storage backend:
- An Amazon S3 bucket (or MinIO, Cloudflare R2).
- A private remote SSH host.

### Client-Side Encryption
- Profiles are encrypted on your local machine using client-side AES-256-GCM before upload.
- Your remote storage backend sees only opaque encrypted blobs.
- Synchronisation traffic automatically routes through your unlocked smartcard, agent, or ProxyJump bastions.
