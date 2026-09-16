export type AppTheme = 'dark' | 'light' | 'system';

export interface ShortcutDefinition {
  id: string;
  name: string;
  defaultKeys: string;
  category: 'Flikar' | 'Terminal' | 'Allmänt';
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { id: 'newTerminal', name: 'Ny terminal', defaultKeys: 'Ctrl+Shift+T', category: 'Flikar' },
  { id: 'newFileManager', name: 'Ny filhanterare', defaultKeys: 'Ctrl+Shift+F', category: 'Flikar' },
  { id: 'closeTab', name: 'Stäng flik', defaultKeys: 'Ctrl+W', category: 'Flikar' },
  { id: 'nextTab', name: 'Nästa flik', defaultKeys: 'Ctrl+Tab', category: 'Flikar' },
  { id: 'prevTab', name: 'Föregående flik', defaultKeys: 'Ctrl+Shift+Tab', category: 'Flikar' },
  { id: 'openProfiles', name: 'Anslutningshanterare', defaultKeys: 'Ctrl+Shift+O', category: 'Allmänt' },
  { id: 'openSettings', name: 'Inställningar', defaultKeys: 'Ctrl+,', category: 'Allmänt' },
  { id: 'splitVertical', name: 'Dela terminal vertikalt', defaultKeys: 'Ctrl+Shift+D', category: 'Terminal' },
  { id: 'splitHorizontal', name: 'Dela terminal horisontellt', defaultKeys: 'Ctrl+Shift+E', category: 'Terminal' },
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
  defaultNewTabType: 'terminal' | 'filemanager';
  shortcuts?: Record<string, string>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  terminalFontSize: 13,
  terminalFontFamily: 'Menlo, Monaco, "Courier New", monospace, Consolas',
  defaultNewTabType: 'terminal',
  shortcuts: { ...DEFAULT_SHORTCUTS },
};
