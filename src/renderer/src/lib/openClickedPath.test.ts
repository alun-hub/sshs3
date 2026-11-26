import { describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '@shared/types/storage';
import { openClickedPath, OPEN_LOOKUP_TIMEOUT_MS, type ClickedPath, type ClickedPathApi } from './openClickedPath';

const entry = (over: Partial<FileEntry> = {}): FileEntry => ({
  name: 'notes.txt',
  path: '/home/u/notes.txt',
  size: 10,
  isDirectory: false,
  permissions: '644',
  ...over,
});

const click = (over: Partial<ClickedPath> = {}): ClickedPath => ({
  action: 'os',
  providerId: 'sftp-h',
  storagePath: '/home/u/notes.txt',
  isNetworkUnc: false,
  localShellRunsSsh: false,
  relative: false,
  cwdReliable: true,
  ...over,
});

const api = (over: Partial<ClickedPathApi> = {}): ClickedPathApi & { lookup: ReturnType<typeof vi.fn>; openExternal: ReturnType<typeof vi.fn> } =>
  ({
    lookup: vi.fn().mockResolvedValue(entry()),
    openExternal: vi.fn().mockResolvedValue({ sessionToken: 'tok' }),
    ...over,
  }) as never;

describe('openClickedPath', () => {
  it('opens a file with the system app and reports the session', async () => {
    const a = api();
    await expect(openClickedPath(click(), a)).resolves.toEqual({
      kind: 'opened',
      sessionToken: 'tok',
      name: 'notes.txt',
      remote: true,
    });
    expect(a.lookup).toHaveBeenCalledWith('sftp-h', '/home/u/notes.txt', OPEN_LOOKUP_TIMEOUT_MS);
    expect(a.openExternal).toHaveBeenCalledWith('sftp-h', '/home/u/notes.txt');
  });

  it('marks a file of this machine as not remote', async () => {
    const outcome = await openClickedPath(click({ providerId: 'local' }), api());
    expect(outcome).toMatchObject({ kind: 'opened', remote: false });
  });

  it('does nothing but hand over to the file manager when that is the setting, and looks nothing up', async () => {
    const a = api();
    await expect(openClickedPath(click({ action: 'filemanager' }), a)).resolves.toEqual({ kind: 'filemanager' });
    expect(a.lookup).not.toHaveBeenCalled();
    expect(a.openExternal).not.toHaveBeenCalled();
  });

  it('does not look up or open a network share, nor a path a local ssh client printed', async () => {
    for (const over of [{ isNetworkUnc: true }, { localShellRunsSsh: true }]) {
      const a = api();
      await expect(openClickedPath(click(over), a)).resolves.toEqual({ kind: 'filemanager' });
      expect(a.lookup).not.toHaveBeenCalled();
      expect(a.openExternal).not.toHaveBeenCalled();
    }
  });

  it('does nothing for a terminal without storage', async () => {
    const a = api();
    await expect(openClickedPath(click({ providerId: '' }), a)).resolves.toEqual({ kind: 'filemanager' });
    expect(a.lookup).not.toHaveBeenCalled();
  });

  it('shows a folder in the file manager, quietly', async () => {
    const a = api({ lookup: vi.fn().mockResolvedValue(entry({ isDirectory: true })) });
    await expect(openClickedPath(click(), a)).resolves.toEqual({ kind: 'filemanager' });
    expect(a.openExternal).not.toHaveBeenCalled();
  });

  it('explains a missing file and a lookup that failed or took too long', async () => {
    const cases: Array<[Partial<ClickedPathApi>, string]> = [
      [{ lookup: vi.fn().mockResolvedValue(null) }, 'does not exist'],
      [{ lookup: vi.fn().mockResolvedValue('timeout') }, 'could not be checked'],
      [{ lookup: vi.fn().mockRejectedValue(new Error('connection lost')) }, 'could not be checked'],
    ];
    for (const [over, text] of cases) {
      const a = api(over);
      const outcome = await openClickedPath(click(), a);
      expect(outcome).toMatchObject({ kind: 'filemanager', reason: expect.stringContaining(text) });
      expect(a.openExternal).not.toHaveBeenCalled();
    }
  });

  it('does not open a relative path against a guessed working directory', async () => {
    const a = api();
    const outcome = await openClickedPath(click({ relative: true, cwdReliable: false }), a);
    expect(outcome).toMatchObject({ kind: 'filemanager', reason: expect.stringContaining('current directory') });
    expect(a.openExternal).not.toHaveBeenCalled();
  });

  it('falls back with the error when the main process refuses, without Electron\'s IPC prefix', async () => {
    const a = api({
      openExternal: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'file:open-external': Error: Refusing to open \"x.exe\" with the OS default handler"
          )
        ),
    });
    const outcome = await openClickedPath(click({ storagePath: '/srv/x.exe' }), a);
    expect(outcome).toEqual({
      kind: 'filemanager',
      reason: 'Could not open x.exe: Refusing to open "x.exe" with the OS default handler',
    });
  });
});
