## Terminal & Workspace Ergonomics

The terminal engine in **sshs3** pairs hardware-accelerated web rendering via **xterm.js** with your operating system's native OpenSSH client process via **`node-pty`**. Unlike clients relying on JavaScript SSH emulators, all native OpenSSH options, configuration files, smartcards, and command-line habits function identically to your standard terminal.

![Split Terminal Workspace](/img/split-terminal.png)

---

## 1. Native OpenSSH Engine via `node-pty`

### Feature: Real OpenSSH Binary Execution

#### 🎯 Purpose
Deliver 100% fidelity with the system OpenSSH stack (`~/.ssh/config`, `ProxyCommand`, `Match` directives, token agents, FIDO2, Kerberos/GSSAPI) without the regressions common to JavaScript reimplementations.

#### 🛠️ How to Use
- Launch any SSH profile or press <kbd>Ctrl+Shift+T</kbd> to open a new terminal session.
- Features ANSI/VT100/VT220 emulation, 24-bit TrueColor, and mouse tracking (in `htop`, `mc`, `tmux`, `nvim`).
- Adjust font size on the fly per tab using <kbd>Ctrl++</kbd>, <kbd>Ctrl+-</kbd>, and <kbd>Ctrl+0</kbd> (reset).

#### ⚠️ Limitations & Caveats
- Requires an OpenSSH client binary (`ssh`) accessible in system `$PATH`.
- On Windows, the optional OpenSSH Client feature must be active (enabled by default in Windows 10/11).

#### ⚙️ Technical Internals & Architecture
`SSHPtyManager` (`src/main/ssh/SSHPtyManager.ts`) allocates a pseudo-terminal (PTY) via native C++ bindings provided by `node-pty`. It invokes `ssh <arguments> <host>` in an isolated session. Data streams pass through Electron IPC (`IPC_CHANNELS.TERMINAL_DATA`, `IPC_CHANNELS.TERMINAL_WRITE`, `IPC_CHANNELS.TERMINAL_RESIZE`).

---

## 2. Konsole-Style Recursive Split Panes

sshs3 implements non-destructive recursive pane splitting modeled on KDE's **Konsole** (`ViewSplitter`):

![Recursive Split Panes](/img/split.png)

### Feature: Non-Destructive Split Layouts

#### 🎯 Purpose
Allow operators to split workspace real estate horizontally and vertically without disrupting existing sessions, interrupting running background commands, or losing scrollback buffers.

#### 🛠️ How to Use
1. **Split Vertically**: Press <kbd>Ctrl+Shift+D</kbd> or click the vertical split icon on the pane's mini-toolbar.
2. **Split Horizontally**: Press <kbd>Ctrl+Shift+E</kbd> or click the horizontal split icon.
3. **Keyboard Navigation Between Panes**:
   - **Directional Spatial Navigation (<kbd>Ctrl+Shift+Arrow Keys</kbd>)**: Shifts focus in the direction of the arrow. Pressing <kbd>Ctrl+Shift+Up</kbd> from the top row moves focus directly into the **Tab Bar** (where <kbd>Left</kbd>/<kbd>Right</kbd> switches active tabs, and <kbd>Down</kbd> or <kbd>Enter</kbd> returns focus into the active terminal pane).
   - **Sequential Cycling**: Use <kbd>Ctrl+Shift+N</kbd> (next pane in tree) and <kbd>Ctrl+Shift+P</kbd> (previous pane).
4. **Close a Pane**: Press <kbd>Ctrl+Alt+Shift+W</kbd>, click the close button on its mini-toolbar, or type `exit`. The tree automatically collapses to fill the remaining area.
5. **Zoom a Pane**: Press <kbd>Ctrl+Shift+Z</kbd> (or the zoom icon on the pane's mini-toolbar) to show only the focused pane full-size while the others keep running hidden; press it again to restore the layout. Splitting or closing the zoomed pane also restores it.
6. **Close Other Panes**: Click **Close others** in the *Split view* bar to keep only the focused pane. If the panes being closed hold sessions, sshs3 asks for confirmation first, because their sessions end. To just focus on one pane without closing anything, use **Zoom** (step 5). New splits are made with <kbd>Ctrl+Shift+D</kbd> / <kbd>Ctrl+Shift+E</kbd> or the split icons on each pane's mini-toolbar.
7. **Resizable Splits**: Drag the divider line between any two split panes to resize them horizontally or vertically. Double-click the divider to reset to equal sizing.

#### ⚠️ Limitations & Caveats
- Splitting a terminal too many times on smaller displays can reduce column width below 40 characters, causing line wrapping in wide tabular tools.
- Each pane runs an independent SSH or shell process with its own memory allocation.

#### ⚙️ Technical Internals & Architecture
Splitting a pane does not recreate or restart the underlying PTY session. The active DOM node is reparented into a new split container within React's layout tree (`PaneTree.tsx`), leaving the underlying Node.js PTY process completely uninterrupted.

### Feature: Multiple Windows (for several monitors)

#### 🛠️ How to Use
- Press <kbd>Ctrl+Alt+Shift+N</kbd> (**New Window**) to open another sshs3 window. It opens on the monitor the mouse pointer is on, with its own set of tabs.
- **Move a tab to another window:** drag the tab out of the window, right-click it (or press the <kbd>Menu</kbd> key / <kbd>Shift+F10</kbd> on a focused tab) and choose **Move to New Window** or **Move to Window N**, or press <kbd>Ctrl+Alt+Shift+M</kbd> to move the active tab to a new window.
- A terminal keeps running while it moves: it is the same shell or SSH connection, and what it had printed is redrawn in the new window (the most recent ~1 MB of output).
- Position and size of every window, and the tabs in each, are restored on the next start. A window whose monitor is no longer connected reopens on the primary monitor.
- Closing a secondary window ends its sessions (you are asked first when it has open sessions). Closing the **main** window quits the app and closes all windows.

#### ⚠️ Limitations & Caveats
- A tab with unsaved changes (an editor tab) cannot be moved until it is saved.
- File manager tabs keep both panes (host, folder, split) and their connections when they move. Kubernetes log views start following again and editor tabs reload the file; terminals carry their running session along.
- A moved SSH tab does not carry credentials that were typed for an unsaved connection; reconnecting such a tab asks again.
- On Wayland the window position cannot be read or set by applications, so windows open where the desktop places them.

---

## 3. Local Shells & Intelligent SSH Agent Management

In addition to remote SSH hosts, sshs3 allows opening local terminal tabs executing directly on your workstation (`bash`, `zsh`, `fish`, `pwsh`, WSL).

### Feature: Managed `SSH_AUTH_SOCK` Injection & `AgentLifecycleManager`

#### 🎯 Purpose
Provide integrated access to local workstation shells with immediate single sign-on access to smartcards, YubiKeys, and SSH keys already unlocked within sshs3.

#### 🛠️ How to Use
Configure the **Local Terminal SSH Agent** behavior under *Settings → Terminal*:
- **Auto (Default)**: If Global PIN caching is active, local shells automatically inherit the app-wide `AppAgent` socket. Unlocked smartcards and FIDO2 keys are instantly available for local `git`, `ssh`, and `terraform` commands! If Global caching is not active, it uses the system/login-shell agent, or starts an app-managed private agent.
- **System Only**: Strictly inherits your existing desktop `$SSH_AUTH_SOCK` (e.g. gpg-agent or systemd-user ssh-agent) and never starts an app agent.
- **Disabled**: Wipes `SSH_AUTH_SOCK` and `SSH_AGENT_PID` completely from the spawned shell environment.

Open a local shell with **New Terminal** (<kbd>Ctrl+Shift+T</kbd>) and the local option, or **Open Local Terminal** in an empty pane. The setting is **Local Terminal SSH Agent** under *Settings → Terminal*.

#### ⚠️ Limitations & Caveats
- `SSH_AUTH_SOCK` is resolved and injected at the moment the local process is spawned. Under Global PIN caching the app-wide agent socket is stable, so a shell opened before a card is unlocked picks the card up once it is unlocked; with any other agent mode, a tab opened before unlocking does not.

#### ⚙️ Technical Internals & Architecture
`AgentLifecycleManager` (`src/main/ssh/AgentLifecycleManager.ts`) probes for a running agent (or the Windows OpenSSH Authentication Agent service) and spawns one only if none exists. In `auto` mode the resolution order is: (1) under Global PIN caching, the app-wide `AppAgent` (a real `ssh-agent` on a stable, permission-checked socket, `$XDG_RUNTIME_DIR/sshs3/agent.sock`, or `<tmpdir>/sshs3-<uid>/agent.sock` without `XDG_RUNTIME_DIR`), even while it is still empty; (2) the app's own running agent; (3) the inherited system or login-shell agent; (4) a newly spawned managed agent.
---

## 4. Terminal Productivity & Ergonomics

![Terminal Settings](/img/docs/settings-terminal.png)
![Terminal Settings Details](/img/docs/settings-terminal2.png)

### 4.1 Scrollback Buffer Search (<kbd>Ctrl+Shift+S</kbd>)
- Opens an overlay search bar with match count indicator (e.g. `3/6`). Matches update dynamically as you type.
- Step through occurrences forward with <kbd>Enter</kbd> and backward with <kbd>Shift+Enter</kbd>. Close the bar with <kbd>Esc</kbd>.
- Highlight colors adapt to the active theme (Breeze, Light, Dark). The active match is highlighted distinctly.
- Stepping through matches highlights text without triggering Copy-on-Select.

### 4.2 Clickable URLs and File Paths (<kbd>Ctrl+Click</kbd>)
Hold <kbd>Ctrl</kbd> (<kbd>Cmd</kbd> on macOS) and click:
- **Web URLs**: Any `http://` or `https://` link opens in your workstation's default browser (supported in terminals and Kubernetes log streams).
- **Remote & Local File Paths**: Clicking a file or directory path in an SSH or local terminal (e.g. `/var/log/syslog`, `~/notes.md`, `src/index.ts`, `./build.sh:42:7`) **immediately opens that folder in a file manager tab**!
  - **Real-Time CWD Tracking**: Terminal sessions actively track the shell's current working directory (via Linux `/proc/<pid>/cwd`, OSC 7 directory sequences, and prompt heuristics), allowing **relative paths** (like `config/app.json` or `../backend`) to resolve accurately against the active directory.
  - Paths enclosed in single or double quotes, and paths containing spaces (e.g. `'my documents/report.pdf'`), are automatically detected.
  - Because terminal emulators cannot distinguish directories from files without filesystem access, clicking a file path without a trailing slash opens its containing parent directory in the file manager.
  - Tilde paths (`~/`) resolve automatically to the remote user's home directory (`/home/<user>` or `/root`).
  - The SFTP tab always connects using the pane's underlying profile credentials, even if you hopped to another host using `ssh` inside the terminal.

### 4.3 Smart Path Detection & Interactive Hover Cards
Hovering your mouse over any recognized file or directory path in the terminal displays an interactive **Path Hover Card**:

- **Category Badge & Icon**: Instantly classifies the file by type: **Code**, **Config**, **Image**, **Markdown**, **Document**, **Archive**, or **Directory**.
- **Basename & Full Path**: Displays the clean file name alongside its fully resolved absolute filesystem path.
- **Live Quick Peek**: Asynchronously loads a preview snippet over the active connection without leaving the terminal:
  - **Code & Text**: Displays the first three lines of the file, total line count, and file size.
  - **Images**: Renders a live thumbnail image directly in the hover card for supported raster formats (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.svg`).
- **Quick Action Buttons**:
  - **Copy Path**: Copies the fully resolved absolute path to your system clipboard.
  - **Reveal in File Manager**: Navigates the dual-pane file manager to the file's parent folder and highlights the file.
  - **Edit File**: Opens the file directly in the built-in [CodeMirror 6 Editor](file-manager.md#5-built-in-editor-rich-previews--external-editor) without switching tabs.
  - **Drag handle**: Drag the grip icon, the file icon or the preview out of the card to drop the file or folder into another application, e.g. your desktop or a mail window. For SSH and Kubernetes terminals, clicking or dragging the handle (or the icon or preview) opens a dialog that asks whether to copy the item to this computer; after you confirm it downloads a temporary copy and shows an item to drag. Files over 500 MB are not draggable; copies are deleted when sshs3 quits.
- **Dwell Protection & Collision Avoidance**: A subtle dwell timer prevents accidental popup flicker while moving the cursor across the terminal, and intelligent viewport edge detection flips the card smoothly to keep it within the visible window.
- **Configuration Toggle**: Can be enabled or disabled anytime under *Settings → Terminal* (**Enable file path hover preview**). When disabled, <kbd>Ctrl+Click</kbd> path activation remains fully operational.
- **Only real files get a card**: before the card opens, the path is looked up over the active connection. Text that merely looks like a path (`Node.js`, `example.com`, `and/or`, a filename an assistant only proposes) gets no card when the file does not exist. A relative path is only checked when the working directory is reliable: reported by the shell through OSC 7, or read from a local shell's process. In an SSH terminal without OSC 7 the directory can only be guessed from prompt-like text, so a relative path is shown as before instead of being judged against a possibly wrong directory. A check that takes longer than about half a second is also ignored, so a slow connection never holds the card back. In a short window the card never grows past the room on its side of the pointer (its content scrolls instead), so it does not slide over the pointer. Hostnames, e-mail addresses, version numbers (`1.2.3-rc1`), units (`3.5MB/s`, `2.5s`), abbreviations (`e.g`) and capitalized words such as `Version` or `Notes` are not linked at all.
- **Not offered while a local shell runs `ssh`** (Linux): text on screen then belongs to the remote host, but the card would look files up and preview them on this machine, which gives wrong or missing previews. Use an SSH profile terminal for remote previews. The card also keeps its side of the pointer when the preview loads, instead of jumping from below to above it.
- **Show the card only with Ctrl**: under *Settings → Terminal* (**Show the card**) you can choose *Only while Ctrl is held* (<kbd>Cmd</kbd> on macOS) instead of *When hovering over a path*. The card then opens when you press Ctrl while the pointer is on a path, which keeps it out of the way in text-heavy sessions such as an AI assistant.

On Linux and macOS the hover card reads files through the terminal's own SSH connection, so a security key (FIDO2) is touched once per terminal, not again for the preview. Windows opens a second connection, which asks for the key again.

### 4.4 Saved Command Snippets Palette (<kbd>Ctrl+Shift+L</kbd>)
- Searchable palette of pre-saved shell commands and runbooks.
- <kbd>Enter</kbd> types the command into the prompt; <kbd>Ctrl+Enter</kbd> types and executes it immediately. Multi-line snippets are pasted as an atomic batch.
- Manage snippets with **New**, pencil (edit), and bin (delete). Snippets can be scoped to the current profile or made globally accessible.
- Dynamic variables: `{{host}}`, `{{user}}`, and `{{date}}` (formatted as `yyyy-mm-dd HH:mm`).
- *Security Note:* Snippets are saved unencrypted in `snippets.json`. Do not store passwords or API secrets in snippets!

### 4.5 Clean Output Copy (<kbd>Ctrl+Shift+Y</kbd>)
- Copies the clean output of the immediately preceding command directly to the clipboard without manual mouse highlighting.
- **Prompt Stripping**: Automatically strips shell prompt prefixes (e.g. `user@host:~$`, `[user@host /dir]#`, Starship / Powerlevel10k prompt headers/footers with `in <path>`, box-drawing lines like `╭─` and `╰─$`, and git branch decorators).
- **ANSI & Trailing Prompts**: Strips ANSI escape color codes and trailing prompt lines, leaving only the pure command output.
- **Exact (OSC 133)**: In modern shells emitting **OSC 133 semantic prompt marks** (`fish`, and `zsh`/`bash` with shell integration), boundaries are 100% exact.
- **Heuristic Fallback**: In standard shells without OSC 133, accurately tracks command boundaries via Enter keypress markers while ignoring full-screen interactive programs (`vim`, `less`, `htop`).
- A toast notification confirms the exact number of copied lines, and the output is recorded in the encrypted clipboard history ring when copy-on-select is active.

### 4.6 Encrypted Clipboard History (<kbd>Ctrl+Shift+R</kbd>)
- When *Copy text automatically on selection* is enabled, every highlighted string is stored in an encrypted history ring.
- Press <kbd>Ctrl+Shift+R</kbd> or right-click to search and paste previous selections (<kbd>↑</kbd>/<kbd>↓</kbd> navigate, <kbd>Enter</kbd> pastes).
- <kbd>Ctrl+Shift+V</kbd>, <kbd>Shift+Insert</kbd> and middle-click paste from the clipboard.
- Encrypted at rest via the OS keyring (`safeStorage`). If the OS keyring is unavailable, history is retained in volatile memory only. Can be scoped per connection or configured to purge on application exit.

### 4.7 Smart Drag-and-Drop: Drop-to-Upload & Paste Path
Dragging files or folders directly into a terminal pane provides seamless context-aware integration:
- **SSH Terminals**: Dropping a file onto a remote SSH terminal activates an animated frosted drop overlay indicating the remote working directory. The file is uploaded to the remote directory via SFTP in the background, and its properly shell-quoted remote path (e.g. `'/var/www/site/dump.sql'`) is automatically typed into the prompt upon completion.
- **Local Terminals**: Dropping a file into a local shell immediately quotes and pastes the workstation path (`'/home/user/Downloads/archive.tar.gz'`) into the prompt. On Windows, paths are pasted in double quotes (PowerShell and cmd); a path containing `$`, a backtick or `%` is pasted in single quotes instead, so it is never expanded. A name that cannot be quoted safely for both PowerShell and cmd (for example `$` together with `&`) is skipped with a notice. In a WSL terminal, dropped Windows files are pasted as `/mnt/<drive>/...` paths, and hovering a WSL path opens the Windows-side file.

### 4.8 Web Service & Port Forward Auto-Detection
The terminal engine actively monitors output streams for web servers, dev tools, and listening services:
- **Built-in Framework Support**: Automatically recognizes output from **Vite**, **Next.js**, **Django**, **Flask**, **Express**, **Spring Boot / Tomcat**, **Python `http.server`**, **Go (Gin/Fiber)**, and standard `http://localhost:<port>` / `http://127.0.0.1:<port>` URLs.
- **Interactive Action Banner**: Displays a floating pill when a service is detected:
  - **SSH Sessions**: Clicking **Forward & Open** (or **Retry** after a failure) automatically starts a background SSH local tunnel (`window.multissh.sshTunnelStart`) on a free local port and immediately opens the forwarded URL in your workstation's default browser.
  - **Local Sessions**: Clicking **Open in Browser** opens `http://localhost:<port>` directly.
  - **Kubernetes Sessions**: Port detection is not offered, because there is no port-forward path for pods here.
  - **Dismiss**: Silences the port for the active session.
- **Custom Regex Support**: Under *Settings → Terminal*, operators can provide custom regular expressions to match proprietary server logs or unique port announcements. The feature can also be toggled completely off.

### 4.9 Re-run with sudo (<kbd>Ctrl+Shift+X</kbd>)
<kbd>Ctrl+Shift+X</kbd> offers the same re-run for the last command at any time, not only after a permission error. Terminal shortcuts use <kbd>Ctrl+Shift</kbd> rather than bare <kbd>Ctrl</kbd> or <kbd>Alt</kbd> so they never take keys from the shell or a full-screen program (readline, vim, nano, fzf, tmux).

When a command fails with a permission error (for example `cat: /etc/shadow: Permission denied`, `Operation not permitted`, or `Are you root?`), a prompt appears at the bottom of the terminal showing the whole command that would run (wrapped over several lines when it is long, never truncated):
- <kbd>Enter</kbd> types `sudo <your command>` onto the prompt but does not run it: you see the whole command on the real line, can edit it, and press <kbd>Enter</kbd> again to run it (or clear the line to cancel). `sudo` asks for the password in the shell as usual; sshs3 never sees it. The first Enter is ignored for a moment after the bar appears, so a quick double press does not accept it.
- <kbd>Esc</kbd>, or typing anything else, dismisses the bar.
- **Not offered** for `ssh`, `scp`, `sftp`, `rsync`, `git`; commands that already start with `sudo`/`su`/`doas` or with a `NAME=value` assignment (`sudo` refuses most of those), also when wrapped in `time`, `nohup` or `env`; shell builtins such as `cd`, `source` and `export` (`sudo` cannot run them); package tools like `npm`, `pip` and `cargo` (running them as root leaves root-owned files in your home directory); lines with `;`, `&&` or `||` (`sudo` would only cover the first part); commands that redirect to or from a file with `>` or `<` (the shell opens the file before `sudo` runs; `2>&1` and `2>/dev/null` are fine); long output; errors that are not near the end of the output; or when you are already root (a `#` or `root@host` prompt, or an SSH profile with user `root`). A command that contains a line break, control characters or invisible characters is never offered either, because the command is read back from the terminal screen, which a remote program can influence. Aliases are not expanded by `sudo`. In PowerShell and cmd the prompt is never shown.
- The offer is built from the command you just ran and that command's own output. It only appears after a command typed at a prompt (not after an answer to `[Y/n]` or a keypress in `vim`), and it disappears if the screen changes so that the shown command no longer matches.
- It works in any shell, with or without OSC 133 prompt marks. The setting is under *Settings → Terminal* (**Offer to re-run failed commands with sudo**).

### 4.10 Terminal Settings Reference Table

| Setting | Default | Purpose & Description |
| :--- | :--- | :--- |
| **Terminal Font Size** | `13` | Base font size. Adjust dynamically with <kbd>Ctrl++</kbd>, <kbd>Ctrl+-</kbd>, <kbd>Ctrl+0</kbd>. |
| **Terminal Font Family** | Monospace stack | Select from curated monospaced fonts or enter a custom font name. |
| **Cursor Style** | `Block` | Visual cursor appearance: `Block`, `Underline`, or `Bar`. |
| **Scrollback Buffer (lines)** | `5000` | Retained terminal history per pane, searchable with <kbd>Ctrl+Shift+S</kbd>. |
| **Enable file path hover preview** | `On` | Interactive preview card with file details, thumbnail, and actions when hovering over paths. |
| **Show the card** | `When hovering over a path` | Open the path hover card on hover, or only while <kbd>Ctrl</kbd> is held. |
| **Offer to re-run failed commands with sudo** | `On` | After a permission error, offers to re-run the command with `sudo` (<kbd>Enter</kbd> to accept, <kbd>Esc</kbd> to dismiss). |
| **Enable web service & port forward auto-detection** | `On` | Detects listening ports in terminal output and displays a quick-forward banner. |
| **Custom port detection regex** | `Empty` | Optional regular expression with capture group `(\d+)` to detect custom application ports. |
| **Copy text automatically on selection** | `Off` | Copies highlighted text to the clipboard and records it in encrypted clipboard history. |
| **Clipboard history scope** | `Global` | Share clipboard history across all sessions or isolate history per host. |
| **Empty clipboard history on exit** | `Off` | Automatically wipes the encrypted clipboard history when sshs3 shuts down. |
| **On Logout / Session End** | `Reconnect` | Action when an SSH session disconnects: **Reconnect**, **Close Tab**, or **Keep Open**. |
| **Local Terminal SSH Agent** | `Auto` | How `SSH_AUTH_SOCK` is populated in local shell tabs: **Auto** (uses unlocked app-wide agent `AppAgent` under Global PIN caching, otherwise system's/login-shell's agent, otherwise an app-spawned agent), **System Only** (only uses pre-existing system agent), or **Disabled** (deletes `SSH_AUTH_SOCK`). |

---

## 5. Troubleshooting & Diagnostics Runbook

| Symptom / Error Message | Probable Root Cause | Corrective Action |
| :--- | :--- | :--- |
| Terminal displays blank black screen | System exhausted available PTY descriptors | Check PTY availability via `cat /proc/sys/kernel/pty/nr`. Close unneeded sessions. |
| Swedish / non-ASCII characters display garbled | Mismatched locale or encoding on remote host | Run `echo $LANG` on the server. Ensure a UTF-8 locale is exported (e.g., `export LANG=en_US.UTF-8`). |
| <kbd>Ctrl+Click</kbd> on path does nothing | Path does not exist or remote CWD could not be determined | Verify that the file exists and that the shell exports its directory (or use standard prompt formats). Absolute paths (`/...`) and home paths (`~/...`) always resolve directly. |
| Clipboard history is empty | "Copy text automatically on selection" is disabled | Open *Settings → Terminal* and check **Copy text automatically on selection**. |
