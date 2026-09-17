export type AppTheme = 'dark' | 'light' | 'system';

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
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  terminalFontSize: 13,
  terminalFontFamily: 'Menlo, Monaco, "Courier New", monospace, Consolas',
  terminalCursorStyle: 'block',
  terminalScrollback: 5000,
  copyOnSelect: false,
  defaultNewTabType: 'terminal',
  confirmBeforeDelete: true,
  showHiddenFiles: false,
  defaultConflictPolicy: 'ask',
  shortcuts: { ...DEFAULT_SHORTCUTS },
  dotfilesPoolEnabled: false,
};
