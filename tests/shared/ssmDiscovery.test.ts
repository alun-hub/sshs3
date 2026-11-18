import { describe, it, expect } from 'vitest';
import { mapInstances, sanitizeAwsText } from '../../src/shared/ssm';

const ID = 'i-0123456789abcdef0';

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
