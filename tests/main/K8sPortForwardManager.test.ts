import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';

const { mockPortForwardFn, MockPortForward } = vi.hoisted(() => {
  const mockPortForwardFn = vi.fn();
  class MockPortForward {
    constructor(public kc: any) {}
    portForward = mockPortForwardFn;
  }
  return { mockPortForwardFn, MockPortForward };
});

vi.mock('../../src/main/services/k8sClient', () => ({
  loadK8sClient: vi.fn().mockResolvedValue({
    PortForward: MockPortForward,
  }),
}));

vi.mock('../../src/main/services/k8sKubeConfig', () => ({
  loadKubeConfigForContext: vi.fn().mockResolvedValue({
    getCurrentContext: () => 'test-ctx',
  }),
}));

import { K8sPortForwardManager } from '../../src/main/services/K8sPortForwardManager';

describe('K8sPortForwardManager', () => {
  let manager: K8sPortForwardManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPortForwardFn.mockResolvedValue(() => ({ close: vi.fn() }));
    manager = new K8sPortForwardManager();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  it('starts a port-forward on an ephemeral local port when 0 or omitted', async () => {
    const session = await manager.startPortForward({
      contextName: 'minikube',
      namespace: 'default',
      podName: 'nginx-123',
      containerPort: 80,
    });

    expect(session.id).toMatch(/^pf-/);
    expect(session.contextName).toBe('minikube');
    expect(session.namespace).toBe('default');
    expect(session.podName).toBe('nginx-123');
    expect(session.containerPort).toBe(80);
    expect(session.localPort).toBeGreaterThan(0);
    expect(session.status).toBe('active');

    const activeList = manager.listActive();
    expect(activeList).toHaveLength(1);
    expect(activeList[0].id).toBe(session.id);
  });

  it('emits change events when tunnels start and stop', async () => {
    const changes: number[] = [];
    manager.on('change', (list) => {
      changes.push(list.length);
    });

    const session = await manager.startPortForward({
      contextName: 'minikube',
      namespace: 'default',
      podName: 'nginx-123',
      containerPort: 80,
    });

    expect(changes).toContain(1);

    const stopped = await manager.stopPortForward(session.id);
    expect(stopped).toBe(true);
    expect(manager.listActive()).toHaveLength(0);
    expect(changes).toContain(0);
  });

  it('returns false when stopping a non-existent session', async () => {
    const stopped = await manager.stopPortForward('non-existent-id');
    expect(stopped).toBe(false);
  });

  it('proxies incoming TCP connection to PortForward WebSocket', async () => {
    const session = await manager.startPortForward({
      contextName: 'minikube',
      namespace: 'default',
      podName: 'web-pod',
      containerPort: 8080,
    });

    // Connect to the local server
    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection({ port: session.localPort, host: '127.0.0.1' }, () => {
        client.end();
        resolve();
      });
      client.on('error', reject);
    });

    expect(mockPortForwardFn).toHaveBeenCalledWith(
      'default',
      'web-pod',
      [8080],
      expect.anything(),
      null,
      expect.anything()
    );
  });

  it('stops all active tunnels cleanly', async () => {
    await manager.startPortForward({
      contextName: 'minikube',
      namespace: 'default',
      podName: 'pod-1',
      containerPort: 80,
    });

    await manager.startPortForward({
      contextName: 'minikube',
      namespace: 'default',
      podName: 'pod-2',
      containerPort: 81,
    });

    expect(manager.listActive()).toHaveLength(2);

    await manager.stopAll();

    expect(manager.listActive()).toHaveLength(0);
  });
});
