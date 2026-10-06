import { describe, it, expect, afterEach } from 'vitest';
import {
  describeFido2StartupError,
  paneTreeHasAuthType,
  resolveDirSyncTargetRoot,
} from '../../src/main/ipc/ipcHelpers';

describe('ipcHelpers', () => {
  describe('paneTreeHasAuthType', () => {
    const tree = {
      type: 'split',
      children: [
        { type: 'leaf', config: { authType: 'password' } },
        { type: 'split', children: [{ type: 'leaf', config: { authType: 'fido2' } }, { type: 'leaf' }] },
      ],
    };

    it('finds an auth type in a nested pane tree', () => {
      expect(paneTreeHasAuthType(tree, 'fido2')).toBe(true);
      expect(paneTreeHasAuthType(tree, 'password')).toBe(true);
    });

    it('returns false when no leaf uses it or the input is not a tree', () => {
      expect(paneTreeHasAuthType(tree, 'smartcard')).toBe(false);
      expect(paneTreeHasAuthType(undefined, 'fido2')).toBe(false);
      expect(paneTreeHasAuthType('x', 'fido2')).toBe(false);
    });
  });

  describe('resolveDirSyncTargetRoot', () => {
    it('nests the source folder name under the target parent', () => {
      expect(resolveDirSyncTargetRoot('/home/me/docs', 'sftp', '/backup')).toBe('/backup/docs');
    });

    it('falls back to the target parent when the source has no base name', () => {
      expect(resolveDirSyncTargetRoot('/', 'sftp', '/backup')).toBe('/backup');
    });
  });

  describe('describeFido2StartupError', () => {
    const RAW = 'Provider "internal" returned failure -1: invalid format';
    const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value, configurable: true });
    const realPlatform = process.platform;
    afterEach(() => setPlatform(realPlatform));

    it('explains the blocked-PIN case on Linux instead of showing the raw ssh-add message', () => {
      setPlatform('linux');
      const msg = describeFido2StartupError(new Error(RAW));
      expect(msg).not.toBe(RAW);
      expect(msg).toMatch(/unplugged and reconnected/);
    });

    it('does not claim a cause it has not proven on Windows', () => {
      setPlatform('win32');
      const msg = describeFido2StartupError(new Error(RAW));
      expect(msg).not.toBe(RAW);
      expect(msg).toMatch(/Administrator/);
    });

    it('passes any other error message through', () => {
      expect(describeFido2StartupError(new Error('boom'))).toBe('boom');
      expect(describeFido2StartupError('plain')).toBe('plain');
    });
  });
});
