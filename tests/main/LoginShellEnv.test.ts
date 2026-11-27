import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveLoginShellEnv,
  applyLoginShellEnv,
  macGuiPath,
  _resetLoginShellEnvCache,
} from '../../src/main/ssh/LoginShellEnv';

describe('LoginShellEnv', () => {
  beforeEach(() => {
    _resetLoginShellEnvCache();
  });

  it('resolves a non-empty env object on non-Windows platforms', async () => {
    const env = await resolveLoginShellEnv();
    if (process.platform === 'win32') {
      expect(env).toEqual({});
      return;
    }
    expect(typeof env).toBe('object');
  });

  it('caches the resolved env across calls', async () => {
    const first = await resolveLoginShellEnv();
    const second = await resolveLoginShellEnv();
    expect(second).toBe(first);
  });

  it.runIf(process.platform === 'darwin')('reads PATH from the login shell on macOS', async () => {
    const env = await resolveLoginShellEnv();
    expect(env.PATH).toContain('/usr/bin');
  });

  it.runIf(process.platform !== 'win32')('leaves PATH alone outside macOS', async () => {
    const original = process.env.PATH;
    process.env.PATH = '/usr/bin:/bin';
    try {
      await applyLoginShellEnv('linux');
      expect(process.env.PATH).toBe('/usr/bin:/bin');
    } finally {
      process.env.PATH = original;
    }
  });

  it('never overwrites an already-set process.env value', async () => {
    const original = process.env.SSL_CERT_FILE;
    process.env.SSL_CERT_FILE = '/already/set.pem';
    try {
      await applyLoginShellEnv();
      expect(process.env.SSL_CERT_FILE).toBe('/already/set.pem');
    } finally {
      if (original === undefined) delete process.env.SSL_CERT_FILE;
      else process.env.SSL_CERT_FILE = original;
    }
  });
});

describe('macGuiPath', () => {
  const finderPath = '/usr/bin:/bin:/usr/sbin:/sbin';

  it('puts the login shell directories first and keeps the system ones', () => {
    expect(macGuiPath(finderPath, '/opt/homebrew/bin:/usr/bin:/bin')).toBe(
      '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
    );
  });

  it('uses the login shell PATH when there is no PATH at all', () => {
    expect(macGuiPath(undefined, '/opt/homebrew/bin')).toBe('/opt/homebrew/bin');
  });

  it('leaves a PATH from a terminal or set on purpose alone', () => {
    expect(macGuiPath(`/Users/me/bin:${finderPath}`, '/opt/homebrew/bin')).toBeUndefined();
  });

  it('drops empty and relative entries', () => {
    expect(macGuiPath(finderPath, ':.:bin:/opt/homebrew/bin:')).toBe(`/opt/homebrew/bin:${finderPath}`);
  });

  it('changes nothing when the login shell gives no usable PATH', () => {
    expect(macGuiPath(finderPath, undefined)).toBeUndefined();
    expect(macGuiPath(finderPath, '.:bin')).toBeUndefined();
  });
});
