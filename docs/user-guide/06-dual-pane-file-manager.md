# Dual-Pane File Manager (Complete Reference)

The file manager in **sshs3** offers an integrated dual-pane explorer for transferring and managing files seamlessly between the local disk, remote SFTP servers, Amazon S3-compatible cloud buckets and Kubernetes containers.

![Dual-Pane File Manager](/img/filemanager.png)

---

## 1. Architecture & SFTP v3 Engine

### 1.1 SFTP over the System's OpenSSH Binary
sshs3 uses a purpose-built SFTP v3 protocol engine that runs directly over your operating system's `ssh` binary (`ssh -s sftp`):
- **Reuses all OpenSSH configuration**: Your SSH keys, passphrases, `~/.ssh/config` settings, ProxyJump bastions and smartcard agents are used automatically without separate configuration.
- **Performance & safety**: The engine has a built-in safety limit of **16 MB packet length** to protect against memory leaks or faulty servers, and optimized concurrent byte chunking for high-speed transfers of gigabyte-class files.

---

## 2. Dual-Pane Layout & Protocol-Independent Transfers

The file manager has two independent panes (Left and Right). Each pane can be freely connected to any protocol:
- **Local machine**: Your local workstation's file system.
- **SFTP server**: Remote hosts over SSH.
- **S3 Object Storage**: AWS S3, Cloudflare R2, MinIO, Wasabi and others.
- **Kubernetes Pod**: The container's file system in real time.

### 2.1 Transfer Paths
- **Local ↔ SFTP**
- **SFTP ↔ SFTP** (direct transfer between two different remote servers)
- **Local ↔ S3**
- **SFTP ↔ S3** (upload directly from a Linux server to an S3 bucket without first landing on your local computer)
- **Local / SFTP / S3 ↔ Kubernetes Pod**

---

## 3. Features & Detailed Usage

### 3.1 Drag and Drop & Transfer Queue
- **Drag and drop**: Select one or more files and drag them from one pane to the other.
- **The transfer queue**: Shown in a collapsible strip at the bottom of the window:
  - Shows the current transfer speed (KB/s or MB/s), elapsed time and estimated time remaining (ETA).
  - Supports pausing, resuming and canceling individual jobs or the whole queue.
  - Concurrent jobs are configured in the settings (default: 3 parallel streams).

### 3.2 Conflict Handling for File Collisions
When a file with the same name already exists in the target directory, the conflict window opens:
- **Overwrite**: Overwrites the existing file.
- **Skip**: Skips the file and continues with the next one in the queue.
- **Resume**: Resumes an interrupted transfer by continuing to write from the last known byte (supported on SFTP and local disk).
- **Rename**: Saves the file with an automatic suffix (for example `report_copy(1).pdf`).
- **Apply to all**: Applies the same choice to all following file conflicts in the current transfer batch.

---

### 3.3 Keyboard Navigation
<kbd>Ctrl+Shift+←</kbd>/<kbd>→</kbd> switches between the left and right pane, <kbd>↑</kbd> goes to the tab bar and <kbd>↓</kbd> goes back to the active pane's file list. In the list, <kbd>↑</kbd>/<kbd>↓</kbd> moves the selection, <kbd>Enter</kbd> opens the folder or file (focus stays in the list) and <kbd>Escape</kbd> clears the selection.

### 3.4 Recursive File Search & Wildcards (<kbd>Ctrl+F</kbd>)
Press <kbd>Ctrl+F</kbd> in any pane to open the search bar:

- **Local folder filtering**: Immediately filters the files in the current folder.
- **The "Recursive" checkbox**:
  Traverses subfolders down the file tree:
  - Limited to at most **1,000 matches across 3,000 folders** to protect memory and avoid API blocking.
  - The result list shows the files' relative path and lets you open, copy or transfer them like regular files.
  - **Loop protection**: Symbolic links (symlinks) to folders are ignored automatically during recursion to prevent infinite loops.
  - Hidden folders are skipped unless "Show Hidden Files" is on.
- **Wildcards (`*` and `?`)**:
  - `*.log`: Matches all files ending in `.log`.
  - `config-?.json`: Matches single variable characters.
  - Text without wildcards is interpreted as a case-insensitive substring search.

---

### 3.5 Built-in Text Editor
Double-click or right-click any text file, script or YAML manifest and select **Edit**:
- A simple text editor without syntax highlighting. If you want your own editor, there is a hand-off to an external editor.
- **Save directly to the remote server**: Press <kbd>Ctrl+S</kbd> to write the changes directly back to the SFTP server, the S3 object or the container.
- Built-in **Markdown Live Preview** with the **Source | Preview** toggle.
- **Live Log Tail**: follow a growing log file (`tail -f`) in the same view, with pause, resume and search.

---

### 3.6 Directory Sync (Directory Comparison & Synchronization)
Click **Sync Directories** in the toolbar to compare two directories:
- **Visual color-coded diff**:
  - Green: New files that are missing on the target.
  - Blue: Modified files (detected through size difference and a newer timestamp).
  - Red: Files that exist only on the target.
- **Synchronization modes**:
  - *One-Way (Mirror)*: The target is made an exact copy of the source.
  - *Update Existing Only*: Only files that already exist on the target are updated.
  - *Two-Way*: New and changed files are copied in both directions.
- **Save profiles**: Save recurring synchronization jobs for backup or deployment.

---

### 3.7 Permissions & Chmod
Right-click any file or folder and select **Permissions**:
- A visual matrix for **Read**, **Write** and **Execute** for User, Group and Others.
- Direct input of octal permission values (for example `0755`, `0644`, `0700`).
- **Recursive Chmod**: Apply the permissions recursively to all subfolders and files with one click.

---

### 3.8 Git Integration & Remote Management (SFTP & Local)
The file manager automatically detects whether an opened folder is a Git repository (both locally and on remote servers over SFTP via SSH):
- **Branch & status indicator in the toolbar**:
  - Shows the current branch (for example `main`).
  - Shows whether there are uncommitted changes (`*`, and the number of modified/untracked files in the detail view).
  - Shows the number of commits ahead (`↑ ahead`) of or behind (`↓ behind`) the remote repository (`origin`).
- **Git menu & shortcuts**:
  - **Git Pull**: Update the repository directly with one click without having to open a terminal.
  - **Open in GitHub/GitLab**: Opens the repository's web page directly in the default web browser if a remote repository (`remote.origin.url`) is configured.
  - **Clone Git repository here...**: Clone a new git repository into the current folder.
- **Context menu actions**:
  - Right-click a subfolder to select **Git Clone inside...**.
  - Right-click an empty area to select **Git Clone to here...**, **Git Pull** or **Open in GitHub/GitLab**.
- **Turning it on / off**:
  - The Git integration can be turned on and off under **Settings > Git & GitHub** (*SFTP & File Manager Git Integration*). When it is turned off, there is no git polling in the background and the toolbar and context menu are kept completely free of git elements.
