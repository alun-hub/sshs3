import { describe, it, expect } from 'vitest';
import {
  parseManagedSignIns, allSignIns, sanitizeSignIns, parseRegionList, parseHttpsProxy, awsNetworkToOptions, awsNetworkEnv,
} from '../../src/shared/awsSignIns';

describe('parseManagedSignIns', () => {
  it('reads Name|url|region entries separated by ; or newlines and locks them', () => {
    const { items, warnings } = parseManagedSignIns('Corp|https://corp.awsapps.com/start|us-east-1; Dev|https://d-1.awsapps.com/start#/|eu-north-1\nCorp|https://other.awsapps.com/start|us-east-1');
    expect(warnings).toEqual([]);
    expect(items.map((i) => [i.name, i.startUrl, i.region, i.managed])).toEqual([
      ['Corp', 'https://corp.awsapps.com/start', 'us-east-1', true],
      ['Dev', 'https://d-1.awsapps.com/start', 'eu-north-1', true],
      ['Corp', 'https://other.awsapps.com/start', 'us-east-1', true],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });
  it('drops bad entries with a warning and keeps the rest', () => {
    const { items, warnings } = parseManagedSignIns('ok|https://a.awsapps.com/start|us-east-1;nourl;|https://x.com/s|us-east-1;http://evil.com|x|us-east-1;n|https://a.awsapps.com/start\nline|https://a.awsapps.com/s|us-east-1|extra');
    expect(items).toHaveLength(1);
    expect(warnings).toHaveLength(5);
    expect(parseManagedSignIns(undefined)).toEqual({ items: [], warnings: [] });
  });
  it('limits the number of entries', () => {
    const many = Array.from({ length: 60 }, (_, i) => `n${i}|https://d-${i}.awsapps.com/start|us-east-1`).join(';');
    const r = parseManagedSignIns(many);
    expect(r.items).toHaveLength(50);
    expect(r.warnings.join()).toMatch(/first 50/);
  });
});

describe('sign-in lists', () => {
  const own = [{ id: 'a', name: 'Mine', startUrl: 'https://mine.awsapps.com/start', region: 'us-east-1' }];
  it('puts policy sign-ins first and hides a duplicate of the same start URL and region', () => {
    const merged = allSignIns([...own, { id: 'b', name: 'Dup', startUrl: 'https://corp.awsapps.com/start', region: 'us-east-1' }], 'Corp|https://corp.awsapps.com/start|us-east-1');
    expect(merged.map((m) => m.name)).toEqual(['Corp', 'Mine']);
  });
  it('sanitises a list read from a settings file', () => {
    const list = sanitizeSignIns([
      { id: 'managed-evil', name: 'x', startUrl: 'https://a.awsapps.com/start', region: 'us-east-1', managed: true, lastAccountId: '123456789012', lastRoleName: 'Dev', extra: 1 },
      { name: '', startUrl: 'https://a.awsapps.com/start', region: 'us-east-1' },
      { name: 'bad', startUrl: 'javascript:alert(1)', region: 'us-east-1' },
      { name: 'neg', startUrl: 'https://b.awsapps.com/start', region: 'nope' },
      { id: 'dup', name: 'one', startUrl: 'https://c.awsapps.com/start', region: 'us-east-1', lastAccountId: '12' },
      { id: 'dup', name: 'two', startUrl: 'https://d.awsapps.com/start', region: 'us-east-1' },
      'nope', null,
    ]);
    expect(list).toHaveLength(3);
    expect(list[0].id.startsWith('managed-')).toBe(false);
    expect(list[0]).not.toHaveProperty('managed');
    expect(list[0]).not.toHaveProperty('extra');
    expect(list[0]).toMatchObject({ lastAccountId: '123456789012', lastRoleName: 'Dev' });
    expect(list[1].lastAccountId).toBeUndefined();
    expect(new Set(list.map((l) => l.id)).size).toBe(3);
    expect(sanitizeSignIns('x')).toEqual([]);
  });
});

describe('regions and network', () => {
  it('parses region lists', () => {
    expect(parseRegionList('eu-north-1, eu-west-1;eu-north-1 nope')).toEqual(['eu-north-1', 'eu-west-1']);
    expect(parseRegionList(undefined)).toEqual([]);
  });
  it('accepts only credential-free http(s) proxies', () => {
    expect(parseHttpsProxy('http://proxy.corp:3128')).toEqual({ host: 'proxy.corp', port: 3128, secure: false });
    expect(parseHttpsProxy('https://proxy.corp')).toEqual({ host: 'proxy.corp', port: 443, secure: true });
    for (const bad of ['', 'socks5://p:1', 'http://user:pw@p:1', 'http://p:1/path', 'ftp://p', 'nonsense', 'http://p:99999']) expect(parseHttpsProxy(bad)).toBeUndefined();
  });
  it('maps settings to sshs3 options and CLI environment without secrets', () => {
    const net = { httpsProxy: 'http://proxy.corp:3128', customCaPath: '/etc/corp-ca.pem', rejectUnauthorized: true };
    expect(awsNetworkToOptions(net)).toEqual({ customCaPath: '/etc/corp-ca.pem', rejectUnauthorized: true, proxy: { enabled: true, type: 'http', host: 'proxy.corp', port: 3128 } });
    expect(awsNetworkToOptions(undefined)).toEqual({ customCaPath: undefined, rejectUnauthorized: undefined, proxy: undefined });
    expect(awsNetworkEnv(net)).toEqual({ HTTPS_PROXY: 'http://proxy.corp:3128', AWS_CA_BUNDLE: '/etc/corp-ca.pem' });
    expect(awsNetworkEnv({ httpsProxy: 'http://user:pw@p:1' })).toEqual({});
    expect(awsNetworkEnv({ customCaPath: 'relative/ca.pem' })).toEqual({});
    expect(awsNetworkEnv({ customCaPath: 'C:\\certs\\ca.pem' })).toEqual({ AWS_CA_BUNDLE: 'C:\\certs\\ca.pem' });
    expect(awsNetworkEnv(undefined)).toEqual({});
  });
});
