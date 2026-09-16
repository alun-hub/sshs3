export type AppTheme = 'dark' | 'light' | 'system';

export interface AppSettings {
  theme: AppTheme;
  terminalFontSize: number;
  terminalFontFamily: string;
  defaultNewTabType: 'terminal' | 'filemanager';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  terminalFontSize: 13,
  terminalFontFamily: 'Menlo, Monaco, "Courier New", monospace, Consolas',
  defaultNewTabType: 'terminal',
};
