import { describe, it, expect } from 'vitest';
import { withSsm, hostIsValid } from '../../src/renderer/src/lib/ssmProfile';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const base = { id: 'a', name: 'n', host: 'i-0123456789abcdef0', username: 'u', authType: 'agent', proxyJump: 'a@b', proxy: { enabled: true, type: 'http', host: 'p', port: 1 } } as unknown as SSHConnectionConfig;

describe('ssmProfile', () => {
  it('drops proxy and jump host when SSM is enabled, keeps them when cleared', () => {
    const on = withSsm(base, { enabled: true });
    expect(on.proxy).toBeUndefined();
    expect(on.proxyJump).toBeUndefined();
    expect(withSsm(base, undefined).proxyJump).toBe('a@b');
  });
  it('requires an instance id with SSM', () => {
    expect(hostIsValid({ host: 'example.com' })).toBe(true);
    expect(hostIsValid({ host: 'example.com', ssm: { enabled: true } })).toBe(false);
    expect(hostIsValid({ host: 'i-0123456789abcdef0', ssm: { enabled: true } })).toBe(true);
    expect(hostIsValid({ host: ' ' })).toBe(false);
  });
});

import { ssmProblem, usernameOk, profileTarget } from '../../src/renderer/src/lib/ssmProfile';
describe('ssmProblem', () => {
  const host = 'i-0123456789abcdef0';
  it('flags settings the connect path would refuse', () => {
    expect(ssmProblem({ host })).toBeUndefined();
    expect(ssmProblem({ host, ssm: { enabled: true } })).toBeUndefined();
    expect(ssmProblem({ host, ssm: { enabled: true, awsProfile: '' } })).toMatch(/profile/);
    expect(ssmProblem({ host, ssm: { enabled: true, region: 'nope' } })).toMatch(/region/);
    const sso = { startUrl: 'https://d-1.awsapps.com/start', region: 'eu-north-1' };
    expect(ssmProblem({ host, ssm: { enabled: true, sso } })).toMatch(/region of the instance/);
    expect(ssmProblem({ host, ssm: { enabled: true, region: 'eu-west-1', sso } })).toMatch(/account ID and role/);
    expect(ssmProblem({ host, ssm: { enabled: true, region: 'eu-west-1', sso: { ...sso, accountId: '123456789012', roleName: 'Admin' } } })).toBeUndefined();
  });
});

import { trimProfileFields } from '../../src/renderer/src/lib/ssmProfile';
describe('trimProfileFields', () => {
  it('drops pasted whitespace from host and username so the saved value passes the connect-time check', () => {
    const out = trimProfileFields({ host: ' i-0123456789abcdef0\n', username: ' ec2-user ', port: 22 });
    expect(out).toEqual({ host: 'i-0123456789abcdef0', username: 'ec2-user', port: 22 });
  });
});

describe('ssmProblem with a jump host or proxy', () => {
  const host = 'i-0123456789abcdef0';
  it('flags the combination the connect path refuses, even when it was switched on after SSM', () => {
    expect(ssmProblem({ host, ssm: { enabled: true }, proxyJump: 'a@b' })).toMatch(/Turn off the jump host and the outgoing proxy/);
    expect(ssmProblem({ host, ssm: { enabled: true }, proxyJumpProfileId: 'x' })).toMatch(/jump host/);
    expect(ssmProblem({ host, ssm: { enabled: true }, proxy: { enabled: true, type: 'http', host: 'p', port: 1 } })).toMatch(/proxy/);
    expect(ssmProblem({ host, ssm: { enabled: true }, proxy: { enabled: false, type: 'http', host: 'p', port: 1 }, proxyJump: ' ' })).toBeUndefined();
    expect(hostIsValid({ host, ssm: { enabled: true }, proxyJump: 'a@b' })).toBe(false);
    expect(hostIsValid({ host: 'example.com', proxyJump: 'a@b' })).toBe(true); // not an SSM profile
  });
});

describe('Session Manager shell profiles', () => {
  it('need no SSH username, and every other profile still does', () => {
    expect(usernameOk({ username: '', ssm: { enabled: true, mode: 'shell' } })).toBe(true);
    expect(usernameOk({ username: '', ssm: { enabled: true } })).toBe(false);
    expect(usernameOk({ username: ' ' })).toBe(false);
    expect(usernameOk({ username: 'u' })).toBe(true);
  });
  it('shows what a shell profile is instead of user@host', () => {
    const p = { username: 'ssm-user', host: 'i-0123456789abcdef0', port: 22, authType: 'agent' as const };
    expect(profileTarget({ ...p, ssm: { enabled: true, mode: 'shell' } }, ' · agent')).toBe('Session Manager shell · i-0123456789abcdef0 · agent');
    expect(profileTarget(p, ' · agent')).toBe('ssm-user@i-0123456789abcdef0:22 · agent');
    expect(profileTarget({ ...p, ssm: { enabled: true } }, '')).toBe('ssm-user@i-0123456789abcdef0:22');
  });
});
