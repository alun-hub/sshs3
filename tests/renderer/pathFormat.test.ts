import { describe, it, expect } from 'vitest';
import { parentPath } from '../../src/renderer/src/lib/format';

describe('parentPath', () => {
  it('handles POSIX paths', () => {
    expect(parentPath('/home/user/docs')).toBe('/home/user');
    expect(parentPath('/home')).toBe('/');
    expect(parentPath('/')).toBe('/');
  });

  it('keeps a Windows drive root as its own parent', () => {
    expect(parentPath('C:\\')).toBe('C:\\');
    expect(parentPath('C:')).toBe('C:\\');
  });

  it('returns the drive root, not the bare drive, from a top-level folder', () => {
    expect(parentPath('C:\\Users')).toBe('C:\\');
    expect(parentPath('C:\\Users\\alun')).toBe('C:\\Users');
  });
});
