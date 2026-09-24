import type * as k8s from '@kubernetes/client-node';
import { loadK8sClient } from './k8sClient';
import { loadKubeConfigForContext } from './k8sKubeConfig';
import type { K8sDebugTarget } from '../../shared/types/kubernetes';

export class K8sDebugService {
  private kubeConfigPath?: string;
  private clientFactory?: (contextName: string) => Promise<k8s.CoreV1Api>;

  constructor(
    kubeConfigPath?: string,
    clientFactory?: (contextName: string) => Promise<k8s.CoreV1Api>
  ) {
    this.kubeConfigPath = kubeConfigPath;
    this.clientFactory = clientFactory;
  }

  private async getApiClient(contextName: string): Promise<k8s.CoreV1Api> {
    if (this.clientFactory) {
      return this.clientFactory(contextName);
    }
    const [kc, { CoreV1Api }] = await Promise.all([
      loadKubeConfigForContext(contextName, this.kubeConfigPath),
      loadK8sClient(),
    ]);
    return kc.makeApiClient(CoreV1Api);
  }

  /**
   * Attaches an ephemeral debug container into a running pod and waits for it to become ready/running.
   * Equivalent to `kubectl debug <pod> -i --image=<image> --target=<targetContainer>`.
   */
  public async attachEphemeralContainer(
    target: K8sDebugTarget,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<{ containerName: string }> {
    const client = await this.getApiClient(target.contextName);

    // 1. Fetch current pod state
    let pod: k8s.V1Pod;
    try {
      pod = await client.readNamespacedPod({ name: target.podName, namespace: target.namespace });
    } catch (err: any) {
      throw new Error(
        `Pod "${target.podName}" not found in namespace "${target.namespace}": ${
          err.body?.message || err.message || String(err)
        }`,
        { cause: err }
      );
    }

    const podPhase = pod.status?.phase;
    if (podPhase === 'Failed' || podPhase === 'Succeeded') {
      throw new Error(`Pod "${target.podName}" is in phase "${podPhase}" and cannot be debugged.`);
    }

    // 2. Generate a unique container name if not provided
    const existingNames = new Set<string>([
      ...(pod.spec?.containers || []).map((c) => c.name),
      ...(pod.spec?.initContainers || []).map((c) => c.name),
      ...(pod.spec?.ephemeralContainers || []).map((c) => c.name),
    ]);

    let containerName = target.containerName?.trim();
    if (!containerName) {
      let suffix = Math.random().toString(36).substring(2, 7);
      while (existingNames.has(`debugger-${suffix}`)) {
        suffix = Math.random().toString(36).substring(2, 7);
      }
      containerName = `debugger-${suffix}`;
    } else if (existingNames.has(containerName)) {
      throw new Error(`Container "${containerName}" already exists in pod "${target.podName}".`);
    }

    // 3. Construct ephemeral container spec
    const containerSpec: any = {
      name: containerName,
      image: target.image.trim(),
      stdin: true,
      tty: true,
      imagePullPolicy: 'IfNotPresent',
    };

    if (target.targetContainerName?.trim()) {
      containerSpec.targetContainerName = target.targetContainerName.trim();
    }

    if (target.command && target.command.length > 0) {
      containerSpec.command = target.command;
    }

    // 4. Construct JSON Patch
    const existingEphemeral = pod.spec?.ephemeralContainers || [];
    let patch: any[];
    if (existingEphemeral.length === 0) {
      patch = [
        {
          op: 'add',
          path: '/spec/ephemeralContainers',
          value: [containerSpec],
        },
      ];
    } else {
      patch = [
        {
          op: 'add',
          path: '/spec/ephemeralContainers/-',
          value: containerSpec,
        },
      ];
    }

    // 5. Apply ephemeralcontainers patch
    try {
      await client.patchNamespacedPodEphemeralcontainers({
        name: target.podName,
        namespace: target.namespace,
        body: patch,
      });
    } catch (err: any) {
      const msg = err.body?.message || err.message || String(err);
      if (err.statusCode === 403 || err.code === 403 || /forbidden/i.test(msg)) {
        throw new Error(
          `Permission denied: RBAC role does not allow updating subresource "pods/ephemeralcontainers" in namespace "${target.namespace}". Details: ${msg}`,
          { cause: err }
        );
      }
      throw new Error(`Failed to attach ephemeral container to "${target.podName}": ${msg}`, { cause: err });
    }

    // 6. Poll until container reaches running state (or timeout/failure)
    const timeoutMs = options?.timeoutMs ?? 60000;
    const pollIntervalMs = options?.pollIntervalMs ?? 1000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      let updatedPod: k8s.V1Pod;
      try {
        updatedPod = await client.readNamespacedPod({
          name: target.podName,
          namespace: target.namespace,
        });
      } catch {
        continue;
      }

      const status = (updatedPod.status?.ephemeralContainerStatuses || []).find(
        (s) => s.name === containerName
      );

      if (!status) {
        continue;
      }

      if (status.state?.running) {
        return { containerName };
      }

      if (status.state?.waiting) {
        const reason = status.state.waiting.reason || '';
        const waitMsg = status.state.waiting.message || '';
        if (reason === 'ImagePullBackOff' || reason === 'ErrImagePull') {
          throw new Error(
            `Failed to pull debug image "${target.image}": ${waitMsg || reason}`
          );
        }
        if (reason === 'CrashLoopBackOff') {
          throw new Error(
            `Debug container "${containerName}" crashed immediately: ${waitMsg || reason}`
          );
        }
      }

      if (status.state?.terminated) {
        const term = status.state.terminated;
        throw new Error(
          `Debug container "${containerName}" terminated unexpectedly (exit code ${term.exitCode}): ${
            term.message || term.reason || 'Unknown error'
          }`
        );
      }
    }

    throw new Error(
      `Timed out waiting for debug container "${containerName}" to start (waited ${Math.round(
        timeoutMs / 1000
      )}s). Check if the image exists and cluster nodes can pull it.`
    );
  }
}
