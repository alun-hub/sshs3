## Dual-Pane File Manager & SFTP Engine

The File Manager in **sshs3** provides a high-performance, keyboard-driven dual-pane explorer modeled after Midnight Commander and WinSCP, modernized for hybrid cloud infrastructure. It enables transparent file operations across local disks, remote OpenSSH SFTP servers, S3 object storage, and running Kubernetes containers.

![Dual-Pane File Manager](/img/filemanager.png)

---

## 1. Native OpenSSH SFTP v3 Engine

### Feature: Subsystem Execution via System OpenSSH

#### 🎯 Purpose
Replace vulnerable JavaScript SSH libraries with the operating system's native OpenSSH client to ensure uncompromising cryptographic security, hardware token compatibility, and seamless proxy routing.

#### 🛠️ How to Use
1. Launch the file manager via <kbd>Ctrl+Shift+F</kbd> or double-click an SFTP profile.
2. Navigate via keyboard (<kbd>Tab</kbd> switches active pane, <kbd>Enter</kbd> enters directories or opens files, <kbd>Backspace</kbd> ascends to parent folder).
3. Drag and drop files between panes or directly from your workstation's desktop.
4. Manage permissions via right-click → **Permissions (chmod)** with octal (e.g. `0755`, `0644`) and symbolic checkboxes.

### Keyboard Ergonomics & Spatial Navigation

The file manager is designed to be fully operable without a mouse:
- **Spatial Navigation (<kbd>Ctrl+Shift+Arrows</kbd>)**:
  - <kbd>Ctrl+Shift+Left</kbd> / <kbd>Right</kbd>: Toggles focus directly between the left and right file pane.
  - <kbd>Ctrl+Shift+Up</kbd>: Shifts focus up to the **Tab Bar** (where <kbd>Left</kbd>/<kbd>Right</kbd> switches active workspace tabs, and <kbd>Down</kbd> or <kbd>Enter</kbd> returns focus into the file pane).
  - <kbd>Ctrl+Shift+Down</kbd>: Returns focus from the toolbar directly into the active pane's file list.
- **In the File List**:
  - <kbd>Up</kbd> / <kbd>Down</kbd>: Moves selection up and down.
  - <kbd>Enter</kbd>: Enters the selected folder or opens the file in the built-in viewer (focus remains in the file list).
  - <kbd>Escape</kbd>: Clears the current selection.

| Key / Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Enter</kbd> | Open / Edit | Opens the selected folder, or opens the file in the built-in text editor. |
| <kbd>Backspace</kbd> / <kbd>Alt+Up</kbd> | Up Directory | Ascends one directory level up the tree. |
| <kbd>Alt+Left</kbd> / <kbd>Alt+Right</kbd> | History Back / Forward | Navigates through previously visited folders. |
| <kbd>Ctrl+C</kbd> / <kbd>Ctrl+X</kbd> / <kbd>Ctrl+V</kbd> | Copy / Cut / Paste | Clipboard operations across folders and protocols (cut items dim until pasted). |
| <kbd>Ctrl+A</kbd> | Select All | Highlights all files and folders in the active pane. |
| <kbd>Escape</kbd> | Clear Selection | Clears current file selections without changing directory. |
| <kbd>F2</kbd> | Rename | Renames the selected file or folder in place. |
| <kbd>Delete</kbd> | Delete | Prompts for confirmation and deletes selected items. |
| <kbd>F5</kbd> | Refresh | Re-reads directory listings from the underlying storage provider. |
| <kbd>Home</kbd> / <kbd>End</kbd> | First / Last Item | Jumps directly to the start or end of the directory list. |
| *Type letters* | Quick Jump | Typing characters immediately jumps focus to the matching file name. |
| <kbd>Ctrl+F</kbd> | Filter List | Filters visible items with wildcard matching (e.g. `*.log`, `data-?-final.csv`). |
| <kbd>Ctrl+Shift+K</kbd> | Search in Files | Recursive content search (with regex support) across local disk, SFTP, and S3. |

#### ⚠️ Limitations & Caveats
- SFTP v3 does not natively support advanced POSIX Access Control Lists (ACLs) within the protocol frame.
- Exceptionally large directory listings (>100,000 files) may take a few seconds to parse depending on network latency.

#### ⚙️ Technical Internals & Architecture
`SFTPStorageProvider` (`src/main/storage/SFTPStorageProvider.ts`) spawns the OpenSSH client in subsystem mode:
```bash
ssh <args from SmartcardDetector> -o BatchMode=no -s -- [user@]host sftp
```
- `SftpPacketProtocol` processes binary SFTP v3 packets (`SSH_FXP_INIT`, `SSH_FXP_OPEN`, `SSH_FXP_READ`, etc.).
- `SftpStreams` delivers `ReadableStream` and `WritableStream` with Node.js backpressure management, preventing memory exhaustion over saturated links.
- Hardware token touch prompts and smartcard PIN requests are handled transparently via the app's `AskpassServer`.

---

## 2. In-Memory Streaming Across Storage Providers

sshs3 implements a unified `IStorageProvider` abstraction for all storage backends:

```mermaid
flowchart LR
    SFTP["SFTP Server (OpenSSH)"] <--> |In-Memory Stream| Pipeline["TransferPipeline & ByteMeter"]
    S3["S3 Bucket (AWS/MinIO)"] <--> |In-Memory Stream| Pipeline
    Local["Workstation Local Disk"] <--> |In-Memory Stream| Pipeline
    K8s["Kubernetes Pod Container"] <--> |In-Memory Stream| Pipeline
```

### Feature: Zero Disk Staging Transfers

#### 🎯 Purpose
Enable direct file transfers between disparate storage systems (e.g., from an SFTP server directly to an Amazon S3 bucket, or from a Kubernetes pod to a local disk) without writing intermediate staging files to your workstation's hard drive.

#### 🛠️ How to Use
- Open an SFTP server in the left pane and an S3 bucket in the right pane.
- Select files and press <kbd>F5</kbd> (Copy) or drag and drop across panes.
- The transfer queue dock at the bottom displays progress, speed (MB/s), and estimated time to completion.
- Transfers can be paused and resumed at any time.

#### ⚠️ Limitations & Caveats
- Data streams through your workstation's network interface; transfer speed is bound by the slowest link.
- Suspending your workstation suspends the stream.

#### ⚙️ Technical Internals & Architecture
`TransferPipeline` (`src/main/transfer/TransferPipeline.ts`) pipes the source `createReadStream()` into the target `createWriteStream()`. `ByteMeter` calculates transfer velocity using a sliding 100ms window. `PauseController` suspends the Node.js stream flow without terminating underlying TCP sockets.

---

## 3. Conflict Resolution & Byte-Offset Resume

When a destination file already exists, sshs3 presents an interactive collision dialog:

![File Conflict Options](/img/file-options.png)

- **Overwrite**: Overwrites the existing destination file.
- **Skip**: Skips the file and advances the queue.
- **Resume**: Resumes transfer from the last written byte offset without restarting the download!
- **Rename**: Automatically saves the file with an incremental suffix (e.g., `report_copy(1).pdf`).
- **Apply to all**: Applies the chosen action to all subsequent conflicts in the batch.

### Feature: Byte-Offset Transfer Resume

#### 🎯 Purpose
Save hours of transfer time and network bandwidth when copying multi-gigabyte database dumps, virtual machine disks, or log archives over unstable connections.

#### 🛠️ How to Use
If a 10 GB file transfer was interrupted at 85%, restart the copy operation and select **Resume** in the conflict modal.

#### ⚠️ Limitations & Caveats
- Resume is supported across SFTP and local disk. On S3, resume is supported for multi-part uploads where chunks have finalized.

#### ⚙️ Technical Internals & Architecture
When Resume is selected, the engine queries the destination file size via `stat()`. It then opens the source stream with `createReadStream(remotePath, existingSize)` and opens the destination stream in append mode (`flags: 'a'`).

---

## 4. Directory Diff & Synchronization Engine

![File Settings](/img/docs/settings-files.png)

### Feature: Bidirectional Directory Synchronization

#### 🎯 Purpose
Compare directory trees across servers and synchronize changes with comprehensive diff previewing before execution.

#### 🛠️ How to Use
1. Click the Sync icon in the file manager toolbar.
2. Select comparison criteria: **File Size** and **Modification Time (mtime)**.
3. Click **Compare**. Review the color-coded diff list:
   - 🟢 Green: New file on source.
   - 🟡 Yellow: Modified file (size or timestamp mismatch).
   - 🔴 Red: File exists only on destination.
4. Select sync direction (Left to Right, Right to Left, or Bidirectional) and click **Apply Sync**.
5. Save the configuration as a **Sync Profile** for repeated execution.

#### ⚠️ Limitations & Caveats
- S3 and certain object storage backends lack microsecond `mtime` resolution. sshs3 employs a configurable time tolerance window (default 2 seconds) to avoid false positives.

#### ⚙️ Technical Internals & Architecture
`DirectorySyncService` (`src/main/dirsync/DirectorySyncService.ts`) traverses directory hierarchies in memory, categorizes files, and enqueues sync tasks through `TransferQueue`.

---

## 5. Built-in Editor, Live Log Tail & External Editor

### Feature: In-App Editing, Live Markdown & `tail -f`

#### 🎯 Purpose
Inspect and modify remote files or monitor server logs without launching an external editor or switching to a terminal window.

#### 🛠️ How to Use
- **Built-in Editor**: Double-click or press <kbd>Enter</kbd> on a text file to open it in the built-in viewer. Press <kbd>Ctrl+S</kbd> to save directly back to the remote server. For documentation files, toggle the **Source / Preview** switch for an instant live-rendered Markdown preview.
- **Live Log Tail**: Right-click a growing log file (e.g. `access.log`, `app.log`) and select **Follow Log (tail -f)**. The viewer streams new lines in real time, featuring pause, resume, and text search (<kbd>Ctrl+F</kbd>).
- **External Editor**: Right-click any file and select **Edit in External Editor**. The file opens in your local desktop IDE (VS Code, Neovim, Sublime). Press <kbd>Ctrl+S</kbd> locally, and sshs3 automatically detects the file write and streams updates back to the server in the background!

#### ⚠️ Limitations & Caveats
- The built-in editor is optimized for lightweight text/markdown editing without heavy syntax trees. For complex multi-file projects, use External Editor hand-off.
- External editors must save files in place without breaking filesystem inode watches.

#### ⚙️ Technical Internals & Architecture
`FileEditorService` downloads target files into an isolated temporary directory with `0700` permissions, launches the local application via Electron `shell.openPath()`, and registers an `fs.watch` event listener. When change events fire, modified buffers stream back across `TransferPipeline`.

---

## 6. Git Integration in the File Manager

### Feature: Visual Git Status & SFTP Repository Management

#### 🎯 Purpose
Inspect Git repository status, pull updates, or clone repositories directly within remote SFTP folders without opening a separate terminal session.

#### 🛠️ How to Use
1. When browsing a folder containing a `.git` directory (locally or over SFTP), sshs3 automatically detects the repository:
   - **Branch & Status Indicator**: Displays active branch, uncommitted/untracked changes, and commit delta ahead (↑) or behind (↓) `origin`.
   - **Git Pull**: Click the pull icon to synchronize the remote repository with upstream in a single click.
   - **Open in GitHub/GitLab**: Opens the repository homepage in your default browser when `remote.origin.url` is configured.
   - **Clone Git repository here...**: Right-click any folder to clone a repository with optional shallow-clone depth (`--depth=1`).
2. Git polling can be toggled on or off under *Settings → Git & GitHub* to eliminate background network checks on constrained servers.

#### ⚠️ Limitations & Caveats
- Remote Git operations over SFTP require `git` to be installed on the remote server.

#### ⚙️ Technical Internals & Architecture
Driven by `GitStatusService` (`src/main/git/GitStatusService.ts`) and `RemoteGitService` (`src/main/git/RemoteGitService.ts`). Remote status inspections run non-blocking `git status --porcelain=v2` commands over the ControlMaster channel.

---

## 7. Troubleshooting & Diagnostics Runbook

| Symptom / Error Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| `Permission denied` on file upload | Remote directory lacks write permissions for user | Verify directory permissions via `ls -ld <folder>`. Run `chmod 755` or elevate via sudo in a terminal. |
| `SFTP subsystem not found` | Remote server's `sshd_config` lacks SFTP subsystem | Ensure `Subsystem sftp /usr/lib/openssh/sftp-server` is configured in `/etc/ssh/sshd_config`. |
| External editor edits do not upload | Editor saves via atomic temporary files | Configure your editor to write in place (e.g. in Vim: `:set backupcopy=yes`). |
| Transfer hangs at 99% | Remote partition exhausted available disk space | Run `df -h` on the remote server to ensure free space is available. |
