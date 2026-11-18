import { describe, it, expect } from 'vitest';
import { ssoTargets, profileTargets, defaultTargets, initialRegions, takenNamesByFolder, alreadyAdded, buildPickItems, parseAccountIds } from '../../src/renderer/src/lib/awsGuide';
import { buildProfilesFromPicks, ssmConfigForSource } from '../../src/shared/ssmProfileFactory';
import type { ScannedInstance, AwsScanTarget } from '../../src/shared/types/awsScan';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const SSO = { startUrl: 'https://corp.awsapps.com/start', region: 'us-east-1' };
const accounts = [{ accountId: '111111111111', accountName: 'Prod' }, { accountId: '222222222222' }, { accountId: '333333333333', accountName: 'Dev' }];
const inst = (id: string, over: Partial<ScannedInstance> = {}): ScannedInstance => ({ instanceId: `i-${id.padStart(17, '0')}`, name: 'web', region: 'eu-north-1', targetId: 'acct-111111111111', platformName: 'Amazon Linux', ...over });

describe('targets', () => {
  it('builds one SSO target per selected account with the same role', () => {
    const t = ssoTargets(SSO, accounts, new Set(['111111111111', '222222222222']), 'Dev');
    expect(t.map((x) => [x.id, x.label])).toEqual([['acct-111111111111', 'Prod'], ['acct-222222222222', '222222222222']]);
    expect(t[0].source).toEqual({ kind: 'sso', sso: { ...SSO, accountId: '111111111111', roleName: 'Dev' } });
  });
  it('builds profile and default targets', () => {
    expect(profileTargets(['corp', 'keys']).map((t) => [t.id, t.source])).toEqual([['profile-corp', { kind: 'profile', name: 'corp' }], ['profile-keys', { kind: 'profile', name: 'keys' }]]);
    expect(defaultTargets()[0].source).toEqual({ kind: 'default' });
  });
});

describe('regions and existing profiles', () => {
  it('preselects the configured regions, else the sign-in region', () => {
    expect(initialRegions('eu-north-1, eu-west-1', 'us-east-1')).toEqual(['eu-north-1', 'eu-west-1']);
    expect(initialRegions('', 'us-east-1')).toEqual(['us-east-1']);
    expect(initialRegions(undefined, undefined)).toEqual([]);
  });
  it('knows names per folder and instances that already have a profile', () => {
    const profiles = [
      { id: '1', name: 'web', host: 'i-0000000000000000a', username: 'u', authType: 'agent', group: 'AWS/Prod/eu-north-1', ssm: { enabled: true } },
      { id: '2', name: 'x', host: 'h', username: 'u', authType: 'agent' },
    ] as unknown as SSHConnectionConfig[];
    expect([...takenNamesByFolder(profiles).get('AWS/Prod/eu-north-1')!]).toEqual(['web']);
    expect([...alreadyAdded(profiles)]).toEqual(['i-0000000000000000a']);
  });
});

describe('buildPickItems and profiles', () => {
  const targets = new Map<string, AwsScanTarget>([
    ['acct-111111111111', { id: 'acct-111111111111', label: 'Prod', accountName: 'Prod', accountId: '111111111111', source: { kind: 'sso', sso: { ...SSO, accountId: '111111111111', roleName: 'Dev' } } }],
    ['profile-keys', { id: 'profile-keys', label: 'keys', source: { kind: 'profile', name: 'keys' } }],
  ]);
  const chosen = [inst('1'), inst('2'), inst('3', { name: 'db', platformName: 'Ubuntu' }), inst('4', { targetId: 'profile-keys', region: 'us-east-1', name: 'solo' })];

  it('puts instances in AWS/<account>/<region>, makes names unique per folder and suggests logins', () => {
    const items = buildPickItems(chosen, targets, { [inst('2').instanceId]: ' deploy ' }, new Map([['AWS/Prod/eu-north-1', new Set(['db'])]]));
    const by = Object.fromEntries(items.map((i) => [i.instance.instanceId, i]));
    expect(by[inst('1').instanceId]).toMatchObject({ folder: 'AWS/Prod/eu-north-1', name: `web (${inst('1').instanceId})`, username: 'ec2-user' });
    expect(by[inst('2').instanceId].username).toBe('deploy');
    expect(by[inst('3').instanceId]).toMatchObject({ name: `db (${inst('3').instanceId})`, username: 'ubuntu' }); // 'db' already taken in that folder
    expect(by[inst('4').instanceId]).toMatchObject({ folder: 'AWS/keys/us-east-1', name: 'solo' });
  });

  it('creates SSM profiles for each credential source and skips existing ones', () => {
    const items = buildPickItems(chosen, targets, {});
    let n = 0;
    const profiles = buildProfilesFromPicks(items, { existing: new Set([inst('2').instanceId]), newId: () => `id${++n}` });
    expect(profiles).toHaveLength(3);
    const sso = profiles.find((p) => p.host === inst('1').instanceId)!;
    expect(sso).toMatchObject({ authType: 'agent', port: 22, group: 'AWS/Prod/eu-north-1' });
    expect(sso.ssm).toEqual({ enabled: true, region: 'eu-north-1', sso: { ...SSO, accountId: '111111111111', roleName: 'Dev' } });
    expect(profiles.find((p) => p.host === inst('4').instanceId)!.ssm).toEqual({ enabled: true, region: 'us-east-1', awsProfile: 'keys' });
    expect(ssmConfigForSource({ kind: 'default' }, 'eu-north-1')).toEqual({ enabled: true, region: 'eu-north-1' });
  });

  it('ignores instances whose target is unknown', () => {
    expect(buildPickItems([inst('9', { targetId: 'gone' })], targets, {})).toEqual([]);
  });
});

describe('parseAccountIds', () => {
  it('reads 12-digit ids separated by commas, spaces or newlines, once each', () => {
    expect(parseAccountIds('123456789012, 210987654321;123456789012\nabc 12345 1234567890123').map((a) => a.accountId)).toEqual(['123456789012', '210987654321']);
    expect(parseAccountIds('')).toEqual([]);
  });
});
