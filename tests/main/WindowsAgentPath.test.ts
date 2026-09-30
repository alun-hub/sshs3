import { describe, expect, it } from 'vitest';
import { isDirOnPath } from '../../src/main/smartcard/WindowsAgentPath';

describe('isDirOnPath', () => {
  const pathValue = String.raw`C:\Windows\system32;C:\Program Files\Yubico\YubiKey Manager CLI\;C:\Tools`;

  it('matches ignoring case, slash style and a trailing separator', () => {
    expect(isDirOnPath(String.raw`c:\program files\yubico\yubikey manager cli`, pathValue)).toBe(true);
    expect(isDirOnPath('C:/Tools/', pathValue)).toBe(true);
  });

  it('does not match a different or parent folder', () => {
    expect(isDirOnPath(String.raw`C:\Program Files\Yubico\Yubico PIV Tool\bin`, pathValue)).toBe(false);
    expect(isDirOnPath(String.raw`C:\Program Files\Yubico`, pathValue)).toBe(false);
  });

  it('ignores empty entries', () => {
    expect(isDirOnPath('', 'C:\\a;;C:\\b')).toBe(false);
  });
});
