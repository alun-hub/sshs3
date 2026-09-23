import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import net from 'node:net';
import { loadK8sClient } from './k8sClient';
import { loadKubeConfigForContext } from './k8sKubeConfig';
import type {
  K8sPortForwardTarget,
  K8sActivePortForward,
} from '../../shared/types/kubernetes';

interface ActiveSession {
  id: string;
  target: K8sPortForwardTarget;
  server: net.Server;
  localPort: number;
  activeSockets: Set<net.Socket>;
  startedAt: string;
}

/**
 * Manages local TCP servers that proxy traffic to Kubernetes Pod ports
 * using `@kubernetes/client-node`'s PortForward protocol over WebSockets.
 */
export class K8sPortForwardManager extends EventEmitter {
  private sessions: Map<string, ActiveSession> = new Map();
  private kubeConfigPath?: string;

  constructor(kubeConfigPath?: string) {
    super();
    this.kubeConfigPath = kubeConfigPath;
  }

  /**
   * Starts a local TCP listener forwarding traffic to the target pod's containerPort.
   * If target.localPort is omitted or 0, an available random port is assigned by the OS.
   */
  public async startPortForward(target: K8sPortForwardTarget): Promise<K8sActivePortForward> {
    const id = `pf-${crypto.randomUUID()}`;
    const [kc, { PortForward }] = await Promise.all([
      loadKubeConfigForContext(target.contextName, this.kubeConfigPath),
      loadK8sClient(),
    ]);

    const pf = new PortForward(kc);
    const activeSockets = new Set<net.Socket>();

    const server = net.createServer((socket) => {
      activeSockets.add(socket);
      this.emitChange();

      let closed = false;
      const cleanup = () => {
        if (!closed) {
          closed = true;
          activeSockets.delete(socket);
          this.emitChange();
        }
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);

      // Open a WebSocket port-forward stream for this incoming TCP connection
      pf.portForward(
        target.namespace,
        target.podName,
        [target.containerPort],
        socket,
        null,
        socket
      )
        .then((ws) => {
          socket.on('close', () => {
            try {
              if (typeof ws === 'function') {
                const sock = ws();
                sock?.close();
              } else if (ws && typeof (ws as any).close === 'function') {
                (ws as any).close();
              }
            } catch {
              // Ignore teardown error on closed socket
            }
          });
        })
        .catch((err) => {
          cleanup();
          socket.destroy(err instanceof Error ? err : new Error(String(err)));
        });
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(target.localPort || 0, '127.0.0.1', () => {
        resolve();
      });
      server.once('error', reject);
    });

    const address = server.address() as net.AddressInfo;
    const assignedPort = address.port;
    const startedAt = new Date().toISOString();

    const session: ActiveSession = {
      id,
      target: { ...target, localPort: assignedPort },
      server,
      localPort: assignedPort,
      activeSockets,
      startedAt,
    };

    this.sessions.set(id, session);
    this.emitChange();

    return {
      id,
      contextName: target.contextName,
      namespace: target.namespace,
      podName: target.podName,
      containerPort: target.containerPort,
      localPort: assignedPort,
      activeConnections: 0,
      startedAt,
      status: 'active',
    };
  }

  /**
   * Stops an active port-forward tunnel and terminates its active client sockets.
   */
  public async stopPortForward(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;

    this.sessions.delete(id);
    for (const socket of session.activeSockets) {
      socket.destroy();
    }
    session.activeSockets.clear();

    await new Promise<void>((resolve) => {
      session.server.close(() => resolve());
    });

    this.emitChange();
    return true;
  }

  /**
   * Lists all currently active port-forward tunnels.
   */
  public listActive(): K8sActivePortForward[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      contextName: s.target.contextName,
      namespace: s.target.namespace,
      podName: s.target.podName,
      containerPort: s.target.containerPort,
      localPort: s.localPort,
      activeConnections: s.activeSockets.size,
      startedAt: s.startedAt,
      status: 'active',
    }));
  }

  /**
   * Stops all active port-forwards.
   */
  public async stopAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.stopPortForward(id)));
  }

  private emitChange(): void {
    this.emit('change', this.listActive());
  }
}
