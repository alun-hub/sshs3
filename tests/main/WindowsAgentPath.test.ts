import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import util from 'node:util';

const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const customExecFile: any = (file: string, args: any, options: any, callback?: any) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    mockExecFileAsync(file, args, options)
      .then((res: any) => callback && callback(null, res?.stdout ?? '', res?.stderr ?? ''))
      .catch((err: any) => callback && callback(err, err?.stdout ?? '', err?.stderr ?? ''));
  };
  customExecFile[util.promisify.custom] = mockExecFileAsync;

  return {
    ...actual,
    execFile: customExecFile,
  };
});

import {
  isDirOnPath,
  getWindowsAgentPathStatus,
  applyWindowsAgentPathFix,
} from '../../src/main/smartcard/WindowsAgentPath';

describe('WindowsAgentPath', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockExecFileAsync.mockReset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });

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

  describe('getWindowsAgentPathStatus', () => {
    it('returns not applicable on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const status = await getWindowsAgentPathStatus('/usr/lib/libykcs11.so');
      expect(status).toEqual({ applicable: false, needsFix: false });
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('returns not applicable if pkcs11LibPath is empty', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const status = await getWindowsAgentPathStatus('');
      expect(status).toEqual({ applicable: false, needsFix: false });
    });

    it('returns not applicable if reg.exe query fails', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockRejectedValueOnce(new Error('reg query failed'));

      const status = await getWindowsAgentPathStatus(String.raw`C:\Yubico\libykcs11.dll`);
      expect(status).toEqual({ applicable: false, needsFix: false });
    });

    it('returns applicable: true, needsFix: false if lib directory is already on machine PATH', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: String.raw`
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Session Manager\Environment
    Path    REG_EXPAND_SZ    C:\Windows\System32;C:\Yubico;C:\Other
`,
      });

      const status = await getWindowsAgentPathStatus(String.raw`C:\Yubico\libykcs11.dll`);
      expect(status).toEqual({
        applicable: true,
        needsFix: false,
        libDir: String.raw`C:\Yubico`,
      });
      // Should not call ssh-keygen if already on path
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
    });

    it('expands environment variables like %SystemRoot% in machine PATH', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.SystemRoot = 'C:\\Windows';
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: String.raw`
    Path    REG_EXPAND_SZ    %SystemRoot%\System32;C:\Program Files\Yubico\bin
`,
      });

      const status = await getWindowsAgentPathStatus(String.raw`C:\Program Files\Yubico\bin\libykcs11.dll`);
      expect(status).toEqual({
        applicable: true,
        needsFix: false,
        libDir: String.raw`C:\Program Files\Yubico\bin`,
      });
    });

    it('returns needsFix: false if ssh-keygen -D succeeds', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      // 1. reg query
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'Path REG_SZ C:\\Windows\\System32\n',
      });
      // 2. ssh-keygen -D
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'ssh-rsa AAAAB3NzaC1yc2E... cert',
        stderr: '',
      });

      const status = await getWindowsAgentPathStatus(String.raw`C:\CustomDir\libykcs11.dll`);
      expect(status).toEqual({
        applicable: true,
        needsFix: false,
        libDir: String.raw`C:\CustomDir`,
      });
    });

    it('returns needsFix: true when ssh-keygen -D fails with dlopen error', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'Path REG_SZ C:\\Windows\\System32\n',
      });
      mockExecFileAsync.mockRejectedValueOnce({
        stdout: '',
        stderr: 'dlopen C:\\CustomDir\\libykcs11.dll failed: The specified module could not be found.',
      });

      const status = await getWindowsAgentPathStatus(String.raw`C:\CustomDir\libykcs11.dll`);
      expect(status).toEqual({
        applicable: true,
        needsFix: true,
        libDir: String.raw`C:\CustomDir`,
      });
    });

    it('returns needsFix: false when ssh-keygen -D fails for unrelated reasons (e.g. no token)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockResolvedValueOnce({
        stdout: 'Path REG_SZ C:\\Windows\\System32\n',
      });
      mockExecFileAsync.mockRejectedValueOnce({
        stdout: '',
        stderr: 'cannot read public keys from pkcs11 module: token not present',
      });

      const status = await getWindowsAgentPathStatus(String.raw`C:\CustomDir\libykcs11.dll`);
      expect(status).toEqual({
        applicable: true,
        needsFix: false,
        libDir: String.raw`C:\CustomDir`,
      });
    });
  });

  describe('applyWindowsAgentPathFix', () => {
    it('throws error on non-Windows platforms', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      await expect(applyWindowsAgentPathFix('/opt/yubico')).rejects.toThrow('Only available on Windows.');
    });

    it('executes powershell with elevated command on Windows', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockResolvedValueOnce({ stdout: '', stderr: '' });

      await applyWindowsAgentPathFix(String.raw`C:\Program Files\Yubico's Tools\bin`);

      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockExecFileAsync.mock.calls[0];
      expect(cmd).toBe('powershell.exe');
      expect(args[0]).toBe('-NoProfile');
      expect(args[1]).toBe('-Command');
      expect(args[2]).toContain('Start-Process -FilePath powershell.exe -Verb RunAs');
    });

    it('rethrows with friendly message when user declines UAC prompt (English)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockRejectedValueOnce(new Error('The operation was canceled by the user.'));

      await expect(applyWindowsAgentPathFix(String.raw`C:\Yubico`)).rejects.toThrow(
        'The administrator prompt was declined — nothing was changed.'
      );
    });

    it('rethrows with friendly message when user declines UAC prompt (Swedish)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockRejectedValueOnce(new Error('Åtgärden avbröts av användaren.'));

      await expect(applyWindowsAgentPathFix(String.raw`C:\Yubico`)).rejects.toThrow(
        'The administrator prompt was declined — nothing was changed.'
      );
    });

    it('rethrows generic execution error', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileAsync.mockRejectedValueOnce(new Error('Access is denied'));

      await expect(applyWindowsAgentPathFix(String.raw`C:\Yubico`)).rejects.toThrow(
        'Could not update the system PATH: Access is denied'
      );
    });
  });
});
