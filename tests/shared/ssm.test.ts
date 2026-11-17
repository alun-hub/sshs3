import { describe, it, expect } from 'vitest';
import {
  isValidRegion, isValidAwsProfile, isValidInstanceId, isValidSsoConfig, validateSsmConfig,
  compareVersions, parseToolVersion, suggestLoginName, MIN_PLUGIN_VERSION,
} from '../../src/shared/ssm';

describe('ssm validators', () => {
  it('accepts instance ids and rejects shell payloads', () => {
    expect(isValidInstanceId('i-0123456789abcdef0')).toBe(true);
    expect(isValidInstanceId('i-01234567')).toBe(true);
    expect(isValidInstanceId('mi-0123456789abcdef0')).toBe(true);
    for (const bad of ['', 'i-123', 'i-0123456789abcdef0; rm -rf /', '-i-01234567', 'i-0123456789abcdef0\n', '$(id)', 'host.example.com', undefined, 5]) {
      expect(isValidInstanceId(bad)).toBe(false);
    }
  });
  it('validates regions', () => {
    for (const ok of ['eu-north-1', 'us-east-1', 'ap-southeast-2', 'us-gov-west-1']) expect(isValidRegion(ok)).toBe(true);
    for (const bad of ['', 'eu-north', 'EU-NORTH-1', 'us-east-1 --profile x', 'us-east-1;id', '-region']) expect(isValidRegion(bad)).toBe(false);
  });
  it('validates profile names', () => {
    expect(isValidAwsProfile('prod.admin-1')).toBe(true);
    for (const bad of ['', '-x', 'a b', 'a;b', '$(x)', 'a"b', "a'b", 'a%b', 'a\nb', 'x'.repeat(129)]) expect(isValidAwsProfile(bad)).toBe(false);
  });
  it('validates SSO config', () => {
    const ok = { startUrl: 'https://d-123.awsapps.com/start', region: 'eu-north-1', accountId: '123456789012', roleName: 'Admin_1' };
    expect(isValidSsoConfig(ok)).toBe(true);
    expect(isValidSsoConfig({ ...ok, startUrl: 'http://x.com/start' })).toBe(false);
    expect(isValidSsoConfig({ ...ok, startUrl: 'https://x.com/a\ncredential_process = id' })).toBe(false);
    expect(isValidSsoConfig({ ...ok, roleName: 'Admin\ncredential_process=touch x' })).toBe(false);
    expect(isValidSsoConfig({ ...ok, roleName: 'a b' })).toBe(false);
    expect(isValidSsoConfig({ ...ok, accountId: '12345' })).toBe(false);
    expect(isValidSsoConfig({ ...ok, region: 'x]' })).toBe(false);
    expect(isValidSsoConfig(null)).toBe(false);
  });
  it('validateSsmConfig reports the first problem', () => {
    expect(validateSsmConfig({ enabled: true }, 'i-0123456789abcdef0')).toBeUndefined();
    expect(validateSsmConfig({ enabled: true }, 'example.com')).toMatch(/Instance ID/);
    expect(validateSsmConfig({ enabled: true, region: 'bad' }, 'i-0123456789abcdef0')).toMatch(/region/);
    expect(validateSsmConfig({ enabled: true, awsProfile: 'a', sso: { startUrl: 'https://x.com/s', region: 'eu-north-1' } }, 'i-0123456789abcdef0')).toMatch(/not both/);
  });
});

describe('version helpers', () => {
  it('compares versions', () => {
    expect(compareVersions('1.2.707.0', MIN_PLUGIN_VERSION)).toBeGreaterThan(0);
    expect(compareVersions('1.1.23.0', MIN_PLUGIN_VERSION)).toBe(0);
    expect(compareVersions('1.1.9', MIN_PLUGIN_VERSION)).toBeLessThan(0);
  });
  it('parses tool output', () => {
    expect(parseToolVersion('1.2.707.0\n')).toBe('1.2.707.0');
    expect(parseToolVersion('aws-cli/2.38.0 Python/3.15.2 Linux')).toBe('2.38.0');
    expect(parseToolVersion('no digits')).toBeUndefined();
  });
  it('suggests login names', () => {
    expect(suggestLoginName('Ubuntu')).toBe('ubuntu');
    expect(suggestLoginName('Debian GNU/Linux')).toBe('admin');
    expect(suggestLoginName('Amazon Linux')).toBe('ec2-user');
    expect(suggestLoginName(undefined)).toBe('ec2-user');
  });
});
