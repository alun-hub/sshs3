let modulePromise: Promise<typeof import('@kubernetes/client-node')> | undefined;

/**
 * Lazily loads `@kubernetes/client-node`, cached for the process lifetime.
 *
 * Importing it statically at the top of every k8s file added ~1.1s of pure
 * `require()` cost to *every* app startup — including the packaged AppImage,
 * since it's pulled in through IpcBridge's import chain — even for users who
 * never open the Kubernetes sidebar. Loading it on first actual use instead
 * means only that cost is paid by whoever opens the k8s panel, not everyone.
 */
export function loadK8sClient(): Promise<typeof import('@kubernetes/client-node')> {
  if (!modulePromise) {
    modulePromise = import('@kubernetes/client-node');
  }
  return modulePromise;
}
