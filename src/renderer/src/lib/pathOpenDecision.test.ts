import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@shared/types/storage';
import { decidePathOpen, MAX_OS_OPEN_BYTES, type PathOpenInput } from './pathOpenDecision';

const file = (over: Partial<FileEntry> = {}): FileEntry => ({
  name: 'notes.txt',
  path: '/home/u/notes.txt',
  size: 1024,
  isDirectory: false,
  permissions: '644',
  ...over,
});

const input = (over: Partial<PathOpenInput> = {}): PathOpenInput => ({
  action: 'os',
  isNetworkUnc: false,
  localShellRunsSsh: false,
  entry: file(),
  relative: false,
  cwdReliable: true,
  ...over,
});

describe('decidePathOpen', () => {
  it('opens an ordinary file with the system app', () => {
    expect(decidePathOpen(input())).toEqual({ kind: 'os' });
  });

  it('keeps the old behaviour, quietly, when the setting says file manager', () => {
    expect(decidePathOpen(input({ action: 'filemanager' }))).toEqual({ kind: 'filemanager' });
  });

  it('shows a folder in the file manager without comment', () => {
    expect(decidePathOpen(input({ entry: file({ isDirectory: true }) }))).toEqual({ kind: 'filemanager' });
  });

  it('never opens a network share or a path that a local ssh client printed, and says nothing about it', () => {
    expect(decidePathOpen(input({ isNetworkUnc: true, entry: 'unknown' }))).toEqual({ kind: 'filemanager' });
    expect(decidePathOpen(input({ localShellRunsSsh: true }))).toEqual({ kind: 'filemanager' });
  });

  it('explains why a missing file or a failed lookup is not opened', () => {
    expect(decidePathOpen(input({ entry: 'missing' }))).toEqual({
      kind: 'filemanager',
      reason: 'Not opened: the file does not exist.',
    });
    expect(decidePathOpen(input({ entry: 'unknown' }))).toMatchObject({ kind: 'filemanager', reason: expect.any(String) });
  });

  it('does not open a FIFO or device', () => {
    expect(decidePathOpen(input({ entry: file({ isSpecial: true }) }))).toMatchObject({ kind: 'filemanager' });
  });

  describe('a relative path', () => {
    it('is opened when the working directory comes from the shell', () => {
      expect(decidePathOpen(input({ relative: true, cwdReliable: true }))).toEqual({ kind: 'os' });
    });

    it('is not opened while the working directory is a guess', () => {
      expect(decidePathOpen(input({ relative: true, cwdReliable: false }))).toMatchObject({
        kind: 'filemanager',
        reason: expect.stringContaining('current directory'),
      });
    });

    it('does not matter for an absolute path', () => {
      expect(decidePathOpen(input({ relative: false, cwdReliable: false }))).toEqual({ kind: 'os' });
    });
  });

  describe('size', () => {
    it('opens a file at the limit', () => {
      expect(decidePathOpen(input({ entry: file({ size: MAX_OS_OPEN_BYTES }) }))).toEqual({ kind: 'os' });
    });

    it('does not download one byte more', () => {
      expect(decidePathOpen(input({ entry: file({ size: MAX_OS_OPEN_BYTES + 1 }) }))).toMatchObject({
        kind: 'filemanager',
        reason: expect.stringContaining('50 MB'),
      });
    });
  });

  describe('an executable file without an extension', () => {
    const script = (over: Partial<FileEntry>) => input({ entry: file({ name: 'deploy', ...over }) });

    it('is not opened', () => {
      for (const permissions of ['755', '700', '0755', '711', '001']) {
        expect(decidePathOpen(script({ permissions }))).toMatchObject({ kind: 'filemanager' });
      }
    });

    it('is opened when it is not executable', () => {
      expect(decidePathOpen(script({ permissions: '644' }))).toEqual({ kind: 'os' });
    });

    it('is opened when the permissions are unknown or not octal (S3, Windows)', () => {
      expect(decidePathOpen(script({ permissions: undefined }))).toEqual({ kind: 'os' });
      expect(decidePathOpen(script({ permissions: 'Read-only' }))).toEqual({ kind: 'os' });
    });

    it('does not apply to a file that has an extension (the main process judges those by type)', () => {
      expect(decidePathOpen(input({ entry: file({ name: 'run.txt', permissions: '755' }) }))).toEqual({ kind: 'os' });
    });

    it('treats an executable dotfile like any other file without an extension: the safe side', () => {
      expect(decidePathOpen(input({ entry: file({ name: '.bashrc', permissions: '755' }) }))).toMatchObject({
        kind: 'filemanager',
      });
    });
  });
});
