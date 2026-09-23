export interface K8sContainerNode {
  name: string;
  image: string;
  ready: boolean;
  state: 'running' | 'waiting' | 'terminated' | 'unknown';
  ports?: Array<{ containerPort: number; name?: string; protocol?: string }>;
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

export interface K8sPodCondition {
  type: string;
  status: string;
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface K8sPodContainerStatus {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: 'running' | 'waiting' | 'terminated' | 'unknown';
  stateDetails?: {
    startedAt?: string;
    reason?: string;
    message?: string;
    exitCode?: number;
    finishedAt?: string;
  };
  ports?: Array<{ containerPort: number; name?: string; protocol?: string }>;
}

export interface K8sPodEvent {
  type: 'Normal' | 'Warning' | string;
  reason: string;
  message: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  source?: string;
}

export interface K8sPodDescription {
  name: string;
  namespace: string;
  nodeName?: string;
  phase: string;
  podIP?: string;
  hostIP?: string;
  startTime?: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  conditions: K8sPodCondition[];
  containers: K8sPodContainerStatus[];
  initContainers?: K8sPodContainerStatus[];
  events: K8sPodEvent[];
  yaml: string;
}

export interface K8sPortForwardTarget {
  contextName: string;
  namespace: string;
  podName: string;
  containerPort: number;
  localPort?: number;
}

export interface K8sActivePortForward {
  id: string;
  contextName: string;
  namespace: string;
  podName: string;
  containerPort: number;
  localPort: number;
  activeConnections: number;
  startedAt: string;
  status: 'active' | 'error' | 'stopped';
  error?: string;
}

