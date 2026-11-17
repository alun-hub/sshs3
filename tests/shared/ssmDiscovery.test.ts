import { describe, it, expect } from 'vitest';
import { mapInstances, sanitizeAwsText } from '../../src/shared/ssm';
import { buildProfilesFromInstances, ssmFolder } from '../../src/shared/ssmProfileFactory';

const ID = 'i-0123456789abcdef0';
const SSO = { startUrl: 'https://d-1.awsapps.com/start', region: 'eu-north-1', accountId: '123456789012', roleName: 'Admin' };

describe('mapInstances', () => {
  it('maps tolerant records and drops entries without a valid instance id', () => {
    const out = mapInstances([
      { InstanceId: ID, ComputerName: 'web-1.internal', PlatformName: 'Ubuntu', PlatformType: 'Linux', IPAddress: '10.0.0.5', PingStatus: 'Online' },
      { InstanceId: 'mi-0123456789abcdef0' },
      { InstanceId: 'not-an-id', ComputerName: 'x' },
      { ComputerName: 'no id' },
    ]);
    expect(out.map((i) => i.instanceId)).toEqual([ID, 'mi-0123456789abcdef0']);
    expect(out[0]).toMatchObject({ name: 'web-1.internal', platformType: 'Linux', ipAddress: '10.0.0.5', pingStatus: 'Online' });
    expect(out[1].name).toBe('mi-0123456789abcdef0');
  });
  it('sanitises hostile strings and unknown enums', () => {
    const [i] = mapInstances([{ InstanceId: ID, ComputerName: 'a‮b\nc\u0000d ' + 'x'.repeat(200), PlatformType: 'Solaris', PingStatus: 'weird', IPAddress: '<script>' }]);
    expect([...i.name].some((c) => c === '\u202e' || c === '\n' || c === '\u0000')).toBe(false);
    expect(i.name.length).toBeLessThanOrEqual(80);
    expect(i.platformType).toBeUndefined();
    expect(i.pingStatus).toBeUndefined();
    expect(i.ipAddress).toBeUndefined();
  });
  it('sanitizeAwsText handles non-strings', () => {
    expect(sanitizeAwsText(undefined)).toBe('');
    expect(sanitizeAwsText(5)).toBe('');
  });
});

describe('buildProfilesFromInstances', () => {
  const instances = mapInstances([{ InstanceId: ID, ComputerName: 'web-1' }, { InstanceId: 'i-0123456789abcdef1' }]);
  it('builds one SSM profile per instance in the account/region folder', () => {
    let n = 0;
    const out = buildProfilesFromInstances(instances, { sso: SSO, region: 'eu-north-1', username: 'ec2-user', newId: () => `id${++n}` });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'id1', name: 'web-1', host: ID, username: 'ec2-user', authType: 'agent', group: 'AWS/123456789012/eu-north-1' });
    expect(out[0].ssm).toEqual({ enabled: true, region: 'eu-north-1', sso: SSO });
    expect(out[0].ssm!.sso).not.toBe(SSO);
    expect(out[1].name).toBe('i-0123456789abcdef1');
    expect(ssmFolder(SSO, 'eu-north-1')).toBe('AWS/123456789012/eu-north-1');
  });
  it('skips instances that already have a profile and duplicates', () => {
    const out = buildProfilesFromInstances([...instances, ...instances], { sso: SSO, region: 'eu-north-1', username: 'u', existing: new Set([ID]) });
    expect(out.map((p) => p.host)).toEqual(['i-0123456789abcdef1']);
  });
});
