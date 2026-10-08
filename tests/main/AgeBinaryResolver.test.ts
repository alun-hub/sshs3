import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/app'),
  },
}));

import { resolveAgeBinary } from '../../src/main/services/AgeBinaryResolver';

function setPlatform(platform: 'win32' | 'linux') {
  Object.defineProperty(process, 'platform', { value: platform });
}

function setResourcesPath(value: string | undefined) {
  Object.defineProperty(process, 'resourcesPath', { value, configurable: true });
}

describe('resolveAgeBinary', () => {
  const origPlatform = process.platform;
  const origResourcesPath = (process as any).resourcesPath;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    setPlatform(origPlatform as 'win32' | 'linux');
    setResourcesPath(origResourcesPath);
  });

  it('prefers the packaged extraResources copy when it exists', () => {
    setPlatform('linux');
    setResourcesPath('/packaged/resources');
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (p) => p === path.join('/packaged/resources', 'age', 'age')
    );

    expect(resolveAgeBinary('age')).toBe(path.join('/packaged/resources', 'age', 'age'));
  });

  it('falls back to the dev build-resources copy when nothing is bundled', () => {
    setPlatform('linux');
    setResourcesPath('/packaged/resources');
    const devPath = path.join('/app', 'build-resources', 'age', 'linux', 'age-plugin-yubikey');
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === devPath);

    expect(resolveAgeBinary('age-plugin-yubikey')).toBe(devPath);
  });

  it('falls back to the bare command name when nothing is found anywhere', () => {
    setPlatform('linux');
    setResourcesPath('/packaged/resources');
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(resolveAgeBinary('age')).toBe('age');
  });

  it('appends .exe and looks under the win platform dir on Windows', () => {
    setPlatform('win32');
    setResourcesPath('/packaged/resources');
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (p) => p === path.join('/packaged/resources', 'age', 'age.exe')
    );

    expect(resolveAgeBinary('age')).toBe(path.join('/packaged/resources', 'age', 'age.exe'));
  });

  it('falls back to the bare command name when resourcesPath is unset (unpackaged)', () => {
    setPlatform('linux');
    setResourcesPath(undefined);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(resolveAgeBinary('age')).toBe('age');
  });
});
