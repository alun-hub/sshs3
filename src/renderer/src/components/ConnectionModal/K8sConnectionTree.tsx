import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  Folder,
  Info,
  Loader2,
  Network,
  RefreshCw,
  ScrollText,
  Search,
  TerminalSquare,
  X,
} from 'lucide-react';
import type { K8sClusterNode, K8sNamespaceNode, K8sPodNode, K8sTerminalTarget } from '@shared/types/kubernetes';
import { K8sPodDetailModal } from '../K8s/K8sPodDetailModal';
import { K8sPortForwardModal } from '../K8s/K8sPortForwardModal';

type Loadable<T> = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; data: T };

/**
 * The k8s client wraps connection failures in a bare `TypeError: fetch failed`
 * with the actual reason (e.g. ECONNREFUSED) nested in `.cause`. Walk the
 * chain so the tree shows something more useful than "fetch failed".
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(' — caused by: ');
}

const stateDotClass: Record<string, string> = {
  running: 'bg-emerald-500',
  waiting: 'bg-amber-500',
  terminated: 'bg-txt-muted',
  unknown: 'bg-txt-muted',
};

interface K8sConnectionTreeProps {
  /** Invoked when the user clicks "Exec" on a container. */
  onExec?: (target: K8sTerminalTarget) => void;
  /** Invoked when the user clicks "Logs" on a container. */
  onViewLogs?: (target: K8sTerminalTarget) => void;
}

export const K8sConnectionTree: React.FC<K8sConnectionTreeProps> = ({ onExec, onViewLogs }) => {
  const [contexts, setContexts] = useState<Loadable<K8sClusterNode[]>>({ status: 'loading' });
  const [expandedContexts, setExpandedContexts] = useState<Set<string>>(new Set());
  const [namespacesByContext, setNamespacesByContext] = useState<Record<string, Loadable<K8sNamespaceNode[]>>>({});
  const [expandedNamespaces, setExpandedNamespaces] = useState<Set<string>>(new Set());
  const [podsByNamespace, setPodsByNamespace] = useState<Record<string, Loadable<K8sPodNode[]>>>({});
  const [expandedPods, setExpandedPods] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [describeTarget, setDescribeTarget] = useState<{
    contextName: string;
    namespace: string;
    podName: string;
  } | null>(null);
  const [portForwardTarget, setPortForwardTarget] = useState<{
    contextName: string;
    namespace: string;
    podName: string;
    containerPort?: number;
  } | null>(null);
  const [portForwardModalOpen, setPortForwardModalOpen] = useState(false);
  const [activePortForwardsCount, setActivePortForwardsCount] = useState(0);

  useEffect(() => {
    window.multissh
      .k8sListPortForwards()
      .then((list) => setActivePortForwardsCount(list.length))
      .catch(() => {});

    const unsubscribe = window.multissh.onK8sPortForwardEvent((list) => {
      setActivePortForwardsCount(list.length);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const loadContexts = () => {
    setContexts({ status: 'loading' });
    window.multissh
      .k8sListContexts()
      .then((data) => setContexts({ status: 'ready', data }))
      .catch((err) => setContexts({ status: 'error', error: describeError(err) }));
  };

  useEffect(() => {
    loadContexts();
  }, []);

  const handleRefresh = () => {
    void window.multissh.k8sReload();
    setNamespacesByContext({});
    setPodsByNamespace({});
    setExpandedContexts(new Set());
    setExpandedNamespaces(new Set());
    loadContexts();
  };

  const toggleContext = (contextName: string) => {
    setExpandedContexts((prev) => {
      const next = new Set(prev);
      if (next.has(contextName)) {
        next.delete(contextName);
        return next;
      }
      next.add(contextName);
      if (!namespacesByContext[contextName]) {
        setNamespacesByContext((p) => ({ ...p, [contextName]: { status: 'loading' } }));
        window.multissh
          .k8sListNamespaces(contextName)
          .then((data) => setNamespacesByContext((p) => ({ ...p, [contextName]: { status: 'ready', data } })))
          .catch((err) =>
            setNamespacesByContext((p) => ({
              ...p,
              [contextName]: { status: 'error', error: describeError(err) },
            }))
          );
      }
      return next;
    });
  };

  const toggleNamespace = (contextName: string, namespace: string) => {
    const key = `${contextName}/${namespace}`;
    setExpandedNamespaces((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      next.add(key);
      if (!podsByNamespace[key]) {
        setPodsByNamespace((p) => ({ ...p, [key]: { status: 'loading' } }));
        window.multissh
          .k8sListPods(contextName, namespace)
          .then((data) => setPodsByNamespace((p) => ({ ...p, [key]: { status: 'ready', data } })))
          .catch((err) =>
            setPodsByNamespace((p) => ({
              ...p,
              [key]: { status: 'error', error: describeError(err) },
            }))
          );
      }
      return next;
    });
  };

  const togglePod = (podKey: string) => {
    setExpandedPods((prev) => {
      const next = new Set(prev);
      if (next.has(podKey)) next.delete(podKey);
      else next.add(podKey);
      return next;
    });
  };

  if (contexts.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-txt-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading kubeconfig...
      </div>
    );
  }

  if (contexts.status === 'error') {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
        {contexts.error}
      </div>
    );
  }

  if (contexts.data.length === 0) {
    return <p className="py-6 text-center text-sm text-txt-muted">No contexts found in ~/.kube/config</p>;
  }

  return (
    <>
      <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-txt-muted pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter clusters, projects, pods..."
            className="w-full rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1 pl-8 pr-7 text-xs text-txt-primary placeholder:text-txt-muted focus:border-sky-500/50 focus:outline-none transition-colors"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-txt-muted hover:text-txt-primary p-0.5 rounded transition-colors"
              title="Clear filter"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setPortForwardTarget(null);
            setPortForwardModalOpen(true);
          }}
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface-subtle px-2.5 py-1 text-xs text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          title="Manage active port forwards"
        >
          <Network className="h-3.5 w-3.5 text-sky-400" />
          Port Forwards
          {activePortForwardsCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400 px-1">
              {activePortForwardsCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {contexts.data
        .filter((ctx) => {
          if (!filter.trim()) return true;
          const q = filter.trim().toLowerCase();
          if (ctx.contextName.toLowerCase().includes(q) || ctx.server.toLowerCase().includes(q)) return true;
          const nsState = namespacesByContext[ctx.contextName];
          if (nsState?.status === 'ready') {
            return nsState.data.some(
              (ns) =>
                ns.name.toLowerCase().includes(q) ||
                (ns.displayName && ns.displayName.toLowerCase().includes(q))
            );
          }
          return false;
        })
        .map((ctx) => {
        const isExpanded = expandedContexts.has(ctx.contextName);
        const nsState = namespacesByContext[ctx.contextName];
        return (
          <div key={ctx.contextName} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleContext(ctx.contextName)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-txt-secondary hover:bg-app-surface-hover transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
              )}
              <Network className="h-3.5 w-3.5 text-sky-400" />
              <span className="truncate">{ctx.contextName}</span>
              {ctx.isOpenShift && (
                <span className="rounded bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.2 text-[10px] font-medium text-rose-400">
                  OpenShift
                </span>
              )}
              {ctx.isCurrent && (
                <span className="rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.2 text-[10px] text-sky-400">
                  current
                </span>
              )}
              <span className="truncate text-[11px] font-normal text-txt-muted">{ctx.server}</span>
            </button>

            {isExpanded && (
              <div className="flex flex-col gap-1 pl-5">
                {!nsState || nsState.status === 'loading' ? (
                  <div className="flex items-center gap-2 py-1.5 text-xs text-txt-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading namespaces...
                  </div>
                ) : nsState.status === 'error' ? (
                  <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-2.5 py-1.5 text-[11px] text-red-300">
                    {nsState.error}
                  </div>
                ) : (
                  (() => {
                    const visibleNamespaces = nsState.data.filter((ns) => {
                      if (!filter.trim()) return true;
                      const q = filter.trim().toLowerCase();
                      return (
                        ns.name.toLowerCase().includes(q) ||
                        (ns.displayName && ns.displayName.toLowerCase().includes(q))
                      );
                    });

                    if (visibleNamespaces.length === 0) {
                      return <p className="py-1 text-[11px] text-txt-muted">No matching namespaces or projects</p>;
                    }

                    return visibleNamespaces.map((ns) => {
                      const nsKey = `${ctx.contextName}/${ns.name}`;
                      const nsExpanded = expandedNamespaces.has(nsKey);
                      const podState = podsByNamespace[nsKey];
                      return (
                        <div key={nsKey} className="space-y-1">
                          <button
                            type="button"
                            onClick={() => toggleNamespace(ctx.contextName, ns.name)}
                            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-txt-secondary hover:bg-app-surface-hover transition-colors"
                          >
                            {nsExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
                            )}
                            <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="truncate">{ns.name}</span>
                            {ns.displayName && (
                              <span className="truncate text-[11px] font-normal text-txt-muted">
                                ({ns.displayName})
                              </span>
                            )}
                          </button>

                        {nsExpanded && (
                          <div className="flex flex-col gap-1 pl-5">
                            {!podState || podState.status === 'loading' ? (
                              <div className="flex items-center gap-2 py-1.5 text-xs text-txt-muted">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading pods...
                              </div>
                            ) : podState.status === 'error' ? (
                              <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-2.5 py-1.5 text-[11px] text-red-300">
                                {podState.error}
                              </div>
                            ) : podState.data.length === 0 ? (
                              <p className="py-1 text-[11px] text-txt-muted">No pods in this namespace</p>
                            ) : (
                              podState.data.map((pod) => {
                                const podKey = `${nsKey}/${pod.name}`;
                                const podExpanded = expandedPods.has(podKey);
                                return (
                                  <div key={podKey} className="space-y-1">
                                    <div className="group flex items-center justify-between gap-1 rounded-lg px-2 py-1 text-xs text-txt-secondary hover:bg-app-surface-hover transition-colors">
                                      <button
                                        type="button"
                                        onClick={() => togglePod(podKey)}
                                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                      >
                                        {podExpanded ? (
                                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-txt-muted" />
                                        ) : (
                                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-txt-muted" />
                                        )}
                                        <Box className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                                        <span className="truncate">{pod.name}</span>
                                        <span className="truncate text-[10px] text-txt-muted">{pod.phase}</span>
                                      </button>
                                      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setDescribeTarget({
                                              contextName: ctx.contextName,
                                              namespace: ns.name,
                                              podName: pod.name,
                                            });
                                          }}
                                          title="Describe pod details & events"
                                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-txt-muted hover:bg-app-surface hover:text-txt-primary border border-transparent hover:border-border-subtle transition-colors"
                                        >
                                          <Info className="h-3 w-3" />
                                          <span className="hidden sm:inline">Describe</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const firstPort = pod.containers.find((c) => c.ports && c.ports.length > 0)?.ports?.[0];
                                            setPortForwardTarget({
                                              contextName: ctx.contextName,
                                              namespace: ns.name,
                                              podName: pod.name,
                                              containerPort: firstPort?.containerPort,
                                            });
                                            setPortForwardModalOpen(true);
                                          }}
                                          title="Port Forward into pod"
                                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-txt-muted hover:bg-app-surface hover:text-txt-primary border border-transparent hover:border-border-subtle transition-colors"
                                        >
                                          <ArrowUpRight className="h-3 w-3" />
                                          <span className="hidden sm:inline">Forward</span>
                                        </button>
                                      </div>
                                    </div>

                                    {podExpanded && (
                                      <div className="flex flex-col gap-1 pl-5">
                                        {pod.containers.map((container) => (
                                          <div
                                            key={container.name}
                                            className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1.5"
                                          >
                                            <div className="flex min-w-0 items-center gap-1.5">
                                              <Cpu className="h-3.5 w-3.5 shrink-0 text-txt-muted" />
                                              <span
                                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                                  stateDotClass[container.state] || stateDotClass.unknown
                                                }`}
                                                title={container.state}
                                              />
                                              <div className="min-w-0">
                                                <div className="truncate text-xs font-medium text-txt-primary">
                                                  {container.name}
                                                </div>
                                                <div className="truncate text-[10px] text-txt-muted">{container.image}</div>
                                              </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const port = container.ports?.[0];
                                                  setPortForwardTarget({
                                                    contextName: ctx.contextName,
                                                    namespace: ns.name,
                                                    podName: pod.name,
                                                    containerPort: port?.containerPort,
                                                  });
                                                  setPortForwardModalOpen(true);
                                                }}
                                                title="Port Forward to this container"
                                                className="flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-[11px] font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
                                              >
                                                <ArrowUpRight className="h-3 w-3" />
                                                Forward
                                              </button>
                                              {onViewLogs && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    onViewLogs({
                                                      contextName: ctx.contextName,
                                                      namespace: ns.name,
                                                      podName: pod.name,
                                                      containerName: container.name,
                                                    })
                                                  }
                                                  className="flex items-center gap-1 rounded-lg border border-border-subtle px-2.5 py-1 text-[11px] font-medium text-txt-secondary hover:bg-app-surface-hover transition-colors"
                                                >
                                                  <ScrollText className="h-3 w-3" />
                                                  Logs
                                                </button>
                                              )}
                                              {onExec && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    onExec({
                                                      contextName: ctx.contextName,
                                                      namespace: ns.name,
                                                      podName: pod.name,
                                                      containerName: container.name,
                                                    })
                                                  }
                                                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                                >
                                                  <TerminalSquare className="h-3 w-3" />
                                                  Exec
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  });
                })())}
              </div>
            )}
          </div>
        );
      })}
      </div>

      {describeTarget && (
        <K8sPodDetailModal
          contextName={describeTarget.contextName}
          namespace={describeTarget.namespace}
          podName={describeTarget.podName}
          onClose={() => setDescribeTarget(null)}
          onExec={onExec}
          onViewLogs={onViewLogs}
          onPortForward={(cName, nName, pName, cPort) => {
            setPortForwardTarget({
              contextName: cName,
              namespace: nName,
              podName: pName,
              containerPort: cPort,
            });
            setPortForwardModalOpen(true);
          }}
        />
      )}

      <K8sPortForwardModal
        open={portForwardModalOpen}
        initialTarget={portForwardTarget ?? undefined}
        onClose={() => setPortForwardModalOpen(false)}
      />
    </>
  );
};

export default K8sConnectionTree;
