export type AppTheme = 'dark' | 'light' | 'system';
export type SessionExitAction = 'reconnect' | 'close' | 'keep';

export interface ShortcutDefinition {
  id: string;
  name: string;
  defaultKeys: string;
  category: 'Tabs' | 'Terminal' | 'General';
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'newTerminal', name: 'New Terminal', defaultKeys: 'Ctrl+Shift+T', category: 'Tabs' },
  { id: 'newFileManager', name: 'New File Manager', defaultKeys: 'Ctrl+Shift+F', category: 'Tabs' },
  { id: 'closeTab', name: 'Close Tab', defaultKeys: 'Ctrl+W', category: 'Tabs' },
  { id: 'nextTab', name: 'Next Tab', defaultKeys: 'Ctrl+Tab', category: 'Tabs' },
  { id: 'prevTab', name: 'Previous Tab', defaultKeys: 'Ctrl+Shift+Tab', category: 'Tabs' },
  { id: 'openProfiles', name: 'Connection Manager', defaultKeys: 'Ctrl+Shift+O', category: 'General' },
  { id: 'openSettings', name: 'Settings', defaultKeys: 'Ctrl+,', category: 'General' },
  { id: 'splitVertical', name: 'Split Terminal Vertically', defaultKeys: 'Ctrl+Shift+D', category: 'Terminal' },
  { id: 'splitHorizontal', name: 'Split Terminal Horizontally', defaultKeys: 'Ctrl+Shift+E', category: 'Terminal' },
];

export const DEFAULT_SHORTCUTS: Record<string, string> = SHORTCUT_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.id] = def.defaultKeys;
    return acc;
  },
  {} as Record<string, string>
);

/**
 * Governs how PKCS#11 smartcard PIN entry is cached across the connections a
 * single "connect" action can open (the interactive terminal plus, when
 * enabled, a separate dotfiles-sync SFTP connection):
 * - 'always-prompt': no caching. Every connection that needs the smartcard
 *   prompts for the PIN fresh. Required when policy mandates re-authenticating
 *   the card on every login.
 * - 'agent-per-session': the PIN is entered once into a private, app-managed
 *   ssh-agent shared by that terminal connection and its dotfiles sync. The
 *   agent is scoped to that one terminal, not the app's lifetime — it's
 *   killed as soon as the terminal disconnects, so reconnecting (even within
 *   the same app run) asks for the PIN again.
 * - 'agent-global': the PIN is entered once per PKCS#11 library into a
 *   private, app-managed ssh-agent shared by every terminal, tab and profile
 *   using that same smartcard, for as long as the app keeps running. Least
 *   strict of the three: convenient, but the card stays usable by anything
 *   in the app (not just the connection that first unlocked it) until the
 *   app quits or the card is locked manually.
 */
export type SmartcardAuthMode = 'always-prompt' | 'agent-per-session' | 'agent-global';

export interface AppSettings {
  theme: AppTheme;
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalCursorStyle?: 'block' | 'underline' | 'bar';
  terminalScrollback?: number;
  copyOnSelect?: boolean;
  defaultNewTabType: 'terminal' | 'filemanager';
  confirmBeforeDelete?: boolean;
  showHiddenFiles?: boolean;
  defaultConflictPolicy?: 'ask' | 'overwrite' | 'skip' | 'rename';
  shortcuts?: Record<string, string>;
  /** Master switch for the dotfiles pool feature. Off by default — an opt-in feature, not a default-on behavior. */
  dotfilesPoolEnabled?: boolean;
  /** Smartcard PIN caching behavior, applied uniformly to every smartcard/PKCS#11 profile. */
  smartcardAuthMode?: SmartcardAuthMode;
  /** Action to take when a terminal session exits: 'reconnect' (show reconnect overlay), 'close' (auto-close tab on clean exit), or 'keep' (leave terminal open passively). */
  sessionExitAction?: SessionExitAction;
  /** Windows only: Mode for local X11 server: 'manual' (external), 'auto' (start automatically when X11 session opens), 'always' (start on app launch) */
  x11ServerMode?: 'manual' | 'auto' | 'always';
  /** Windows only: Custom path to X server executable (e.g. C:\Program Files\VcXsrv\vcxsrv.exe). Auto-detects if omitted. */
  x11ServerPath?: string;
  /** Windows only: Custom arguments for X server (default: ':0 -multiwindow -clipboard -wgl -ac'). */
  x11ServerArgs?: string;
  /** ISO 8601 timestamp of the last edit. Used by remote profile sync to pick the newer whole-object copy. */
  updatedAt?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  terminalFontSize: 13,
  terminalFontFamily: 'JetBrains Mono, monospace',
  terminalCursorStyle: 'block',
  terminalScrollback: 5000,
  copyOnSelect: false,
  defaultNewTabType: 'terminal',
  confirmBeforeDelete: true,
  showHiddenFiles: false,
  defaultConflictPolicy: 'ask',
  shortcuts: { ...DEFAULT_SHORTCUTS },
  dotfilesPoolEnabled: false,
  sessionExitAction: 'reconnect',
  smartcardAuthMode: 'always-prompt',
  x11ServerMode: 'auto',
};
