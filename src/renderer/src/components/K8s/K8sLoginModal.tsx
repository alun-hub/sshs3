import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  LogIn,
  ShieldAlert,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import type { K8sLoginResult } from '@shared/types/kubernetes';

interface K8sLoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (result: K8sLoginResult) => void;
}

function parsePastedCommand(text: string): {
  server?: string;
  token?: string;
  insecureSkipTlsVerify?: boolean;
  namespace?: string;
} {
  const result: {
    server?: string;
    token?: string;
    insecureSkipTlsVerify?: boolean;
    namespace?: string;
  } = {};

  if (!text || typeof text !== 'string') return result;
  const cleaned = text.trim().replace(/^oc\s+login\s+/i, '').replace(/^kubectl\s+/i, '');

  const tokenMatch = cleaned.match(/(?:--token[=\s]+|-t\s+)["']?([^"'\s]+)["']?/i);
  if (tokenMatch) result.token = tokenMatch[1];

  const serverMatch = cleaned.match(/(?:--server[=\s]+)["']?([^"'\s]+)["']?/i);
  if (serverMatch) {
    result.server = serverMatch[1];
  } else {
    const urlMatch = cleaned.match(/(https?:\/\/[^\s"']+)/i);
    if (urlMatch) result.server = urlMatch[1];
  }

  if (/--insecure-skip-tls-verify(?:=(?:true|1))?(?:\s|$)/i.test(cleaned)) {
    result.insecureSkipTlsVerify = true;
  } else if (/--insecure-skip-tls-verify=(?:false|0)(?:\s|$)/i.test(cleaned)) {
    result.insecureSkipTlsVerify = false;
  }

  const nsMatch = cleaned.match(/(?:--namespace[=\s]+|-n\s+)["']?([^"'\s]+)["']?/i);
  if (nsMatch) result.namespace = nsMatch[1];

  return result;
}

export const K8sLoginModal: React.FC<K8sLoginModalProps> = ({ open, onClose, onSuccess }) => {
  const [pasteInput, setPasteInput] = useState('');
  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const [namespace, setNamespace] = useState('');
  const [insecureSkipTlsVerify, setInsecureSkipTlsVerify] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handlePasteChange = (val: string) => {
    setPasteInput(val);
    const parsed = parsePastedCommand(val);
    if (parsed.server) setServer(parsed.server);
    if (parsed.token) setToken(parsed.token);
    if (parsed.insecureSkipTlsVerify !== undefined) {
      setInsecureSkipTlsVerify(parsed.insecureSkipTlsVerify);
    }
    if (parsed.namespace) setNamespace(parsed.namespace);
    if (parsed.server || parsed.token) {
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server.trim()) {
      setError('Server URL is required');
      return;
    }
    if (!token.trim()) {
      setError('Token is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.multissh.k8sLogin({
        server: server.trim(),
        token: token.trim(),
        namespace: namespace.trim() || undefined,
        insecureSkipTlsVerify,
      });

      setLoading(false);
      onSuccess?.(result);
      onClose();
    } catch (err: any) {
      setLoading(false);
      const msg = err?.message || String(err);
      setError(msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-xl max-h-[90vh] rounded-2xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
              <LogIn className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-txt-primary">OpenShift / Kubernetes Token Login</h2>
              <p className="text-xs text-txt-muted">Log in to a cluster directly without needing the local oc CLI</p>
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Quick Paste Box */}
          <div className="rounded-xl border border-border-subtle bg-app-surface p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-txt-primary">
              <div className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-red-400" />
                <span>Paste `oc login` command</span>
              </div>
              <span className="text-[11px] text-txt-muted">Auto-populates fields below</span>
            </div>
            <textarea
              rows={2}
              value={pasteInput}
              onChange={(e) => handlePasteChange(e.target.value)}
              placeholder="e.g. oc login --token=sha256~... --server=https://api.cluster.example.com:6443"
              className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle p-2 text-xs font-mono text-txt-primary placeholder:text-txt-muted/70 focus:border-red-500/50 focus:outline-none transition-colors resize-none"
            />
            <div className="flex items-start gap-1.5 text-[11px] text-txt-muted">
              <HelpCircle className="h-3 w-3 shrink-0 mt-0.5 text-txt-muted/80" />
              <span>
                Tip: In OpenShift Web Console, click your username in the top right &rarr;{' '}
                <strong className="text-txt-secondary">Copy login command</strong> &rarr;{' '}
                <strong className="text-txt-secondary">Display Token</strong>, and paste it here.
              </span>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-300 flex items-start gap-2">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 whitespace-pre-wrap">{error}</div>
            </div>
          )}

          {/* Form */}
          <form id="k8s-login-form" onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-txt-secondary mb-1">
                Server URL <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                required
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="https://api.mycluster.example.com:6443"
                className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs font-mono text-txt-primary focus:border-red-500/50 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-medium text-txt-secondary">
                  API Token <span className="text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="flex items-center gap-1 text-[11px] text-txt-muted hover:text-txt-primary transition-colors"
                >
                  {showToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showToken ? 'Hide token' : 'Show token'}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="sha256~..."
                  className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 pr-9 text-xs font-mono text-txt-primary focus:border-red-500/50 focus:outline-none transition-colors"
                />
                <KeyRound className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-txt-muted pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-txt-secondary mb-1">
                Default Project / Namespace <span className="text-txt-muted font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="Leave empty to auto-detect from user projects"
                className="w-full rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs text-txt-primary placeholder:text-txt-muted/70 focus:border-red-500/50 focus:outline-none transition-colors"
              />
            </div>

            <div className="rounded-lg border border-border-subtle/80 bg-app-surface-subtle p-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={insecureSkipTlsVerify}
                  onChange={(e) => setInsecureSkipTlsVerify(e.target.checked)}
                  className="mt-0.5 rounded border-border-subtle text-red-500 focus:ring-0"
                />
                <div className="text-xs">
                  <span className="font-medium text-txt-primary">Skip TLS certificate verification</span>
                  <p className="text-[11px] text-txt-muted mt-0.5">
                    Enable if your cluster uses private, self-signed, or internal CA certificates (equivalent to{' '}
                    <code className="rounded bg-app-surface px-1 py-0.5 text-[10px] font-mono">
                      --insecure-skip-tls-verify=true
                    </code>
                    ).
                  </p>
                </div>
              </label>
            </div>
          </form>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border-subtle bg-app-surface px-5 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-txt-muted">
            <ShieldAlert className="h-3.5 w-3.5 text-txt-muted" />
            <span>Updates ~/.kube/config automatically</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="k8s-login-form"
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 text-xs font-medium shadow-sm transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Log in & Connect</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
