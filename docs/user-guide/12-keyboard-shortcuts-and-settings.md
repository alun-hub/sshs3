# Settings & Keyboard Shortcuts (Complete Reference)

This chapter contains a complete walkthrough of all the settings tabs in sshs3, how they are configured, their technical limits, and a complete reference table of all keyboard shortcuts in the application.

---

## 1. Global Settings (Settings Modal)

Open the settings window through the gear icon in the top toolbar or with the shortcut <kbd>Ctrl+,</kbd>.

![Settings overview](/img/docs/settings-overview.png)

The settings are divided into seven specialized panels:

---

### 1.1 General & Appearance
- **Theme**: Choose between **Dark** (the default dark slate theme), **Light** (a light gray theme), **Breeze** (a KDE-inspired theme with cyan accents), or **System** (follows the operating system's dark/light mode).
- **Confirm Before Quit**: If enabled, the app warns you if you try to close the window while you have active terminal sessions or file transfers running in the background.
- **Automatic Updates**: Turns the automatic background check against GitHub Releases, every 6 hours, on or off.
  > [!NOTE]
  > **Air-Gap Switch**: Set the environment variable `SSHS3_DISABLE_UPDATES=1` in the operating system to lock this setting completely and turn off all update network traffic.

---

### 1.2 Terminal
![Terminal settings](/img/docs/settings-terminal.png)

| Setting | Default | Purpose & Description | Limits |
| :--- | :--- | :--- | :--- |
| **Font Family** | Monospace stack (choose a preset or your own) | The typeface used to render text and symbols in the terminal. | Requires a monospaced (fixed character width) typeface. Proportional typefaces make cursor positions shift. |
| **Font Size** | `13 px` | The base size of text in terminal panes. | Can be adjusted dynamically per tab with <kbd>Ctrl++</kbd> and <kbd>Ctrl+-</kbd>. |
| **Cursor Style** | `Block` | The look of the cursor: **Block**, **Underline** or **Bar** (vertical line). | Shown in the active pane. |
| **Scrollback Buffer** | `5000 lines` | How many lines of history are kept in memory for each terminal pane. | Higher values (for example 50,000 lines) use more RAM per open pane. |
| **Copy text automatically on selection** | `Off` | Copies every selection to the clipboard and saves it in the encrypted clipboard history. | The history requires the OS keyring to be saved to disk, otherwise it is kept in memory only. |
| **Clipboard history scope** | `Global` | Shared history for all hosts, or a separate history per connection. | Applies only when Copy on Select is on. |
| **Empty clipboard history on exit** | `Off` | Empties the clipboard history when the app quits (and at the next start if it crashed). | |
| **On Logout / Session End** | `Reconnect` | What happens when a session ends: reconnect, close the tab or keep it. | |
| **Local Terminal SSH Agent** | `Auto` | How `SSH_AUTH_SOCK` is set in local shell tabs: **Auto** (the unlocked app agent under Global PIN caching, otherwise the system / login-shell agent, otherwise one of its own), **System Only** (only the system agent, starts none) or **Disabled** (none). | Applies to new tabs. See chapter 2. |

---

### 1.3 Performance (The Performance Bar)
![Performance settings](/img/docs/settings-performance.png)

- **Enable Performance Bar**: Turns the live telemetry bar above the terminals on or off. (Off by default to guarantee zero overhead.)
- **Layout Mode**:
  - `Compact Text`: Plain text values (for example `CPU: 12% | RAM: 3.4/16 GB | Ping: 14ms`).
  - `Bars`: Color-coded gauges that dynamically change color from green to yellow and red under high load.
  - `Sparklines`: Real-time miniature charts showing the latest measurement points as line graphs.
- **Sampling Interval**: Choose the update interval: `2s`, `5s`, `10s` or `30s`. On Windows the interval is automatically limited to at least 10s to avoid unnecessary TCP traffic.
- **Metric selection**: Tick exactly which parameters should be shown in the bar: CPU, memory, load, swap, network in/out, disk I/O, iowait, steal, process count, per-core CPU and latency/ping.

---

### 1.4 Files & Storage (The File Manager)
![File manager settings](/img/docs/settings-files.png)

- **Show Hidden Files**: Show or hide files and folders that start with a dot (`.`).
- **Concurrent Transfers**: The number of simultaneous file transfer jobs in the transfer queue (default: 3). Higher values give faster transfer of many small files, but can saturate the network.
- **Default Conflict Action**: The default action on file collisions: **Ask** (ask every time), **Overwrite**, **Skip** or **Resume**.
- **Preserve Timestamps**: Preserves the original modification timestamps (`mtime`) of files on download and upload (supported over SFTP and local disk).

---

### 1.5 Synchronization (Remote Sync & Dotfiles)
![Synchronization settings](/img/docs/settings-sync.png)

- **Remote Profile Sync ("Own Your Data")**:
  - Synchronizes your encrypted profiles against your own S3 bucket or private SSH server.
  - All data is encrypted locally on your machine with **AES-256-GCM** before it leaves the computer.
  - Configure the sync target and the master password for the vault.
- **Keep `~/.ssh/config` in sync with saved SSH profiles** (on by default): keeps sshs3's marked block in `~/.ssh/config` up to date at startup and whenever you save, delete or import an SSH profile, so `ssh <profile-name>` works in any terminal. Only sshs3's own block is changed. See chapter 2.
- **Dotfiles Pool Manager**:
  - Manage your collection of shared `.bashrc`, `.vimrc`, scripts and profile files that can be uploaded temporarily when logging in to any servers.

---

### 1.6 Security & Smartcard (Security & Hardware Keys)
![Security settings](/img/docs/settings-security.png)

- **PIN Caching Policy**:
  - `Always Prompt (Default)`: No caching between connections; reconnecting asks for the PIN again.
  - `Once Per Terminal Connection`: The PIN is entered once into a private, app-managed `ssh-agent` shared by the terminal tab and its dotfiles sync. The agent is closed when the terminal disconnects.
  - `Global (App Lifetime)`: The PIN is entered once per card and shared by all terminals and profiles for as long as the app runs, until you quit or lock. All unlocked smartcards and FIDO2 keys live in *one* app-wide ssh-agent. The card icon in the top bar toggles between **Lock All Now** and **Unlock Now**. Most convenient but least strict. See chapter 8.
- **Preferred PKCS#11 Library**: Choose which library to prioritize in auto-detection: `p11-kit` (default), `YubiKey libykcs11`, `OpenSC` or `Net iD`.
- **Master Password Vault**: Fallback encryption with AES-256-GCM if the operating system's built-in keyring (Secret Service / DPAPI) is not available.

---

### 1.7 Git & GitHub (Developer Keys & Git Configuration)
A centralized dashboard for developer keys, Git providers and cryptographic commit signing:

- **Developer SSH Keys & Git Providers**:
  - Collects all discovered public keys from `~/.ssh`, the operating system's active SSH agent and the global smartcard cache (YubiKey/PIV/FIDO2).
  - **Copy**: Copies the public key string directly to the clipboard.
  - **GitHub / GitLab**: Opens the respective provider's SSH key settings in the browser with the key name filled in and automatically copies the key text to the clipboard so it is ready to paste (<kbd>Ctrl+V</kbd>).
  - **Sign Active / Git Sign**: Selects and configures the chosen key as the active signing key in `~/.gitconfig` with a single click.
- **Git Commit Signing (`~/.gitconfig`)**:
  - Shows the active signing format (`ssh`) and the active public key.
  - **Automatic Signing (`commit.gpgsign`)**: Turn global automatic signing of all commits on or off.
  - **allowed_signers**: Automatically updates `~/.ssh/allowed_signers` so local signatures can be verified without error messages.
  - **Change Key / Custom Key**: The ability to manually paste any SSH public key or key path.
- **SFTP & File Manager Git Integration**:
  - A toggle to enable or disable the Git integration in the file manager (default: on).
  - When it is off, no background polling of git status is done over SFTP or local folders, and the toolbar is kept clean.
- **Lookup Public Keys (`username.keys`)**:
  - Look up and inspect public keys for any username on GitHub, GitLab or a private GitLab instance through their official `.keys` endpoints.

---

## 2. Complete Keyboard Shortcut Reference

![Keyboard shortcuts](/img/docs/settings-shortcuts.png)

### Terminal & Panes (Split Panes)

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl+Shift+D</kbd> | **Split Vertically (Right)** | Splits the active pane in the middle and places a new pane on the right. |
| <kbd>Ctrl+Shift+E</kbd> | **Split Horizontally (Down)** | Splits the active pane in the middle and places a new pane below. |
| <kbd>Ctrl+Shift+N</kbd> | **Next Pane** | Moves keyboard focus forward to the next pane in the tree. |
| <kbd>Ctrl+Shift+P</kbd> | **Previous Pane** | Moves keyboard focus back to the previous pane. |
| <kbd>Ctrl+Shift+←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | **Navigate** | Moves focus spatially between split panes, tabs, file manager panes, menus and dialogs. <kbd>↑</kbd> from the top pane goes to the tab bar and <kbd>↓</kbd> goes back in from there. Can be changed under *Keyboard Shortcuts* (Navigate Left/Right/Up/Down). |
| <kbd>Ctrl+Shift+T</kbd> | **New Terminal** | Opens a new terminal tab. |
| <kbd>Ctrl+Shift+F</kbd> | **New File Manager** | Opens a new file manager tab. |
| <kbd>Ctrl+Shift+O</kbd> | **Connection Manager** | Opens saved profiles and connections. |
| <kbd>Ctrl+W</kbd> | **Close Tab** | Closes the whole active tab and all its split panes. |
| <kbd>Ctrl+Tab</kbd> | **Next Tab** | Switches to the next open tab. |
| <kbd>Ctrl+Shift+Tab</kbd> | **Previous Tab** | Switches to the previous open tab. |
| <kbd>Ctrl+Shift+S</kbd> | **Search in Terminal** | Opens the search bar to search the terminal's text buffer. |
| <kbd>Ctrl+Shift+R</kbd> | **Clipboard History** | Opens the encrypted history of terminal selections (requires Copy on Select). |
| <kbd>Ctrl+Shift+G</kbd> | **Copy Last Output** | Copies the output of the last command. |
| <kbd>Ctrl+Shift+L</kbd> | **Snippets** | Opens the palette of saved commands. |
| <kbd>Ctrl++</kbd> | **Zoom In** | Increases the font size in the active terminal. |
| <kbd>Ctrl+-</kbd> | **Zoom Out** | Decreases the font size in the active terminal. |
| <kbd>Ctrl+0</kbd> | **Reset Zoom** | Resets the font size to the default. |

### The File Manager

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl+F</kbd> | **Search Files** | Opens the file filter bar in the active pane. Supports recursive search and wildcards (`*`, `?`). |
| <kbd>F5</kbd> / <kbd>Ctrl+R</kbd> | **Refresh** | Reloads the contents of the active directory. |
| <kbd>Ctrl+S</kbd> | **Save Remote File** | In the built-in text editor: saves the changes directly back to the server. |
| <kbd>Delete</kbd> | **Delete** | Deletes the selected files or folders after confirmation. |
| <kbd>F2</kbd> | **Rename** | Renames the selected file. |

### Keyboard Control Without a Mouse
The app can be used entirely without a mouse: <kbd>Ctrl+Shift+Arrow keys</kbd> navigate, <kbd>Enter</kbd> performs whatever is selected (opens folders, starts connections, toggles checkboxes) and <kbd>Escape</kbd> closes menus and dialogs and returns focus to where you came from. In a dialog, <kbd>Ctrl+Shift+Arrows</kbd> move between fields and buttons, even when the cursor is in a text field.

### Global Application Commands

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl+Shift+K</kbd> | **Search in Files** | Content search across local disk, SFTP and S3. |
| <kbd>Ctrl+,</kbd> | **Settings** | Opens the settings dialog. |
| <kbd>Ctrl+Q</kbd> | **Quit sshs3** | Closes the application (checks active transfers first). |
