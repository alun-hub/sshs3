# Dual-Pane File Manager

The Dual-Pane File Manager in sshs3 provides a unified explorer for managing files across local storage, remote SFTP servers, Amazon S3 buckets, and Kubernetes containers.

---

## High-Performance SFTP Engine

sshs3 uses an integrated SFTP engine carried directly over your system's OpenSSH binary (`ssh -s sftp`):
- **Maximum Compatibility**: Reuses your existing OpenSSH credentials, keys, ProxyJump bastions, and smartcard agents without requiring an independent SFTP connection.
- **Optimised Throughput**: Features a high-speed SFTP v3 parser with a 16 MB packet guard and concurrent byte chunking for multi-gigabyte transfers.

---

## Dual-Pane Architecture & Any-to-Any Transfers

The file manager features two independent browsing panes (Left and Right). Each pane can independently connect to:
- **Local Filesystem**
- **Remote SFTP Server**
- **S3 Bucket / Object Store**
- **Kubernetes Pod Container**

### Supported Transfer Paths
- Local ↔ SFTP
- SFTP ↔ SFTP (Direct server-to-server or streamed)
- Local ↔ S3
- SFTP ↔ S3 (Transfer remote server files directly into S3 object storage)
- Local / SFTP / S3 ↔ Kubernetes Pod

---

## Transfer Queue & Conflict Resolution

- **Concurrent Job Execution**: File transfers are queued and executed concurrently according to your settings (default: 3 concurrent jobs).
- **Pause & Resume**: Large transfers can be paused, reprioritised, or cancelled at any time.
- **Conflict Handling**: When a destination file already exists, a conflict dialog prompts you to:
  - **Overwrite**: Replace destination file.
  - **Skip**: Omit the conflicting file and proceed with the remaining queue.
  - **Resume**: Continue appending where an interrupted transfer left off (supported on SFTP/local).
  - **Rename**: Save with an incremental suffix (e.g. `document_copy(1).pdf`).
  - Choose *"Apply to all remaining conflicts"* to avoid repeated prompts.

---

## Recursive Search & Wildcards (<kbd>Ctrl+F</kbd>)

Press <kbd>Ctrl+F</kbd> inside either file pane to activate the search bar:

- **Current Folder Search**: Instantly filters the active directory listing.
- **Recursive Subfolder Search**: Check the **"Recursive"** checkbox to traverse the entire folder tree downwards across SFTP, Local, S3, or K8s:
  - Supports up to 1,000 matches across up to 3,000 directories.
  - Traversal results display relative folder paths.
  - Symlink loop protection: Symlinked directories are never recursively followed.
  - Hidden folder awareness: Skips hidden directories unless *"Show Hidden Files"* is enabled.
- **Wildcards (`*` and `?`)**:
  - `*.log` matches all files ending in `.log`.
  - `backup-202?-*.tar.gz` matches variable year digits.
  - Plain strings fall back to case-insensitive substring search.

---

## Integrated Monaco Code Editor

Double-click or right-click any text file, script, YAML manifest, or configuration file and select **Edit**:
- Powered by the Monaco Editor (the editor core of VS Code).
- Features syntax highlighting for JSON, YAML, Shell, Python, Go, Rust, TypeScript, Markdown, Dockerfile, and more.
- Press <kbd>Ctrl+S</kbd> to save changes directly back to the remote SFTP host, S3 object, or Kubernetes container.
- Built-in Markdown live preview.

---

## Directory Synchronisation (Diff & Sync)

Compare and synchronise two directories (e.g. Local ↔ SFTP or SFTP ↔ S3):
1. Navigate Left pane to source directory and Right pane to destination directory.
2. Click **Sync Directories** on the toolbar.
3. Review the visual diff table:
   - Green: New files to be uploaded.
   - Blue: Modified files (detected via timestamp and byte size differences).
   - Red: Files present only on destination.
4. Select sync mode (One-way mirroring, Update existing only, or Two-way) and click **Execute Sync**.

---

## Permissions, Chmod & File Operations

- **Chmod Modal**: Select any remote file or directory on SFTP or K8s, right-click and select **Permissions**. Modify Read/Write/Execute permissions visually or input octal values (e.g. `0755`, `0644`). Supports recursive chmod.
- **Symlinks & Attributes**: View symlink targets, ownership (UID/GID), and exact byte sizes.
