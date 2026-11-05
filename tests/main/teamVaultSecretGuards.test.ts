import { describe, it, expect } from 'vitest';
import {
  guardS3SecretWrite,
  guardSshSecretWrite,
  hasSshSecret,
  isSecretChangeAttempt,
  redactS3Secrets,
  redactSshSecrets,
  s3RoutingChanged,
  sshRoutingChanged,
  withoutPin,
} from '../../src/main/services/teamVaultSecretGuards';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';
import type { S3Config } from '../../src/shared/types/storage';

const ssh = (overrides: Partial<SSHConnectionConfig> = {}): SSHConnectionConfig => ({
  id: 'p1',
  name: 'prod-db',
  host: 'db.example.com',
  username: 'root',
  authType: 'password',
  ...overrides,
});

const s3 = (overrides: Partial<S3Config> = {}): S3Config => ({
  id: 'b1',
  name: 'backups',
  region: 'eu-north-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'real-secret', // pragma: allowlist secret
  ...overrides,
});

const proxy = (overrides: Partial<NonNullable<SSHConnectionConfig['proxy']>> = {}) => ({
  enabled: true,
  type: 'socks5' as const,
  host: 'proxy.example.com',
  port: 1080,
  ...overrides,
});

const ADMIN_ONLY_SSH = 'Only a Team Vault admin can set or change a profile password, or where it connects';
const ADMIN_ONLY_S3 = 'Only a Team Vault admin can set or change a profile secret key, or where it connects';

describe('withoutPin', () => {
  it('drops the PIN and keeps everything else', () => {
    expect(withoutPin(ssh({ pin: '123456', pkcs11LibPath: '/lib/x.so' }))).toEqual(ssh({ pkcs11LibPath: '/lib/x.so' }));
  });

  it('returns the same object when there is no PIN to drop', () => {
    const profile = ssh();
    expect(withoutPin(profile)).toBe(profile);
  });
});

describe('isSecretChangeAttempt', () => {
  it.each([
    ['a new value over no stored value', 'new', undefined, true],
    ['a different value over a stored one', 'new', 'old', true],
    ['the stored value sent back unchanged', 'same', 'same', false],
    ['an empty/redacted value', '', 'old', false],
    ['no value at all', undefined, 'old', false],
    ['nothing on either side', undefined, undefined, false],
  ])('%s', (_label, incoming, existing, expected) => {
    expect(isSecretChangeAttempt(incoming, existing)).toBe(expected);
  });
});

describe('hasSshSecret', () => {
  it('is true for a password, a passphrase or a proxy password', () => {
    expect(hasSshSecret(ssh({ password: 'x' }))).toBe(true);
    expect(hasSshSecret(ssh({ passphrase: 'x' }))).toBe(true);
    expect(hasSshSecret(ssh({ proxy: proxy({ password: 'x' }) }))).toBe(true);
  });

  it('is false with no secret, or no profile', () => {
    expect(hasSshSecret(ssh())).toBe(false);
    expect(hasSshSecret(ssh({ proxy: proxy() }))).toBe(false);
    expect(hasSshSecret(undefined)).toBe(false);
  });
});

describe('redactSshSecrets', () => {
  it('removes password and passphrase and reports that one is set', () => {
    const result = redactSshSecrets(ssh({ password: 'pw', passphrase: 'pp' }));
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('passphrase');
    expect(result.hasPassword).toBe(true);
  });

  it('counts a passphrase alone as "a secret is set"', () => {
    expect(redactSshSecrets(ssh({ passphrase: 'pp' })).hasPassword).toBe(true);
  });

  it('reports no secret when there is none', () => {
    expect(redactSshSecrets(ssh()).hasPassword).toBe(false);
  });

  it('removes the proxy password but keeps the rest of the proxy', () => {
    const result = redactSshSecrets(ssh({ proxy: proxy({ password: 'proxy-pw' }) }));
    expect(result.proxy?.password).toBeUndefined();
    expect(result.proxy?.hasPassword).toBe(true);
    expect(result.proxy).toMatchObject({ host: 'proxy.example.com', port: 1080 });
  });

  it('leaks no secret value anywhere in the serialised result', () => {
    const result = redactSshSecrets(ssh({ password: 'S3CRET-1', passphrase: 'S3CRET-2', proxy: proxy({ password: 'S3CRET-3' }) }));
    expect(JSON.stringify(result)).not.toContain('S3CRET');
  });
});

describe('redactS3Secrets', () => {
  it('blanks the secret key and removes the session token', () => {
    const result = redactS3Secrets(s3({ sessionToken: 'tok' }));
    expect(result.secretAccessKey).toBe('');
    expect(result).not.toHaveProperty('sessionToken');
    expect(result.hasSecretAccessKey).toBe(true);
  });

  it('reports no secret when there is none', () => {
    expect(redactS3Secrets(s3({ secretAccessKey: '' })).hasSecretAccessKey).toBe(false);
  });

  it('removes the proxy password, which is easy to miss', () => {
    const result = redactS3Secrets(s3({ proxy: proxy({ password: 'proxy-pw' }) }));
    expect(result.proxy?.password).toBeUndefined();
    expect(result.proxy?.hasPassword).toBe(true);
  });

  it('keeps non-secret fields', () => {
    expect(redactS3Secrets(s3({ endpoint: 'https://s3.example.com' }))).toMatchObject({
      accessKeyId: 'AKIAEXAMPLE',
      region: 'eu-north-1',
      endpoint: 'https://s3.example.com',
    });
  });

  it('leaks no secret value anywhere in the serialised result', () => {
    const result = redactS3Secrets(s3({ secretAccessKey: 'S3CRET-1', sessionToken: 'S3CRET-2', proxy: proxy({ password: 'S3CRET-3' }) }));
    expect(JSON.stringify(result)).not.toContain('S3CRET');
  });
});

describe('sshRoutingChanged', () => {
  const base = ssh({ proxy: proxy() });

  it('is false for an identical profile', () => {
    expect(sshRoutingChanged({ ...base }, base)).toBe(false);
  });

  it('treats a missing port as the default 22', () => {
    expect(sshRoutingChanged(ssh({ port: 22 }), ssh())).toBe(false);
    expect(sshRoutingChanged(ssh({ port: 2222 }), ssh())).toBe(true);
  });

  it.each<[string, Partial<SSHConnectionConfig>]>([
    ['host', { host: 'evil.example.com' }],
    ['username', { username: 'someone-else' }],
    ['authType', { authType: 'agent' }],
    ['proxyJump', { proxyJump: 'jump.example.com' }],
    ['proxyJumpProfileId', { proxyJumpProfileId: 'other-profile' }],
    ['proxy host', { proxy: proxy({ host: 'evil-proxy.example.com' }) }],
    ['proxy port', { proxy: proxy({ port: 9999 }) }],
    ['proxy type', { proxy: proxy({ type: 'http' }) }],
    ['proxy username', { proxy: proxy({ username: 'someone' }) }],
    ['proxy enabled flag', { proxy: proxy({ enabled: false }) }],
  ])('detects a changed %s', (_label, change) => {
    expect(sshRoutingChanged({ ...base, ...change }, base)).toBe(true);
  });

  it('ignores fields that do not decide where the connection goes', () => {
    expect(sshRoutingChanged({ ...base, name: 'renamed', group: 'other', tags: ['x'] }, base)).toBe(false);
  });
});

describe('s3RoutingChanged', () => {
  const base = s3({ endpoint: 'https://s3.example.com', proxy: proxy() });

  it('is false for an identical profile', () => {
    expect(s3RoutingChanged({ ...base }, base)).toBe(false);
  });

  it.each<[string, Partial<S3Config>]>([
    ['endpoint', { endpoint: 'https://evil.example.com' }],
    ['region', { region: 'us-east-1' }],
    ['forcePathStyle', { forcePathStyle: true }],
    ['accessKeyId', { accessKeyId: 'AKIAOTHER' }],
    ['customCaPath', { customCaPath: '/tmp/their-ca.pem' }],
    ['proxy host', { proxy: proxy({ host: 'evil-proxy.example.com' }) }],
    ['proxy port', { proxy: proxy({ port: 9999 }) }],
    ['proxy enabled flag', { proxy: proxy({ enabled: false }) }],
  ])('detects a changed %s', (_label, change) => {
    expect(s3RoutingChanged({ ...base, ...change }, base)).toBe(true);
  });

  it('treats disabling certificate validation as a change, not just the endpoint', () => {
    expect(s3RoutingChanged({ ...base, rejectUnauthorized: false }, base)).toBe(true);
  });

  it('tells "unset" (validates by default) apart from an explicit true', () => {
    expect(s3RoutingChanged({ ...base, rejectUnauthorized: true }, base)).toBe(true);
  });
});

describe('guardSshSecretWrite', () => {
  const stored = ssh({ password: 'stored-pw', passphrase: 'stored-pp', proxy: proxy({ password: 'stored-proxy-pw' }) });

  it.each<[string, Partial<SSHConnectionConfig>]>([
    ['password', { password: 'attacker-pw' }], // pragma: allowlist secret
    ['passphrase', { passphrase: 'attacker-pp' }],
    ['proxy password', { proxy: proxy({ password: 'attacker-proxy-pw' }) }],
  ])('rejects a changed %s', (_label, change) => {
    expect(() => guardSshSecretWrite({ ...stored, ...change }, stored)).toThrow(ADMIN_ONLY_SSH);
  });

  it('rejects repointing a profile that holds a secret (exfiltration path)', () => {
    const redactedCopy = { ...redactSshSecrets(stored), host: 'attacker.example.com' };
    expect(() => guardSshSecretWrite(redactedCopy, stored)).toThrow(ADMIN_ONLY_SSH);
  });

  it('rejects changing the proxy a secret-holding profile goes through', () => {
    const redactedCopy = redactSshSecrets(stored);
    expect(() =>
      guardSshSecretWrite({ ...redactedCopy, proxy: { ...redactedCopy.proxy!, host: 'attacker-proxy.example.com' } }, stored)
    ).toThrow(ADMIN_ONLY_SSH);
  });

  it('keeps the stored secrets when the member sends back the redacted copy', () => {
    const redactedCopy = { ...redactSshSecrets(stored), name: 'renamed' };
    const result = guardSshSecretWrite(redactedCopy, stored);
    expect(result.name).toBe('renamed');
    expect(result.password).toBe('stored-pw');
    expect(result.passphrase).toBe('stored-pp');
    expect(result.proxy?.password).toBe('stored-proxy-pw');
  });

  it('still lets a member change routing on a profile that holds no secret', () => {
    const noSecret = ssh({ proxy: proxy() });
    const result = guardSshSecretWrite({ ...noSecret, host: 'new-host.example.com', port: 2222 }, noSecret);
    expect(result.host).toBe('new-host.example.com');
    expect(result.port).toBe(2222);
  });

  it('rejects a member creating a profile with a secret of their own', () => {
    expect(() => guardSshSecretWrite(ssh({ password: 'mine' }), undefined)).toThrow(ADMIN_ONLY_SSH); // pragma: allowlist secret
  });

  it('accepts a new secret-less profile and leaves the secret fields empty', () => {
    const result = guardSshSecretWrite(ssh(), undefined);
    expect(result.password).toBeUndefined();
    expect(result.passphrase).toBeUndefined();
  });
});

describe('guardS3SecretWrite', () => {
  const stored = s3({ endpoint: 'https://s3.example.com', sessionToken: 'stored-token', proxy: proxy({ password: 'stored-proxy-pw' }) });

  it.each<[string, Partial<S3Config>]>([
    ['secret key', { secretAccessKey: 'attacker-key' }], // pragma: allowlist secret
    ['session token', { sessionToken: 'attacker-token' }],
    ['proxy password', { proxy: proxy({ password: 'attacker-proxy-pw' }) }],
  ])('rejects a changed %s', (_label, change) => {
    expect(() => guardS3SecretWrite({ ...stored, ...change }, stored)).toThrow(ADMIN_ONLY_S3);
  });

  it('rejects a new endpoint on a profile that holds a secret', () => {
    const redactedCopy = { ...redactS3Secrets(stored), endpoint: 'https://attacker.example.com' };
    expect(() => guardS3SecretWrite(redactedCopy, stored)).toThrow(ADMIN_ONLY_S3);
  });

  it('rejects switching off certificate validation on a profile that holds a secret', () => {
    const redactedCopy = { ...redactS3Secrets(stored), rejectUnauthorized: false };
    expect(() => guardS3SecretWrite(redactedCopy, stored)).toThrow(ADMIN_ONLY_S3);
  });

  it('keeps the stored secrets when the member sends back the redacted copy', () => {
    const redactedCopy = { ...redactS3Secrets(stored), name: 'renamed' };
    const result = guardS3SecretWrite(redactedCopy, stored);
    expect(result.name).toBe('renamed');
    expect(result.secretAccessKey).toBe('real-secret');
    expect(result.sessionToken).toBe('stored-token');
    expect(result.proxy?.password).toBe('stored-proxy-pw');
  });

  it('still lets a member change the endpoint on a profile that holds no secret', () => {
    const noSecret = s3({ secretAccessKey: '', endpoint: 'https://s3.example.com' });
    const result = guardS3SecretWrite({ ...noSecret, endpoint: 'https://other.example.com' }, noSecret);
    expect(result.endpoint).toBe('https://other.example.com');
  });

  it('rejects a member creating a profile with a secret of their own', () => {
    expect(() => guardS3SecretWrite(s3({ secretAccessKey: 'mine' }), undefined)).toThrow(ADMIN_ONLY_S3); // pragma: allowlist secret
  });
});
