import { describe, it, expect } from 'vitest';
import { defaultDotfileRemotePath } from '../../src/shared/dotfilePath';

describe('defaultDotfileRemotePath', () => {
  it('keeps the path below the home directory when known', () => {
    expect(defaultDotfileRemotePath('/home/u/.kube/config', '/home/u')).toBe('~/.kube/config');
    expect(defaultDotfileRemotePath('/home/u/bin/tool', '/home/u/')).toBe('~/bin/tool');
  });

  it('keeps the path from the first dot-segment otherwise', () => {
    expect(defaultDotfileRemotePath('/home/u/.kube/config')).toBe('~/.kube/config');
    expect(defaultDotfileRemotePath('/home/u/.config/nvim/init.vim')).toBe('~/.config/nvim/init.vim');
    expect(defaultDotfileRemotePath('/home/u/.bashrc')).toBe('~/.bashrc');
    expect(defaultDotfileRemotePath('/srv/app/settings')).toBe('~/.settings');
  });
});
