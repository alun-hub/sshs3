import { describe, it, expect, beforeEach, vi } from 'vitest';

// Independent, per-test-controllable @kubernetes/client-node mock (H8).
// Kept separate from the shared K8sDiscoveryService.test.ts mock/fixtures,
// which are read by many other tests, so this file can freely mutate the
// simulated kubeconfig's users between "loads" without affecting them.
let currentUsers: Array<{ name: string; exec?: unknown }> = [{ name: 'default' }];

const loadFromFileMock = vi.fn();
const loadFromDefaultMock = vi.fn();

vi.mock('@kubernetes/client-node', () => {
  class KubeConfig {
    loadFromFile = loadFromFileMock;
    loadFromDefault = loadFromDefaultMock;
    getCurrentContext = vi.fn(() => 'default');
    getContexts = vi.fn(() => [{ name: 'default', cluster: 'k3s-cluster', user: 'default' }]);
    getClusters = vi.fn(() => [{ name: 'k3s-cluster', server: 'https://example.com:6443' }]);
    getUsers = vi.fn(() => currentUsers);
    getCluster = vi.fn(() => ({ name: 'k3s-cluster', server: 'https://example.com:6443' }));
    getContextObject = vi.fn(() => ({ name: 'default', cluster: 'k3s-cluster', user: 'default' }));
    makeApiClient = vi.fn(() => ({}));
  }

  return { KubeConfig };
});

import { K8sDiscoveryService } from '../../src/main/services/K8sDiscoveryService';

describe('K8sDiscoveryService exec-auth warning (H8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUsers = [{ name: 'default' }];
  });

  it('does not warn on the first load, even if it already has an exec-auth user', async () => {
    currentUsers = [{ name: 'default' }, { name: 'eks-user', exec: { command: 'aws' } }];
    const service = new K8sDiscoveryService('/fake/kubeconfig');

    await service.listContexts();

    expect(service.consumePendingExecAuthWarning()).toBeNull();
  });

  it('warns when a reload introduces a new exec-auth user', async () => {
    const service = new K8sDiscoveryService('/fake/kubeconfig');
    await service.listContexts();
    expect(service.consumePendingExecAuthWarning()).toBeNull();

    currentUsers = [{ name: 'default' }, { name: 'eks-user', exec: { command: 'aws' } }];
    service.reload();
    await service.listContexts();

    const warning = service.consumePendingExecAuthWarning();
    expect(warning).not.toBeNull();
    expect(warning).toContain('eks-user');
    expect(warning).toContain('/fake/kubeconfig');
  });

  it('is one-shot: consuming the warning clears it', async () => {
    const service = new K8sDiscoveryService('/fake/kubeconfig');
    await service.listContexts();

    currentUsers = [{ name: 'default' }, { name: 'eks-user', exec: { command: 'aws' } }];
    service.reload();
    await service.listContexts();

    expect(service.consumePendingExecAuthWarning()).not.toBeNull();
    expect(service.consumePendingExecAuthWarning()).toBeNull();
  });

  it('does not warn when a reload leaves exec-auth users unchanged', async () => {
    currentUsers = [{ name: 'default' }, { name: 'eks-user', exec: { command: 'aws' } }];
    const service = new K8sDiscoveryService('/fake/kubeconfig');
    await service.listContexts();
    expect(service.consumePendingExecAuthWarning()).toBeNull();

    service.reload();
    await service.listContexts();

    expect(service.consumePendingExecAuthWarning()).toBeNull();
  });

  it('does not warn when a reload removes an exec-auth user', async () => {
    currentUsers = [{ name: 'default' }, { name: 'eks-user', exec: { command: 'aws' } }];
    const service = new K8sDiscoveryService('/fake/kubeconfig');
    await service.listContexts();
    expect(service.consumePendingExecAuthWarning()).toBeNull();

    currentUsers = [{ name: 'default' }];
    service.reload();
    await service.listContexts();

    expect(service.consumePendingExecAuthWarning()).toBeNull();
  });
});
