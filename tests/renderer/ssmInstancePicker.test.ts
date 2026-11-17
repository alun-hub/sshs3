import { describe, it, expect } from 'vitest';
import { filterInstances, suggestLogin, toggleSelection } from '../../src/renderer/src/lib/ssmInstancePicker';
import type { SsmInstance } from '../../src/shared/types/ssm';

const list: SsmInstance[] = [
  { instanceId: 'i-0123456789abcdef0', name: 'web-1', platformName: 'Ubuntu', platformType: 'Linux', ipAddress: '10.0.0.5' },
  { instanceId: 'i-0123456789abcdef1', name: 'db-1', platformName: 'Amazon Linux', platformType: 'Linux', ipAddress: '10.0.1.9' },
];

describe('ssm instance picker helpers', () => {
  it('filters on name, id, platform and ip', () => {
    expect(filterInstances(list, '')).toHaveLength(2);
    expect(filterInstances(list, 'WEB')).toHaveLength(1);
    expect(filterInstances(list, 'abcdef1')).toHaveLength(1);
    expect(filterInstances(list, 'amazon')[0].name).toBe('db-1');
    expect(filterInstances(list, '10.0.1')).toHaveLength(1);
    expect(filterInstances(list, 'nope')).toHaveLength(0);
  });
  it('suggests a login from the first selected instance', () => {
    expect(suggestLogin([list[0]])).toBe('ubuntu');
    expect(suggestLogin([list[1], list[0]])).toBe('ec2-user');
    expect(suggestLogin([])).toBe('ec2-user');
  });
  it('toggles selections in single and multi mode', () => {
    expect([...toggleSelection(new Set(['a']), 'b', true)]).toEqual(['b']);
    expect([...toggleSelection(new Set(['a']), 'a', true)]).toEqual([]);
    expect([...toggleSelection(new Set(['a']), 'b', false)].sort()).toEqual(['a', 'b']);
    expect([...toggleSelection(new Set(['a', 'b']), 'a', false)]).toEqual(['b']);
  });
});
