import { describe, it, expect } from 'vitest';
import { buildBadgeRows, badgeTone, badgeTitle } from '../../src/renderer/src/lib/awsBadge';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const SSO = { startUrl: 'https://corp.awsapps.com/start', region: 'us-east-1', accountId: '123456789012', roleName: 'Dev' };
const ssmProfile = (sso = SSO, id = 'p1') => ({ id, name: id, host: 'i-0123456789abcdef0', username: 'u', authType: 'agent', ssm: { enabled: true, region: 'eu-north-1', sso } }) as unknown as SSHConnectionConfig;
const saved = { id: 'a', name: 'Corp', startUrl: SSO.startUrl, region: SSO.region };

describe('buildBadgeRows', () => {
  it('marks saved sign-ins that SSM profiles use and adds sign-ins only profiles know about', () => {
    const rows = buildBadgeRows({ awsSignIns: [saved, { id: 'b', name: 'Other', startUrl: 'https://other.awsapps.com/start', region: 'us-east-1' }] }, [
      ssmProfile(),
      ssmProfile({ ...SSO, startUrl: 'https://orphan.awsapps.com/start' }, 'p2'),
    ]);
    expect(rows.map((r) => [r.name, r.used])).toEqual([['Corp', true], ['Other', false], ['orphan.awsapps.com', true]]);
    expect(rows[2].id).toBe('profile:https://orphan.awsapps.com/start');
  });
  it('ignores profiles without SSM or without an SSO sign-in, and shows policy sign-ins first', () => {
    const plain = { id: 'x', name: 'x', host: 'h', username: 'u', authType: 'agent' } as SSHConnectionConfig;
    const cli = { ...ssmProfile(), ssm: { enabled: true as const, awsProfile: 'p' } } as SSHConnectionConfig;
    const rows = buildBadgeRows({ awsSignIns: [saved], awsManagedSignIns: 'Managed|https://m.awsapps.com/start|us-east-1' }, [plain, cli]);
    expect(rows.map((r) => [r.name, r.managed ?? false, r.used])).toEqual([['Managed', true, false], ['Corp', false, false]]);
  });
});

describe('badgeTone and title', () => {
  const rows = buildBadgeRows({ awsSignIns: [saved] }, [ssmProfile()]);
  it('is green when signed in, amber when a used sign-in lapsed, grey otherwise', () => {
    expect(badgeTone(rows, { a: { status: 'valid' } })).toBe('ok');
    expect(badgeTone(rows, { a: { status: 'expired' } })).toBe('attention');
    expect(badgeTone(rows, { a: { status: 'missing' } })).toBe('attention');
    expect(badgeTone(rows, {})).toBe('none'); // status not read yet
    const unused = buildBadgeRows({ awsSignIns: [saved] }, []);
    expect(badgeTone(unused, { a: { status: 'expired' } })).toBe('none'); // nothing depends on it
    expect(badgeTone(unused, { a: { status: 'valid' } })).toBe('ok');
    expect(badgeTone([], {})).toBe('none');
  });
  it('words each state', () => {
    expect(badgeTitle('attention', rows)).toMatch(/expired/);
    expect(badgeTitle('ok', rows)).toBe('AWS: signed in');
    expect(badgeTitle('none', [])).toBe('AWS: no sign-ins yet');
    expect(badgeTitle('none', rows)).toBe('AWS: not signed in');
  });
});
