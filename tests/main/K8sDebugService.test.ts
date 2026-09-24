import { describe, it, expect, vi } from 'vitest';
import { K8sDebugService } from '../../src/main/services/K8sDebugService';

describe('K8sDebugService', () => {
  it('successfully attaches an ephemeral debug container and polls until running', async () => {
    let callCount = 0;
    const patchNamespacedPodEphemeralcontainers = vi.fn().mockResolvedValue({});
    const readNamespacedPod = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Initial pod check
        return {
          metadata: { name: 'my-pod' },
          status: { phase: 'Running' },
          spec: {
            containers: [{ name: 'app' }],
            ephemeralContainers: [],
          },
        };
      }
      // Polling check: ephemeral container is running
      return {
        metadata: { name: 'my-pod' },
        status: {
          phase: 'Running',
          ephemeralContainerStatuses: [
            {
              name: 'my-debugger',
              state: { running: { startedAt: new Date().toISOString() } },
            },
          ],
        },
      };
    });

    const mockClient: any = {
      readNamespacedPod,
      patchNamespacedPodEphemeralcontainers,
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    const result = await service.attachEphemeralContainer(
      {
        contextName: 'ctx-1',
        namespace: 'default',
        podName: 'my-pod',
        image: 'nicolaka/netshoot',
        containerName: 'my-debugger',
        targetContainerName: 'app',
        command: ['bash'],
      },
      { timeoutMs: 5000, pollIntervalMs: 10 }
    );

    expect(result.containerName).toBe('my-debugger');
    expect(patchNamespacedPodEphemeralcontainers).toHaveBeenCalledWith({
      name: 'my-pod',
      namespace: 'default',
      body: [
        {
          op: 'add',
          path: '/spec/ephemeralContainers',
          value: [
            {
              name: 'my-debugger',
              image: 'nicolaka/netshoot',
              stdin: true,
              tty: true,
              imagePullPolicy: 'IfNotPresent',
              targetContainerName: 'app',
              command: ['bash'],
            },
          ],
        },
      ],
    });
  });

  it('generates a unique debugger name and appends to existing ephemeral containers', async () => {
    let callCount = 0;
    const patchNamespacedPodEphemeralcontainers = vi.fn().mockResolvedValue({});
    const readNamespacedPod = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          metadata: { name: 'my-pod' },
          status: { phase: 'Running' },
          spec: {
            containers: [{ name: 'app' }],
            ephemeralContainers: [{ name: 'debugger-old' }],
          },
        };
      }
      return {
        metadata: { name: 'my-pod' },
        status: {
          phase: 'Running',
          ephemeralContainerStatuses: [
            {
              name: patchNamespacedPodEphemeralcontainers.mock.calls[0][0].body[0].value.name,
              state: { running: {} },
            },
          ],
        },
      };
    });

    const mockClient: any = {
      readNamespacedPod,
      patchNamespacedPodEphemeralcontainers,
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    const result = await service.attachEphemeralContainer(
      {
        contextName: 'ctx-1',
        namespace: 'prod',
        podName: 'my-pod',
        image: 'busybox:latest',
      },
      { timeoutMs: 5000, pollIntervalMs: 10 }
    );

    expect(result.containerName).toMatch(/^debugger-[a-z0-9]+$/);
    expect(patchNamespacedPodEphemeralcontainers.mock.calls[0][0].body[0].path).toBe(
      '/spec/ephemeralContainers/-'
    );
  });

  it('rejects if pod is in Succeeded or Failed phase', async () => {
    const mockClient: any = {
      readNamespacedPod: vi.fn().mockResolvedValue({
        metadata: { name: 'done-pod' },
        status: { phase: 'Succeeded' },
      }),
      patchNamespacedPodEphemeralcontainers: vi.fn(),
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    await expect(
      service.attachEphemeralContainer({
        contextName: 'ctx-1',
        namespace: 'default',
        podName: 'done-pod',
        image: 'busybox',
      })
    ).rejects.toThrow(/is in phase "Succeeded" and cannot be debugged/);
  });

  it('rejects if container name already exists in pod', async () => {
    const mockClient: any = {
      readNamespacedPod: vi.fn().mockResolvedValue({
        metadata: { name: 'my-pod' },
        status: { phase: 'Running' },
        spec: {
          containers: [{ name: 'main-app' }],
        },
      }),
      patchNamespacedPodEphemeralcontainers: vi.fn(),
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    await expect(
      service.attachEphemeralContainer({
        contextName: 'ctx-1',
        namespace: 'default',
        podName: 'my-pod',
        containerName: 'main-app',
        image: 'busybox',
      })
    ).rejects.toThrow(/Container "main-app" already exists in pod/);
  });

  it('handles RBAC 403 Forbidden error with descriptive message', async () => {
    const mockClient: any = {
      readNamespacedPod: vi.fn().mockResolvedValue({
        metadata: { name: 'my-pod' },
        status: { phase: 'Running' },
        spec: { containers: [{ name: 'app' }] },
      }),
      patchNamespacedPodEphemeralcontainers: vi.fn().mockRejectedValue({
        statusCode: 403,
        body: { message: 'pods "my-pod/ephemeralcontainers" is forbidden' },
      }),
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    await expect(
      service.attachEphemeralContainer({
        contextName: 'ctx-1',
        namespace: 'restricted',
        podName: 'my-pod',
        image: 'busybox',
      })
    ).rejects.toThrow(/Permission denied: RBAC role does not allow updating subresource "pods\/ephemeralcontainers"/);
  });

  it('handles ImagePullBackOff / ErrImagePull failure during polling', async () => {
    let callCount = 0;
    const mockClient: any = {
      readNamespacedPod: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            metadata: { name: 'my-pod' },
            status: { phase: 'Running' },
            spec: { containers: [{ name: 'app' }] },
          };
        }
        return {
          metadata: { name: 'my-pod' },
          status: {
            phase: 'Running',
            ephemeralContainerStatuses: [
              {
                name: 'test-debug',
                state: {
                  waiting: {
                    reason: 'ImagePullBackOff',
                    message: 'Back-off pulling image "invalid-registry.com/doesnotexist:latest"',
                  },
                },
              },
            ],
          },
        };
      }),
      patchNamespacedPodEphemeralcontainers: vi.fn().mockResolvedValue({}),
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    await expect(
      service.attachEphemeralContainer(
        {
          contextName: 'ctx-1',
          namespace: 'default',
          podName: 'my-pod',
          containerName: 'test-debug',
          image: 'invalid-registry.com/doesnotexist:latest',
        },
        { timeoutMs: 5000, pollIntervalMs: 10 }
      )
    ).rejects.toThrow(/Failed to pull debug image/);
  });

  it('handles CrashLoopBackOff failure during polling', async () => {
    let callCount = 0;
    const mockClient: any = {
      readNamespacedPod: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            metadata: { name: 'my-pod' },
            status: { phase: 'Running' },
            spec: { containers: [{ name: 'app' }] },
          };
        }
        return {
          metadata: { name: 'my-pod' },
          status: {
            phase: 'Running',
            ephemeralContainerStatuses: [
              {
                name: 'test-debug',
                state: {
                  waiting: {
                    reason: 'CrashLoopBackOff',
                    message: 'back-off 10s restarting failed container',
                  },
                },
              },
            ],
          },
        };
      }),
      patchNamespacedPodEphemeralcontainers: vi.fn().mockResolvedValue({}),
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    await expect(
      service.attachEphemeralContainer(
        {
          contextName: 'ctx-1',
          namespace: 'default',
          podName: 'my-pod',
          containerName: 'test-debug',
          image: 'busybox',
        },
        { timeoutMs: 5000, pollIntervalMs: 10 }
      )
    ).rejects.toThrow(/Debug container "test-debug" crashed immediately/);
  });

  it('handles unexpected container termination during startup', async () => {
    let callCount = 0;
    const mockClient: any = {
      readNamespacedPod: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            metadata: { name: 'my-pod' },
            status: { phase: 'Running' },
            spec: { containers: [{ name: 'app' }] },
          };
        }
        return {
          metadata: { name: 'my-pod' },
          status: {
            phase: 'Running',
            ephemeralContainerStatuses: [
              {
                name: 'test-debug',
                state: {
                  terminated: {
                    exitCode: 137,
                    reason: 'OOMKilled',
                  },
                },
              },
            ],
          },
        };
      }),
      patchNamespacedPodEphemeralcontainers: vi.fn().mockResolvedValue({}),
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    await expect(
      service.attachEphemeralContainer(
        {
          contextName: 'ctx-1',
          namespace: 'default',
          podName: 'my-pod',
          containerName: 'test-debug',
          image: 'busybox',
        },
        { timeoutMs: 5000, pollIntervalMs: 10 }
      )
    ).rejects.toThrow(/terminated unexpectedly \(exit code 137\): OOMKilled/);
  });

  it('times out if container never transitions to running', async () => {
    const mockClient: any = {
      readNamespacedPod: vi.fn().mockResolvedValue({
        metadata: { name: 'my-pod' },
        status: {
          phase: 'Running',
          ephemeralContainerStatuses: [
            {
              name: 'test-debug',
              state: { waiting: { reason: 'ContainerCreating' } },
            },
          ],
        },
        spec: { containers: [{ name: 'app' }] },
      }),
      patchNamespacedPodEphemeralcontainers: vi.fn().mockResolvedValue({}),
    };

    const service = new K8sDebugService(undefined, async () => mockClient);
    await expect(
      service.attachEphemeralContainer(
        {
          contextName: 'ctx-1',
          namespace: 'default',
          podName: 'my-pod',
          containerName: 'test-debug',
          image: 'busybox',
        },
        { timeoutMs: 50, pollIntervalMs: 10 }
      )
    ).rejects.toThrow(/Timed out waiting for debug container "test-debug" to start/);
  });
});
