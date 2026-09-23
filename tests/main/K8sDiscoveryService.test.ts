import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared state for the @kubernetes/client-node mock
const loadFromFileMock = vi.fn();
const loadFromDefaultMock = vi.fn();
const loadFromOptionsMock = vi.fn();
const listNamespaceMock = vi.fn();
const listNamespacedPodMock = vi.fn();
const coreV1ApiConstructorMock = vi.fn();

const FAKE_CONTEXTS = [
  { name: 'default', cluster: 'k3s-cluster', user: 'default' },
  { name: 'staging', cluster: 'staging-cluster', user: 'staging-user' },
];
const FAKE_CLUSTERS = [
  { name: 'k3s-cluster', server: 'https://192.168.2.163:6443' },
  { name: 'staging-cluster', server: 'https://staging.example.com:6443' },
];
const FAKE_USERS = [{ name: 'default' }, { name: 'staging-user' }];

vi.mock('@kubernetes/client-node', () => {
  class KubeConfig {
    loadFromFile = loadFromFileMock;
    loadFromDefault = loadFromDefaultMock;
    loadFromOptions = loadFromOptionsMock;
    getCurrentContext = vi.fn(() => 'default');
    getContexts = vi.fn(() => FAKE_CONTEXTS);
    getClusters = vi.fn(() => FAKE_CLUSTERS);
    getUsers = vi.fn(() => FAKE_USERS);
    getCluster = vi.fn((name: string) => FAKE_CLUSTERS.find((c) => c.name === name));
    makeApiClient = vi.fn(() => {
      coreV1ApiConstructorMock();
      return {
        listNamespace: listNamespaceMock,
        listNamespacedPod: listNamespacedPodMock,
      };
    });
  }

  class CoreV1Api {}

  return { KubeConfig, CoreV1Api };
});

import { K8sDiscoveryService } from '../../src/main/services/K8sDiscoveryService';

describe('K8sDiscoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listNamespaceMock.mockResolvedValue({
      items: [{ metadata: { name: 'default' } }, { metadata: { name: 'kube-system' } }],
    });
    listNamespacedPodMock.mockResolvedValue({
      items: [
        {
          metadata: { name: 'nginx-1' },
          status: {
            phase: 'Running',
            containerStatuses: [{ name: 'nginx', ready: true, state: { running: {} } }],
          },
          spec: { containers: [{ name: 'nginx', image: 'nginx:1.27' }] },
        },
      ],
    });
  });

  describe('listContexts', () => {
    it('lists every context from the kubeconfig without connecting to any cluster', async () => {
      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      const contexts = await svc.listContexts();

      expect(loadFromFileMock).toHaveBeenCalledWith('/fake/kubeconfig');
      expect(coreV1ApiConstructorMock).not.toHaveBeenCalled();
      expect(contexts).toEqual([
        {
          contextName: 'default',
          clusterName: 'k3s-cluster',
          server: 'https://192.168.2.163:6443',
          user: 'default',
          isCurrent: true,
          namespaces: [],
        },
        {
          contextName: 'staging',
          clusterName: 'staging-cluster',
          server: 'https://staging.example.com:6443',
          user: 'staging-user',
          isCurrent: false,
          namespaces: [],
        },
      ]);
    });

    it('loads from the default kubeconfig location when no path is given', async () => {
      const svc = new K8sDiscoveryService();
      await svc.listContexts();
      expect(loadFromDefaultMock).toHaveBeenCalled();
      expect(loadFromFileMock).not.toHaveBeenCalled();
    });
  });

  describe('listNamespaces', () => {
    it('returns namespace names for the given context', async () => {
      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      const namespaces = await svc.listNamespaces('default');

      expect(namespaces).toEqual([{ name: 'default', pods: [] }, { name: 'kube-system', pods: [] }]);
      expect(loadFromOptionsMock).toHaveBeenCalledWith(
        expect.objectContaining({ currentContext: 'default' })
      );
    });

    it('reuses the cached API client for repeated calls to the same context', async () => {
      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      await svc.listNamespaces('default');
      await svc.listNamespaces('default');

      expect(coreV1ApiConstructorMock).toHaveBeenCalledTimes(1);
    });

    it('builds a separate cached client per context', async () => {
      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      await svc.listNamespaces('default');
      await svc.listNamespaces('staging');

      expect(coreV1ApiConstructorMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('listPods', () => {
    it('maps pod phase, container image and ready/state from container statuses', async () => {
      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      const pods = await svc.listPods('default', 'default');

      expect(listNamespacedPodMock).toHaveBeenCalledWith({ namespace: 'default' });
      expect(pods).toEqual([
        {
          name: 'nginx-1',
          namespace: 'default',
          phase: 'Running',
          containers: [{ name: 'nginx', image: 'nginx:1.27', ready: true, state: 'running' }],
        },
      ]);
    });

    it.each([
      [{ waiting: {} }, 'waiting'],
      [{ terminated: {} }, 'terminated'],
      [undefined, 'unknown'],
    ])('maps container state %j to %s', async (state, expected) => {
      listNamespacedPodMock.mockResolvedValueOnce({
        items: [
          {
            metadata: { name: 'pod-x' },
            status: {
              phase: 'Running',
              containerStatuses: state ? [{ name: 'c', ready: false, state }] : [],
            },
            spec: { containers: [{ name: 'c', image: 'img' }] },
          },
        ],
      });

      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      const pods = await svc.listPods('default', 'default');
      expect(pods[0].containers[0].state).toBe(expected);
    });

    it('defaults ready to false and state to unknown when no container status is reported', async () => {
      listNamespacedPodMock.mockResolvedValueOnce({
        items: [
          {
            metadata: { name: 'pending-pod' },
            status: { phase: 'Pending', containerStatuses: [] },
            spec: { containers: [{ name: 'c', image: 'img' }] },
          },
        ],
      });

      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      const pods = await svc.listPods('default', 'default');
      expect(pods[0].containers[0]).toEqual({ name: 'c', image: 'img', ready: false, state: 'unknown' });
    });
  });

  describe('reload', () => {
    it('drops cached kubeconfig and API clients so the next call re-reads from disk', async () => {
      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      await svc.listNamespaces('default');
      expect(loadFromFileMock).toHaveBeenCalledTimes(1);
      expect(coreV1ApiConstructorMock).toHaveBeenCalledTimes(1);

      svc.reload();
      await svc.listNamespaces('default');

      expect(loadFromFileMock).toHaveBeenCalledTimes(2);
      expect(coreV1ApiConstructorMock).toHaveBeenCalledTimes(2);
    });
  });
});
