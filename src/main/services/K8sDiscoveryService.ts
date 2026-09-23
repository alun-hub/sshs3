import type * as k8s from '@kubernetes/client-node';
import { loadK8sClient } from './k8sClient';
import { loadKubeConfigForContext } from './k8sKubeConfig';
import type {
  K8sClusterNode,
  K8sContainerNode,
  K8sNamespaceNode,
  K8sPodNode,
} from '../../shared/types/kubernetes';

function containerState(status: k8s.V1ContainerStatus | undefined): K8sContainerNode['state'] {
  if (!status?.state) return 'unknown';
  if (status.state.running) return 'running';
  if (status.state.waiting) return 'waiting';
  if (status.state.terminated) return 'terminated';
  return 'unknown';
}

/**
 * Reads the user's kubeconfig and exposes a lazily-expandable
 * cluster -> namespace -> pod -> container tree for the sidebar.
 * Namespaces/pods are only fetched on demand (not eagerly for every
 * context at startup) since a kubeconfig can reference clusters that
 * are slow or unreachable.
 */
export class K8sDiscoveryService {
  private kubeConfigPath?: string;
  private kc: k8s.KubeConfig | undefined;
  private apiClients: Map<string, k8s.CoreV1Api> = new Map();

  constructor(kubeConfigPath?: string) {
    this.kubeConfigPath = kubeConfigPath;
  }

  private async loadKubeConfig(): Promise<k8s.KubeConfig> {
    if (this.kc) return this.kc;
    const { KubeConfig } = await loadK8sClient();
    const kc = new KubeConfig();
    if (this.kubeConfigPath) {
      kc.loadFromFile(this.kubeConfigPath);
    } else {
      kc.loadFromDefault();
    }
    this.kc = kc;
    return kc;
  }

  public getKubeconfigPath(): string {
    return this.kubeConfigPath || process.env.KUBECONFIG || `${process.env.HOME}/.kube/config`;
  }

  /**
   * Re-reads the kubeconfig from disk and drops cached API clients, so a
   * manual refresh picks up contexts/clusters added since this service
   * was created (e.g. after `oc login` or `kubectl config use-context`).
   */
  public reload(): void {
    this.kc = undefined;
    this.apiClients.clear();
  }

  private async getApiClient(contextName: string): Promise<k8s.CoreV1Api> {
    const cached = this.apiClients.get(contextName);
    if (cached) return cached;

    const [kc, { CoreV1Api }] = await Promise.all([
      loadKubeConfigForContext(contextName, this.kubeConfigPath),
      loadK8sClient(),
    ]);
    const client = kc.makeApiClient(CoreV1Api);
    this.apiClients.set(contextName, client);
    return client;
  }

  /**
   * Lists every context defined in the kubeconfig, without connecting to
   * any of them. This is the top level of the sidebar tree.
   */
  public async listContexts(): Promise<K8sClusterNode[]> {
    const kc = await this.loadKubeConfig();
    const currentContext = kc.getCurrentContext();

    return kc.getContexts().map((context): K8sClusterNode => {
      const cluster = kc.getCluster(context.cluster);
      return {
        contextName: context.name,
        clusterName: context.cluster,
        server: cluster?.server || '',
        user: context.user,
        isCurrent: context.name === currentContext,
        namespaces: [],
      };
    });
  }

  /**
   * Lists namespaces for a single context (one tree-node expansion).
   */
  public async listNamespaces(contextName: string): Promise<K8sNamespaceNode[]> {
    const client = await this.getApiClient(contextName);
    const res = await client.listNamespace();
    return res.items.map((ns) => ({
      name: ns.metadata?.name || '',
      pods: [],
    }));
  }

  /**
   * Lists pods (with their containers) for a single namespace.
   */
  public async listPods(contextName: string, namespace: string): Promise<K8sPodNode[]> {
    const client = await this.getApiClient(contextName);
    const res = await client.listNamespacedPod({ namespace });

    return res.items.map((pod): K8sPodNode => {
      const statusByName = new Map(
        (pod.status?.containerStatuses || []).map((s) => [s.name, s])
      );
      const containers: K8sContainerNode[] = (pod.spec?.containers || []).map((c) => {
        const status = statusByName.get(c.name);
        return {
          name: c.name,
          image: c.image || '',
          ready: status?.ready ?? false,
          state: containerState(status),
        };
      });

      return {
        name: pod.metadata?.name || '',
        namespace,
        phase: pod.status?.phase || 'Unknown',
        containers,
      };
    });
  }
}
