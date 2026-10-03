# Keyboard Shortcuts & Settings Reference

A comprehensive reference for keyboard shortcuts, visual settings, and configuration parameters in sshs3.

---

## Keyboard Shortcuts Reference

### Terminal & Panes

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl+Shift+D</kbd> | **Split Right** | Subdivides active pane vertically, opening a new pane to the right. |
| <kbd>Ctrl+Shift+E</kbd> | **Split Down** | Subdivides active pane horizontally, opening a new pane below. |
| <kbd>Ctrl+Shift+N</kbd> | **Next Pane** | Cycles forward to the next pane in the active split tree. |
| <kbd>Ctrl+Shift+P</kbd> | **Previous Pane** | Cycles backward to the previous pane in the active split tree. |
| <kbd>Ctrl+Shift+W</kbd> | **Close Pane** | Closes the currently focused pane. |
| <kbd>Ctrl+T</kbd> | **New Tab** | Opens connection picker / new tab. |
| <kbd>Ctrl+W</kbd> | **Close Tab** | Closes the entire active tab and all its split panes. |
| <kbd>Ctrl+Tab</kbd> / <kbd>Ctrl+Shift+Tab</kbd> | **Switch Tabs** | Switches to next or previous tab. |
| <kbd>Ctrl+Shift+F</kbd> | **Terminal Find** | Searches text within the active terminal buffer. |
| <kbd>Ctrl++</kbd> / <kbd>Ctrl+-</kbd> / <kbd>Ctrl+0</kbd> | **Zoom Font** | Increases, decreases, or resets terminal font size. |

### File Manager

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl+F</kbd> | **Find Files** | Opens file search bar with wildcard and recursive search toggle. |
| <kbd>F5</kbd> / <kbd>Ctrl+R</kbd> | **Refresh** | Reloads file list in the focused pane. |
| <kbd>Ctrl+S</kbd> | **Save File** | In the Monaco code editor, saves changes directly back to remote host. |
| <kbd>Delete</kbd> | **Delete File** | Prompts to delete selected files or directories. |
| <kbd>F2</kbd> | **Rename** | Renames currently selected item. |

### Global Application

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| <kbd>Ctrl+N</kbd> | **New Profile** | Opens modal to create a new connection profile. |
| <kbd>Ctrl+,</kbd> | **Settings** | Opens global settings dialog. |
| <kbd>Ctrl+Shift+T</kbd> | **SSH Tunnels** | Opens the SSH Tunnels manager. |
| <kbd>Ctrl+Q</kbd> | **Quit Application** | Quits sshs3 (verifies running file transfers first). |

---

## Settings Reference

### Appearance & Themes
- **Theme Selection**: Dark (default) or Light theme.
- **Terminal Font**: Select any monospaced font installed on your system (e.g. JetBrains Mono, Cascadia Code, Fira Code).
- **Cursor Style**: Block, underline, or vertical bar; toggle cursor blinking.

### App Behavior
- **Automatic Updates**: Toggle background checks for new GitHub Releases (on/off).
- **Confirm Before Quit**: Prompts for confirmation when closing the window with active sessions or transfers.
- **Air-Gap Mode**: Override completely via `SSHS3_DISABLE_UPDATES=1`.

### Performance Bar
- **Enable Performance Bar**: Toggle live telemetry strip on or off.
- **Layout Style**: Compact text, visual bars, or mini sparklines.
- **Sampling Interval**: 2s, 5s, 10s, or 30s.
- **Metric Checkboxes**: Select which metrics are displayed in the bar.

### Portable Windows Data Isolation
- Portable Windows builds detect `PORTABLE_EXECUTABLE_DIR` or a local `data/` folder next to `sshs3.exe`.
- When present, all configuration, profiles, and logs are saved to `<exe-dir>/data/` rather than `%APPDATA%\sshs3`.
