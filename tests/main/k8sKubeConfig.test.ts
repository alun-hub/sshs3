import { describe, it, expect } from 'vitest';
import { getExecAuthUserNames } from '../../src/main/services/k8sKubeConfig';
import type * as k8s from '@kubernetes/client-node';

function fakeKubeConfig(users: Array<{ name: string; exec?: unknown }>): k8s.KubeConfig {
  return { getUsers: () => users } as unknown as k8s.KubeConfig;
}

describe('getExecAuthUserNames', () => {
  it('returns an empty set when no user has an exec provider', () => {
    const kc = fakeKubeConfig([{ name: 'alice' }, { name: 'bob' }]);
    expect(getExecAuthUserNames(kc)).toEqual(new Set());
  });

  it('returns the names of users with an exec provider, ignoring users without one', () => {
    const kc = fakeKubeConfig([
      { name: 'alice' },
      { name: 'eks-user', exec: { command: 'aws', args: ['eks', 'get-token'] } },
      { name: 'bob' },
    ]);
    expect(getExecAuthUserNames(kc)).toEqual(new Set(['eks-user']));
  });
});
