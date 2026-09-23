import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Globe,
  Loader2,
  Network,
  Radio,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import type {
  K8sActivePortForward,
  K8sPortForwardTarget,
} from '@shared/types/kubernetes';
import { formatDateTime } from '../../lib/dateFormat';

interface K8sPortForwardModalProps {
  initialTarget?: {
    contextName: string;
    namespace: string;
    podName: string;
    containerPort?: number;
  };
  open: boolean;
  onClose: () => void;
}

export const K8sPortForwardModal: React.FC<K8sPortForwardModalProps> = ({
  initialTarget,
  open,
  onClose,
}) => {
  const [activeForwards, setActiveForwards] = useState<K8sActivePortForward[]>([]);
  const [contextName, setContextName] = useState(initialTarget?.contextName || '');
  const [namespace, setNamespace] = useState(initialTarget?.namespace || '');
  const [podName, setPodName] = useState(initialTarget?.podName || '');
  const [containerPort, setContainerPort] = useState<string>(
    initialTarget?.containerPort ? String(initialTarget.containerPort) : '8080'
  );
  const [localPort, setLocalPort] = useState<string>(
    initialTarget?.containerPort ? String(initialTarget.containerPort) : '8080'
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  // Sync props when initialTarget changes
  useEffect(() => {
    if (initialTarget) {
      setContextName(initialTarget.contextName);
      setNamespace(initialTarget.namespace);
      setPodName(initialTarget.podName);
      if (initialTarget.containerPort) {
        setContainerPort(String(initialTarget.containerPort));
        setLocalPort(String(initialTarget.containerPort));
      }
    }
  }, [initialTarget]);

  // Load and subscribe to active port forwards
  useEffect(() => {
    if (!open) return;
    window.multissh
      .k8sListPortForwards()
      .then(setActiveForwards)
      .catch((err) => console.error('Failed to list active port forwards:', err));

    const unsubscribe = window.multissh.onK8sPortForwardEvent((forwards) => {
      setActiveForwards(forwards);
    });

    return () => {
      unsubscribe();
    };
  }, [open]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    const cPort = parseInt(containerPort, 10);
    const lPort = localPort ? parseInt(localPort, 10) : 0;

    if (!contextName || !namespace || !podName || Number.isNaN(cPort) || cPort <= 0) {
      setError('Please provide valid pod, namespace, and container port.');
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const target: K8sPortForwardTarget = {
        contextName,
        namespace,
        podName,
        containerPort: cPort,
        localPort: Number.isNaN(lPort) ? 0 : lPort,
      };

      const result = await window.multissh.k8sStartPortForward(target);
      setActiveForwards((prev) => {
        const filtered = prev.filter((p) => p.id !== result.id);
        return [...filtered, result];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (id: string) => {
    setStoppingId(id);
    try {
      await window.multissh.k8sStopPortForward(id);
      setActiveForwards((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to stop port forward:', err);
    } finally {
      setStoppingId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-400">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">Kubernetes Port Forwarding</h2>
              <p className="text-xs text-txt-muted">
                Forward local ports directly to Kubernetes Pods via API WebSockets
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Start New Forward Form */}
          <form onSubmit={handleStart} className="rounded-xl border border-border-subtle bg-app-surface p-4 space-y-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-txt-primary">
              <ArrowUpRight className="h-4 w-4 text-sky-400" />
              <span>New Port Forward</span>
            </div>

            {error && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-2.5 text-xs text-red-300 flex items-center gap-2">
                <XCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-txt-muted mb-1">Context</label>
                <input
                  type="text"
                  required
                  value={contextName}
                  onChange={(e) => setContextName(e.target.value)}
                  placeholder="e.g. minikube or default"
                  className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1.5 text-xs text-txt-primary focus:border-sky-500/50 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-txt-muted mb-1">Namespace</label>
                <input
                  type="text"
                  required
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  placeholder="e.g. default"
                  className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1.5 text-xs text-txt-primary focus:border-sky-500/50 focus:outline-none transition-colors"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-txt-muted mb-1">Pod Name</label>
                <input
                  type="text"
                  required
                  value={podName}
                  onChange={(e) => setPodName(e.target.value)}
                  placeholder="e.g. my-app-7d8f9c-xyz"
                  className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1.5 text-xs text-txt-primary focus:border-sky-500/50 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-txt-muted mb-1">
                  Container Port (Target)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={containerPort}
                  onChange={(e) => setContainerPort(e.target.value)}
                  placeholder="e.g. 8080, 5432"
                  className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1.5 text-xs text-txt-primary font-mono focus:border-sky-500/50 focus:outline-none transition-colors"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-txt-muted mb-1">
                  Local Port (0 = auto-assign)
                </label>
                <input
                  type="number"
                  min={0}
                  max={65535}
                  value={localPort}
                  onChange={(e) => setLocalPort(e.target.value)}
                  placeholder="e.g. 8080 (0 for random)"
                  className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1.5 text-xs text-txt-primary font-mono focus:border-sky-500/50 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={starting}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors disabled:opacity-50"
              >
                {starting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Starting tunnel...
                  </>
                ) : (
                  <>
                    <Radio className="h-3.5 w-3.5" />
                    Start Forwarding
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Active Port Forwards List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-txt-primary flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-emerald-400" />
                Active Port Forwards ({activeForwards.length})
              </h3>
            </div>

            {activeForwards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-subtle py-8 text-center text-xs text-txt-muted">
                No active port-forward tunnels running.
              </div>
            ) : (
              <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-app-surface overflow-hidden">
                {activeForwards.map((pf) => (
                  <div
                    key={pf.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-app-surface-hover/40 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="font-mono text-xs font-semibold text-emerald-400">
                          127.0.0.1:{pf.localPort}
                        </span>
                        <ArrowRight className="h-3 w-3 text-txt-muted" />
                        <span className="font-mono text-xs text-txt-primary">
                          {pf.podName}:{pf.containerPort}
                        </span>
                      </div>
                      <div className="text-[11px] text-txt-muted flex items-center gap-2">
                        <span>{pf.namespace} · {pf.contextName}</span>
                        <span>·</span>
                        <span>Started: {formatDateTime(pf.startedAt)}</span>
                        {pf.activeConnections > 0 && (
                          <span className="rounded bg-sky-500/15 text-sky-400 px-1.5 py-0.2 text-[10px]">
                            {pf.activeConnections} active conn{pf.activeConnections > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={`http://127.0.0.1:${pf.localPort}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1 text-xs text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                      >
                        <ExternalLink className="h-3 w-3 text-sky-400" />
                        Open
                      </a>

                      <button
                        type="button"
                        onClick={() => handleStop(pf.id)}
                        disabled={stoppingId === pf.id}
                        className="flex items-center gap-1 rounded-lg border border-rose-900/60 bg-rose-950/40 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900/50 transition-colors disabled:opacity-50"
                      >
                        {stoppingId === pf.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3" />
                        )}
                        Stop
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border-subtle bg-app-surface px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-subtle bg-app-surface-subtle px-4 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default K8sPortForwardModal;
