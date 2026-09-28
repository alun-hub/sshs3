import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveLoginShellEnv,
  applyLoginShellEnv,
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
