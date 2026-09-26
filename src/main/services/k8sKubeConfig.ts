import type * as k8s from '@kubernetes/client-node';
import { loadK8sClient } from './k8sClient';

/**
 * Names of kubeconfig users configured with an `exec:` credential plugin —
 * an arbitrary external command/args that @kubernetes/client-node runs to
 * fetch credentials the first time that context is actually used (e.g. the
 * sidebar tree expanding a namespace, or K8sDiscoveryService's fs.watch
 * auto-reload after the file changes on disk). This is completely standard
 * for real-world cloud providers (`aws eks get-token`, `gke-gcloud-auth-plugin`,
 * etc.), so its mere presence is not itself suspicious — callers use this to
 * warn only when a *newly appeared* exec entry shows up in a kubeconfig that
 * changed while the app was already running (see the H8 code-review
 * finding), not on every ordinary load of the user's own long-standing file.
 */
export function getExecAuthUserNames(kc: k8s.KubeConfig): Set<string> {
  const names = new Set<string>();
  for (const user of kc.getUsers()) {
    if ((user as unknown as { exec?: unknown }).exec) {
      names.add(user.name);
    }
  }
  return names;
}

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
