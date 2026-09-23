import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared state for the @kubernetes/client-node mock
const loadFromFileMock = vi.fn();
const loadFromDefaultMock = vi.fn();
const loadFromOptionsMock = vi.fn();
const listNamespaceMock = vi.fn();
const listNamespacedPodMock = vi.fn();
const coreV1ApiConstructorMock = vi.fn();

const listClusterCustomObjectMock = vi.fn();

const FAKE_CONTEXTS: Array<{ name: string; cluster: string; user: string; namespace?: string }> = [
  { name: 'default', cluster: 'k3s-cluster', user: 'default' },
  { name: 'staging', cluster: 'staging-cluster', user: 'staging-user' },
  { name: 'openshift-dev', cluster: 'ocp-cluster', user: 'developer/api-ocp-example-com:6443', namespace: 'my-project' },
];
const FAKE_CLUSTERS = [
  { name: 'k3s-cluster', server: 'https://192.168.2.163:6443' },
  { name: 'staging-cluster', server: 'https://staging.example.com:6443' },
  { name: 'ocp-cluster', server: 'https://api.openshift.example.com:6443' },
];
const FAKE_USERS = [{ name: 'default' }, { name: 'staging-user' }, { name: 'developer' }];

class CustomObjectsApi {}
class CoreV1Api {}

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
    getContextObject = vi.fn((name: string) => FAKE_CONTEXTS.find((c) => c.name === name));
    makeApiClient = vi.fn((apiClass) => {
      if (apiClass === CustomObjectsApi) {
        return {
          listClusterCustomObject: listClusterCustomObjectMock,
        };
      }
      coreV1ApiConstructorMock();
      return {
        listNamespace: listNamespaceMock,
        listNamespacedPod: listNamespacedPodMock,
      };
    });
  }

  return { KubeConfig, CoreV1Api, CustomObjectsApi };
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
          isOpenShift: false,
          namespaces: [],
        },
        {
          contextName: 'staging',
          clusterName: 'staging-cluster',
          server: 'https://staging.example.com:6443',
          user: 'staging-user',
          isCurrent: false,
          isOpenShift: false,
          namespaces: [],
        },
        {
          contextName: 'openshift-dev',
          clusterName: 'ocp-cluster',
          server: 'https://api.openshift.example.com:6443',
          user: 'developer/api-ocp-example-com:6443',
          isCurrent: false,
          isOpenShift: true,
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

    it('falls back to OpenShift Projects API with display names when listNamespace returns 403 Forbidden', async () => {
      listNamespaceMock.mockRejectedValueOnce({
        statusCode: 403,
        message: 'namespaces is forbidden: User developer cannot list resource namespaces in API group at cluster scope',
      });
      listClusterCustomObjectMock.mockResolvedValueOnce({
        items: [
          {
            metadata: {
              name: 'frontend-dev',
              annotations: { 'openshift.io/display-name': 'Frontend Dev Project' },
            },
          },
          {
            metadata: {
              name: 'backend-prod',
              annotations: {},
            },
          },
        ],
      });

      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      const namespaces = await svc.listNamespaces('openshift-dev');

      expect(listClusterCustomObjectMock).toHaveBeenCalledWith({
        group: 'project.openshift.io',
        version: 'v1',
        plural: 'projects',
      });
      expect(namespaces).toEqual([
        { name: 'frontend-dev', displayName: 'Frontend Dev Project', pods: [] },
        { name: 'backend-prod', displayName: undefined, pods: [] },
      ]);
    });

    it('falls back to context.namespace when listNamespace and OpenShift projects are both forbidden', async () => {
      listNamespaceMock.mockRejectedValueOnce({
        code: 403,
        message: 'Forbidden',
      });
      listClusterCustomObjectMock.mockRejectedValueOnce({
        code: 403,
        message: 'Forbidden',
      });

      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      const namespaces = await svc.listNamespaces('openshift-dev');

      expect(namespaces).toEqual([{ name: 'my-project', pods: [] }]);
    });

    it('re-throws non-403 errors from listNamespace without invoking fallbacks', async () => {
      const networkError = new Error('ECONNREFUSED');
      listNamespaceMock.mockRejectedValueOnce(networkError);

      const svc = new K8sDiscoveryService('/fake/kubeconfig');
      await expect(svc.listNamespaces('default')).rejects.toThrow('ECONNREFUSED');
      expect(listClusterCustomObjectMock).not.toHaveBeenCalled();
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
