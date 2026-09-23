export interface K8sContainerNode {
  name: string;
  image: string;
  ready: boolean;
  state: 'running' | 'waiting' | 'terminated' | 'unknown';
}

export interface K8sPodNode {
  name: string;
  namespace: string;
  phase: string;
  containers: K8sContainerNode[];
}

export interface K8sNamespaceNode {
  name: string;
  displayName?: string;
  pods: K8sPodNode[];
}

export interface K8sClusterNode {
  /** Kubeconfig context name — the id used to select this cluster for discovery/exec. */
  contextName: string;
  clusterName: string;
  server: string;
  user: string;
  isCurrent: boolean;
  isOpenShift?: boolean;
  namespaces: K8sNamespaceNode[];
}

export interface K8sDiscoveryTree {
  kubeconfigPath: string;
  clusters: K8sClusterNode[];
}

export interface K8sTerminalTarget {
  contextName: string;
  namespace: string;
  podName: string;
  containerName: string;
  shell?: string; // defaults to '/bin/sh'
}

export interface K8sTerminalExitEvent {
  sessionId: string;
  status: string; // 'Success' | 'Failure' | reason string from the exec status channel
}

export interface K8sStorageConfig {
  id: string;
  name: string;
  contextName: string;
  namespace: string;
  podName: string;
  containerName: string;
  initialPath?: string;
  group?: string;
  lastUsedAt?: string;
}
