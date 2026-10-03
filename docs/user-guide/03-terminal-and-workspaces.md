# Terminal, Tabs & Workspaces

sshs3 provides a high-performance terminal workspace designed for heavy multitaskers, sysadmins, and DevOps engineers.

---

## Real OpenSSH Architecture

Unlike many terminal emulators that rely on custom JavaScript or WebAssembly reimplementations of the SSH protocol, sshs3 spawns your host operating system's genuine `ssh` binary via `node-pty`.

### Why Real OpenSSH Matters:
- **`~/.ssh/config` Support**: Every directive in your SSH config file (`Host`, `HostName`, `ProxyJump`, `IdentityFile`, `CertificateFile`, `SendEnv`, etc.) works identically to the command line.
- **SSH Agent Integration**: Seamless integration with existing agents (`ssh-agent`, GnuPG agent, 1Password SSH agent).
- **Compatibility**: Supports cutting-edge OpenSSH ciphers, key exchange algorithms, and MACs supported by your system's OpenSSH version.

---

## Konsole-Style Recursive Split Panes

sshs3 implements a recursive split-tree architecture inspired by KDE's Konsole (`ViewSplitter`), allowing arbitrary horizontal and vertical subdividing of the terminal workspace.

### Split Actions & Shortcuts

| Action | Shortcut | Description |
| :--- | :--- | :--- |
| **Split Right** | <kbd>Ctrl+Shift+D</kbd> | Subdivides the current pane vertically, placing a new pane to the right. |
| **Split Down** | <kbd>Ctrl+Shift+E</kbd> | Subdivides the current pane horizontally, placing a new pane below. |
| **Cycle Next Pane** | <kbd>Ctrl+Shift+N</kbd> | Cycles focus forward through all split panes in the active tab. |
| **Cycle Previous Pane** | <kbd>Ctrl+Shift+P</kbd> | Cycles focus backward through all split panes in the active tab. |
| **Close Active Pane** | <kbd>Ctrl+Shift+W</kbd> | Closes the currently focused pane. |
| **Unsplit** | Toolbar button | Closes all other panes in the tab, expanding the active pane to fill 100% of the window. |

### Pane Independence & Reparenting
- **Zero Session Restarts**: Splitting or closing adjacent panes never recreates, reloads, or interrupts running processes in existing panes. The tree automatically reparents remaining panes smoothly without leaving empty slots.
- **Individual Connection Picker**: Each split pane features its own mini-toolbar and connection picker, allowing you to run an SSH session in one pane, a local shell in another, and a Kubernetes container exec in a third side-by-side.

---

## Tabs & Dynamic Tracking

- **Dynamic Titles**: Tab headers and pane titles automatically track the remote hostname, current working directory, and running process via OSC escape sequences (e.g. `vim`, `htop`, `tail`).
- **Tab Reordering**: Drag and drop tabs to reorder them.
- **New Tab Shortcuts**: Press <kbd>Ctrl+T</kbd> to open a new connection or local shell tab.

---

## Local Shell Terminals

Open local terminal sessions side-by-side with remote SSH sessions:
- **Linux & macOS**: Automatically opens your login `$SHELL` (bash, zsh, fish).
- **Windows**: Choose between PowerShell, `pwsh` (PowerShell 7), Command Prompt (`cmd.exe`), or any installed WSL distribution (e.g. Ubuntu, Debian).

### Managed SSH_AUTH_SOCK Integration
When opening a local shell on Linux/macOS, sshs3 explicitly sets `SSH_AUTH_SOCK` according to the following priority:
1. **Global App-Lifetime Smartcard Agent**: If you unlocked a PKCS#11 smartcard or FIDO2 token in an SSH session under Global PIN caching, that unlocked agent socket is passed to your local shell. Commands like `ssh` or `git pull` run inside the local shell tab immediately use the unlocked hardware token without prompting for a PIN.
2. **Managed Agent**: If no system agent was detected, sshs3 starts and manages an isolated agent instance.

---

## Session Persistence

sshs3 automatically saves the state of your workspace upon exit and restores it on startup:
- All open tabs and recursive split pane layouts are preserved.
- Working directories for local shells and profile associations are restored.
- If the app was shut down abruptly or restarted after an update, your layout reappears exactly as you left it.
