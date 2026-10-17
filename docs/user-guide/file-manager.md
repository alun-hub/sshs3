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
4. Manage permissions via right-click → **Change Permissions (chmod)...** with octal (e.g. `0755`, `0644`) and symbolic checkboxes. Tick **Apply recursively to underlying files and folders** to apply the mode to everything inside a selected folder.

### Drives, Volumes & Free Space

The disk icon at the right of the pane toolbar shows how much space is free where you are (the equivalent of `df <path>`) as a fill bar plus a "NN GB free" label.
- **Local panes:** click it to list every drive (Windows: `C:`, `D:`, ...) or mounted filesystem (Linux/macOS) with its fill level, and pick one to jump to its root. Offline network drives are skipped rather than freezing the list. **Up one level** from a drive root stays on that drive.
- **SFTP panes:** shows the free space of the filesystem holding the current folder. It needs a server with the `statvfs@openssh.com` extension (OpenSSH servers have it); otherwise the indicator is hidden. A remote list of all mounts is in the [Performance Bar](performance-bar.md).

### Search in Files (<kbd>Ctrl+Shift+K</kbd>)

Opens **Search in Files** for the active pane's source: local disk, SFTP or S3.
- Choose **Literal** or **Regex**, and tick **Case sensitive** if needed.
- Narrow the search with **Include:** and **Exclude:** globs (for example `*.log, *.csv` and `*.min.js`).
- Matches stream in as they are found; select one to preview the surrounding lines, and use **Jump to file in pane** to open its location.
- The search stops at 500 matches (**Result limit reached — narrow your search to see more.**). On local disk, files larger than 50 MB are skipped, and on S3 objects larger than 10 MB; unreadable entries (sockets, system-protected files) are reported as warnings.

### Resizable Panes & Split Divider
The dual-pane explorer features a draggable vertical divider between the left and right file panes.
- Click and drag the divider line to adjust the ratio between panes.
- Double-click the divider to immediately reset to an equal 50/50 split.

### Breadcrumb Toolbar & Editable Path (<kbd>Ctrl+L</kbd> / <kbd>Alt+D</kbd>)
The navigation breadcrumb has a dedicated toolbar row with clickable path segments.
- Press <kbd>Ctrl+L</kbd> or <kbd>Alt+D</kbd> (or click an empty area of the breadcrumb row) to toggle into **Text Edit Mode**.
- Type or paste a path directly, then press <kbd>Enter</kbd> to navigate or <kbd>Escape</kbd> to return to breadcrumb buttons.

### Pane Status Bar
A persistent status bar at the bottom of each pane displays:
- Total items in the folder (e.g. `42 items`).
- Active filter counts when filtering with <kbd>Ctrl+F</kbd> (e.g. `5 of 42 items`).
- Current selection count and total size of selected files (e.g. `3 selected (14.2 MB)`).
- Filesystem free space or volume fill indicators.

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
| <kbd>Ctrl+L</kbd> / <kbd>Alt+D</kbd> | Edit Path | Edits the current breadcrumb path directly as text. |
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
- `SftpPacketProtocol` processes binary SFTP v3 packets (`SSH_FXP_INIT`, `SSH_FXP_OPEN`, `SSH_FXP_READ`, etc.) and rejects any packet larger than 16 MB, protecting against faulty or hostile servers.
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

## 3. Conflict Resolution

When a destination file already exists, sshs3 presents an interactive collision dialog:

![File Conflict Options](/img/file-options.png)

- **Overwrite**: Overwrites the existing destination file.
- **Skip**: Skips the file and advances the queue.
- **Rename**: Automatically saves the file under a new name instead of replacing the existing one.

Renaming a file in place (<kbd>F2</kbd>) to a name that already exists in the same folder is refused instead of silently replacing it.
- **Apply to all remaining conflicts in this transfer**: Applies the chosen action to all subsequent conflicts in the batch.

Under **Settings → Files & Storage → Default Conflict Resolution for File Transfers** you can choose **Ask** (the default), **Overwrite**, **Skip** or **Rename** so the dialog does not appear. Transfers in the queue can be paused, resumed and cancelled.

---

## 4. Directory Diff & Synchronization Engine

![File Settings](/img/docs/settings-files.png)

### Feature: Directory Synchronization

#### 🎯 Purpose
Compare a source directory with a target directory (on the same or different servers) and synchronize the differences, with a diff preview before anything is copied.

#### 🛠️ How to Use
1. Right-click a folder and select **Sync to...**, then pick the target folder. The **Sync Directory** dialog opens with the **Source** and **Target**.
2. Review the diff:
   - **New on source**: will be copied to the target.
   - **Modified**: will overwrite the target (newer target files are flagged).
   - **Only in target**: kept by default (*safe sync*).
   - **Identical**: nothing to do.
3. Optionally tick **Enable mirror (delete extraneous files in target)** to also delete files that exist only in the target. Deletions happen only for the files you select.
4. Run the sync. Enter a **Profile name** to save the configuration as a saved sync profile; saved profiles are listed under **Saved Sync Profiles**, where **Compute diff and run sync** repeats them.

#### ⚠️ Limitations & Caveats
- The sync is one-way, from source to target.
- Symbolic links to folders are listed but not followed, and a folder that cannot be read (for example permission denied) is reported as skipped. Nothing below a skipped folder is copied or, in mirror mode, deleted, because its real contents are unknown. If the *root* folder of the source or target cannot be listed for any reason other than not existing yet, the comparison stops with an error instead of treating it as empty.
- Files are compared by size and modification time, with a fixed 2-second tolerance because SFTP and S3 backends truncate timestamps and clocks drift.

#### ⚙️ Technical Internals & Architecture
`DirectorySyncService` (`src/main/dirsync/DirectorySyncService.ts`) traverses directory hierarchies in memory, categorizes files, and enqueues sync tasks through `TransferQueue`.

---

## 5. Built-in Editor, Rich Previews & External Editor

### Feature: CodeMirror 6 Code Editor, Multi-Format Previews & `tail -f`

#### 🎯 Purpose
Inspect, edit, and preview remote files or monitor server logs with syntax highlighting and rich visual formats without launching an external application or terminal session.

#### 🛠️ How to Use
- **CodeMirror 6 In-App Code Editor**: Double-click or press <kbd>Enter</kbd> on any text or code file to open it in the built-in editor:
  - **Language Syntax Highlighting**: Automatically detects and highlights 15+ languages: JavaScript, TypeScript, Python, Shell/Bash, Dockerfile, Nginx configuration, YAML, JSON, HTML, CSS/SCSS, SQL, XML/SVG, C/C++, Java, Rust, Go, and TOML.
  - **Editor Ergonomics**: Monospaced typography with line numbers, active line highlight, matching bracket pairs, cursor coordinates (`Ln X, Col Y`), and word-wrap toggle.
  - **Search & Replace**: Press <kbd>Ctrl+F</kbd> inside the editor to open the in-editor search bar with real-time match count. Step forward with <kbd>Enter</kbd> and backward with <kbd>Shift+Enter</kbd>.
  - **Format JSON**: For JSON files, click **Format JSON** to automatically beautify and re-indent unformatted or minified payloads.
  - **Save Directly (<kbd>Ctrl+S</kbd>)**: Saves changes directly back to the remote SFTP server, S3 bucket, or K8s container with a confirmation timestamp (`yyyy-mm-dd HH:mm`). CRLF line endings are normalized to prevent false dirty states on cross-platform files.
- **Rich Multi-Format Previews**:
  - **Markdown**: Toggle the **Source / Preview** switch to view rendered GitHub-flavored Markdown with formatted code blocks, tables, and task lists.
  - **HTML**: Instant rendering in a sandboxed iframe (`sandbox="allow-same-origin"` with external network access and script executions isolated).
  - **SVG Vector Graphics**: Live rendering of SVG illustrations on an adaptive checkerboard canvas.
  - **CSV / TSV Data Table**: Automatically parses comma- and tab-separated files into an interactive, sortable tabular data grid with row numbering, column headers, and real-time text filter.
  - **Image Viewer**: Built-in viewer for raster formats (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.ico`) with interactive zoom, pan dragging, 90° rotation, pixel dimensions inspection (`W × H px`), and file size display.
  - **PDF Viewer**: Embedded PDF document preview powered by Chromium's native PDF engine.
- **Live Log Tail**: Right-click a growing log file (e.g. `access.log`, `syslog`) and select **Tail -f (Stream Log)**. The editor streams new log entries in real time with auto-scroll and search, read-only protection, and pause/resume controls without loading huge log files into memory.
- **External Editor**: Right-click any file and select **Open in External Editor**. The file opens in your local desktop IDE (VS Code, Neovim, Sublime). Press <kbd>Ctrl+S</kbd> locally, and sshs3 automatically detects the file write and streams updates back to the server in the background!

#### ⚠️ Limitations & Caveats
- Visual previews (raster images and PDFs) stream up to 100 MB directly from remote SFTP or S3.
- Text files load up to 5 MB into the editor. Files larger than 5 MB (only the first 5 MB are loaded), binary files, and non-UTF-8 files open **read-only**, and save operations are strictly blocked to prevent corrupting remote files with partial or re-encoded data. Use **Open in External Editor** to modify them.
- External editors must save files in place without breaking filesystem inode watches.

#### ⚙️ Technical Internals & Architecture
- `CodeEditor` (`src/renderer/src/components/Editor/CodeEditor.tsx`) wraps CodeMirror 6 with dynamic language extensions (`editorLanguages.ts`) and theme synchronization matching sshs3's active color scheme.
- Direct preview streaming (`SftpStreams.ts`) streams up to 100 MB for media files into memory buffers converted to Base64 data URIs.
- `FileEditorService` downloads target files into an isolated temporary directory with `0700` permissions, launches the local application via Electron `shell.openPath()`, and registers an `fs.watch` event listener. When change events fire, modified buffers stream back across `TransferPipeline`.

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
