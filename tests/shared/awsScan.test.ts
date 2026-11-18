import { describe, it, expect } from 'vitest';
import {
  AWS_DEFAULT_REGIONS, nameFromTags, uniqueNames, scanFolder, groupInstances, dedupeInstances, summarizeScan,
} from '../../src/shared/awsScan';
import { isValidRegion, mapInstances } from '../../src/shared/ssm';
import type { ScannedInstance } from '../../src/shared/types/awsScan';

const inst = (over: Partial<ScannedInstance> = {}): ScannedInstance => ({
  instanceId: 'i-0123456789abcdef0', name: 'web', region: 'eu-north-1', targetId: 't1', ...over,
});

describe('awsScan helpers', () => {
  it('lists valid default regions without opt-in regions', () => {
    expect(AWS_DEFAULT_REGIONS.every(isValidRegion)).toBe(true);
    expect(AWS_DEFAULT_REGIONS).toContain('eu-north-1');
    for (const optIn of ['af-south-1', 'ap-east-1', 'me-south-1']) expect(AWS_DEFAULT_REGIONS).not.toContain(optIn);
  });
  it('reads and sanitises the Name tag', () => {
    expect(nameFromTags([{ Key: 'env', Value: 'prod' }, { Key: 'Name', Value: ' api-1 ' }])).toBe('api-1');
    expect(nameFromTags([{ Key: 'Name', Value: 'a‮b\nc' }])).not.toMatch(/[‮\n]/);
    expect(nameFromTags([{ Key: 'Name', Value: '' }])).toBeUndefined();
    expect(nameFromTags(undefined)).toBeUndefined();
  });
  it('appends the instance id to duplicate or taken names so they never form a "system"', () => {
    const out = uniqueNames([
      { instanceId: 'i-1', name: 'web' }, { instanceId: 'i-2', name: 'Web' }, { instanceId: 'i-3', name: 'db' },
    ], new Set(['DB']));
    expect(out.get('i-1')).toBe('web (i-1)');
    expect(out.get('i-2')).toBe('Web (i-2)');
    expect(out.get('i-3')).toBe('db (i-3)');
    expect(uniqueNames([{ instanceId: 'i-9', name: 'solo' }]).get('i-9')).toBe('solo');
  });
  it('builds folders without path separators from account names', () => {
    expect(scanFolder('prod/eu', 'eu-north-1')).toBe('AWS/prod-eu/eu-north-1');
    expect(scanFolder('', 'us-east-1')).toBe('AWS/account/us-east-1');
  });
  it('groups by target then region and dedupes', () => {
    const list = [inst(), inst({ instanceId: 'i-0123456789abcdef1' }), inst({ region: 'us-east-1' }), inst({ targetId: 't2' }), inst()];
    expect(dedupeInstances(list)).toHaveLength(4);
    const groups = groupInstances(dedupeInstances(list));
    expect(groups.map((g) => [g.targetId, g.region, g.items.length])).toEqual([['t1', 'eu-north-1', 2], ['t1', 'us-east-1', 1], ['t2', 'eu-north-1', 1]]);
  });
  it('drops records with invalid ids when deduping', () => {
    expect(dedupeInstances([inst({ instanceId: 'nope' })])).toEqual([]);
  });
  it('summarises skipped searches', () => {
    expect(summarizeScan(6, [])).toBe('Searched 6.');
    const skip = (reason: 'access-denied' | 'region-disabled') => ({ targetId: 't', label: 'l', region: 'r', reason, message: '' });
    expect(summarizeScan(6, [skip('access-denied'), skip('access-denied'), skip('region-disabled')])).toBe(
      'Searched 6, skipped 3: access denied ×2, region not enabled ×1.'
    );
  });
});

describe('mapInstances for hybrid nodes', () => {
  it('prefers the activation Name over the host name', () => {
    const [h] = mapInstances([{ InstanceId: 'mi-0123456789abcdef0', Name: 'onprem-1', ComputerName: 'host.local' }]);
    expect(h.name).toBe('onprem-1');
  });
});
