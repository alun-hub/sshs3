import type * as k8s from '@kubernetes/client-node';
import { loadK8sClient } from './k8sClient';

/**
 * Builds a KubeConfig pinned to a single context, reconstructed from the base
 * kubeconfig's already-parsed clusters/users/contexts. Shared by every k8s
 * service (discovery, exec, logs) that needs to act against one context
 * without mutating a shared KubeConfig's `currentContext`.
 */
export async function loadKubeConfigForContext(contextName: string, kubeConfigPath?: string): Promise<k8s.KubeConfig> {
  const { KubeConfig } = await loadK8sClient();
  const base = new KubeConfig();
  if (kubeConfigPath) {
    base.loadFromFile(kubeConfigPath);
  } else {
    base.loadFromDefault();
  }

  const kc = new KubeConfig();
  kc.loadFromOptions({
    contexts: base.getContexts(),
    clusters: base.getClusters(),
    users: base.getUsers(),
    currentContext: contextName,
  });
  return kc;
}
