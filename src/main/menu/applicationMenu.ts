import type { MenuItemConstructorOptions } from 'electron';

/**
 * The application menu, or null for none. Windows and Linux have no menu bar. macOS needs one: without it Cmd+Q, Cmd+H
 * and the clipboard shortcuts do nothing. There is deliberately no File or View menu, so keys such as Cmd+W and the
 * zoom keys stay with the app's own shortcuts.
 */
export function applicationMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] | null {
  if (platform !== 'darwin') return null;
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
}
