import { describe, it, expect } from 'vitest';
import { applicationMenuTemplate } from '../../src/main/menu/applicationMenu';

describe('applicationMenuTemplate', () => {
  it('has no menu on Windows and Linux', () => {
    expect(applicationMenuTemplate('win32')).toBeNull();
    expect(applicationMenuTemplate('linux')).toBeNull();
  });

  it('has the app, edit and window menus on macOS, and nothing that claims Cmd+W', () => {
    const roles = applicationMenuTemplate('darwin')?.map((item) => item.role);
    expect(roles).toEqual(['appMenu', 'editMenu', 'windowMenu']);
  });
});
