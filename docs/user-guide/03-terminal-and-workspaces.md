# Terminal, Tabs & Workspaces

The terminal experience in **sshs3** is built for professional administrators and developers who work intensively with many simultaneous sessions and complex commands.

---

## 1. Native OpenSSH Core vs. JS Reimplementations

Many web- and Electron-based terminals use their own JavaScript or WASM libraries to handle the SSH protocol, which often leads to subtle bugs in terminal emulation, incorrect line wrapping or missing support for modern OpenSSH features.

sshs3 runs **your operating system's genuine OpenSSH binary** (`ssh`) through `node-pty`:
- **100% compatibility with `~/.ssh/config`**: All directives (`Host`, `ProxyJump`, `CertificateFile`, `SendEnv`, `IdentityFile`) work exactly as they do in your regular CLI shell.
- **The system's SSH agents**: Works seamlessly with `ssh-agent`, GnuPG, 1Password and YubiKey PIV.
- **Escape sequences & color support**: Full support for TrueColor (24-bit colors), OSC codes and mouse interaction in programs such as `tmux`, `vim`, `htop` and `lazygit`.

---

## 2. Terminal Ergonomics & Clipboard Handling

### 2.1 Clipboard & Selection (Clipboard Workflow)
- **Copy on Select**: When you select text in the terminal window it is copied automatically to the operating system's clipboard manager, with no keyboard shortcut needed.
- **Paste**: <kbd>Shift+Insert</kbd> pastes the latest entry in the clipboard history (otherwise the system clipboard), and a middle click pastes the latest entry. The system's regular paste command works too.
- **Right click**: with Copy on Select on, this opens the clipboard history (see 2.2). Panes are split from the pane toolbar or with the <kbd>Ctrl+Shift+D</kbd> / <kbd>Ctrl+Shift+E</kbd> shortcuts.

### 2.2 Clipboard History (<kbd>Ctrl+Shift+R</kbd>)
When **Copy on Select** is on, every selection is saved in an encrypted, searchable history (the OS keyring; in memory only if no keyring is available).
- <kbd>Shift+Insert</kbd> and a middle click paste the latest entry.
- A right click or <kbd>Ctrl+Shift+R</kbd> opens the history: search, browse with the arrow keys and press <kbd>Enter</kbd> to paste.
- Scope (all hosts or per connection) and "clear on exit" are set under Settings.

### 2.3 Searching the Terminal Scrollback (<kbd>Ctrl+Shift+S</kbd>)
Press <kbd>Ctrl+Shift+S</kbd> to open the search bar in the focused terminal pane:
- Searches the whole terminal history (up to the number of lines configured in the settings).
- Selected text is used as the search term. A match counter shows, for example, `3/6`.
- <kbd>Enter</kbd> goes to the next match, <kbd>Shift+Enter</kbd> to the previous one, <kbd>Esc</kbd> closes.
- Matches are colored according to the theme (red in Breeze, yellow/orange in light and dark). Moving between matches copies nothing to the clipboard.

### 2.4 Clickable Links and File Paths
Hold <kbd>Ctrl</kbd> (<kbd>Cmd</kbd> on macOS) and click:
- **URLs** (`http://`, `https://`) open in the default web browser, in terminals and Kubernetes logs.
- **File paths** (`/var/log/syslog`, `~/notes.md`, `/srv/app.py:42:7`) open the folder in a new SFTP tab. Applies to SSH terminals. The terminal cannot tell a file from a folder: a path without a trailing `/` opens its parent folder, and `~/` is assumed to mean `/home/<user>` (`/root` for root).

### 2.5 Copy the Last Command's Output (<kbd>Ctrl+Shift+G</kbd>)
Copies the output of the last command to the clipboard (and to the clipboard history if Copy on Select is on).
- Exact in shells that send OSC 133 prompt markers (fish, and zsh/bash with shell integration).
- Otherwise the output is derived from your Enter key presses. With a multi-line prompt, the first line of the prompt may be included.

### 2.6 Snippets (<kbd>Ctrl+Shift+L</kbd>)
A searchable palette of saved commands:
- <kbd>Enter</kbd> types the command, <kbd>Ctrl+Enter</kbd> types and runs it. Multi-line snippets are pasted as a single paste.
- **New** creates a snippet; the pencil and trash icons edit and delete. A snippet can be limited to the current connection.
- Variables: `{{host}}`, `{{user}}`, `{{date}}` (format `yyyy-mm-dd HH:mm`).
- Snippets are stored **unencrypted** in `snippets.json` in the app's data folder. Never put passwords or tokens in them.

### 2.7 Dynamic Text Scaling (Zoom)
During presentations, meetings or when working on high-resolution 4K screens, the font size can be scaled instantly:
- <kbd>Ctrl++</kbd>: Increases the font size by 1 px.
- <kbd>Ctrl+-</kbd>: Decreases the font size by 1 px.
- <kbd>Ctrl+0</kbd>: Resets the font size to the default from the settings.

---

## 3. Konsole-Style Recursive Split Panes

sshs3 implements the same split-tree architecture as KDE's Konsole (`ViewSplitter`), which allows unlimited horizontal and vertical splitting:

![Split panes in the terminal](/img/split-terminal.png)

### 3.1 Navigation & Resizing
- **Drag the splitters**: Place the mouse pointer between two panes to drag and adjust the panes' width and height.
- **Keyboard navigation**:
  - <kbd>Ctrl+Shift+N</kbd>: Moves focus to the **next pane** in the tree.
  - <kbd>Ctrl+Shift+P</kbd>: Moves focus to the **previous pane**.
  - <kbd>Ctrl+Shift+Arrows</kbd>: Moves focus **spatially** to the pane in the direction of the arrow. <kbd>↑</kbd> from a top pane goes to the tab bar (where <kbd>←</kbd>/<kbd>→</kbd> switch tab and <kbd>↓</kbd> or <kbd>Enter</kbd> go back in).
- **Pane independence**:
  - Each pane has its own mini toolbar and connection picker. You can have a remote SSH session in the left pane, a local bash shell in the upper right and a Kubernetes container exec in the lower right.
  - Closing a pane (<kbd>Ctrl+Shift+W</kbd>) never interrupts adjacent sessions; the tree collapses smoothly and gives room to the remaining panes.
- **Unsplit**: Click the unsplit icon in the pane toolbar to maximize the active pane to 100% and close all other split panes in the tab.

---

## 4. Session Persistence

When you close sshs3, your current workspace is saved automatically:
- All open tabs and their split-pane layouts are preserved.
- Working directories for local shells are restored at the next start.
- If the application is restarted after a software update, your windows and connections open in exactly the same state.
