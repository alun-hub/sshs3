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

import { ssmProblem } from '../../src/renderer/src/lib/ssmProfile';
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
