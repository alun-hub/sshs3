import React, { useState, useRef, useEffect } from 'react';
import { ShieldCheck, Shield, Loader2, RefreshCw, LogOut, KeyRound, AlertCircle } from 'lucide-react';
import { useSshCa } from '../../lib/useSshCa';
import { formatDateTime } from '../../lib/dateFormat';

interface SshCaStatusBadgeProps {
  onOpenSettings?: () => void;
}

export const SshCaStatusBadge: React.FC<SshCaStatusBadgeProps> = ({ onOpenSettings }) => {
  const { status, loading, error, login, logout, renew } = useSshCa();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu on click outside or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const formatRemaining = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return 'Expired';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }
    return `${minutes}m remaining`;
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="ssh-ca-status-btn"
        aria-label="SSH Certificate Authority"
        aria-haspopup="true"
        aria-expanded={isOpen}
        title={
          status.active
            ? `SSH CA: Active (${status.username}) — ${formatRemaining(status.validSecondsRemaining)}`
            : 'SSH CA: Inactive (Click to log in)'
        }
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-app-surface-hover ${
          status.active
            ? 'text-emerald-400 hover:text-emerald-300'
            : 'text-txt-muted hover:text-txt-primary'
        }`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
        ) : status.active ? (
          <ShieldCheck className="h-4 w-4" />
        ) : (
          <Shield className="h-4 w-4" />
        )}
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="dialog"
          aria-label="SSH CA Status"
          className="absolute right-0 top-8 z-50 w-72 rounded-lg border border-app-border bg-app-card p-3 shadow-xl text-xs text-txt-primary animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="flex items-center justify-between border-b border-app-border/60 pb-2 mb-2.5">
            <div className="flex items-center gap-1.5 font-semibold text-txt-primary">
              {status.active ? (
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              ) : (
                <Shield className="h-4 w-4 text-txt-muted" />
              )}
              <span>SSH Certificate Authority</span>
            </div>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                status.active
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-zinc-800 text-txt-muted border border-zinc-700'
              }`}
            >
              {status.active ? 'Active' : 'Inactive'}
            </span>
          </div>

          {error && (
            <div className="mb-2.5 flex items-start gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300 text-[11px]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {status.active && status.certInfo ? (
            <div className="space-y-1.5 mb-3 text-[11px]">
              <div className="flex justify-between">
                <span className="text-txt-muted">User:</span>
                <span className="font-mono font-medium">{status.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">Principals:</span>
                <span className="font-mono font-medium truncate max-w-[170px]" title={status.principals?.join(', ')}>
                  {status.principals?.join(', ') || '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">Valid Until:</span>
                <span className="font-medium">{formatDateTime(status.expiresAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">Time Left:</span>
                <span className="font-medium text-emerald-400">
                  {formatRemaining(status.validSecondsRemaining)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-txt-muted">Serial:</span>
                <span className="font-mono text-[10px] text-txt-muted truncate max-w-[170px]" title={status.certInfo.serial}>
                  {status.certInfo.serial}
                </span>
              </div>
            </div>
          ) : (
            <div className="mb-3 text-[11px] text-txt-muted">
              No active SSH CA certificate. Log in with your identity provider to acquire an ephemeral certificate for SSH authentication.
            </div>
          )}

          <div className="flex flex-col gap-1.5 pt-1 border-t border-app-border/40">
            {status.active ? (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    try {
                      await renew();
                    } catch {
                      // Handled by hook error state
                    }
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-app-border bg-app-surface px-2.5 py-1.5 text-xs font-medium text-txt-primary hover:bg-app-surface-hover transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Renew Certificate
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    try {
                      await logout();
                      setIsOpen(false);
                    } catch {
                      // Handled by hook error state
                    }
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Log Out
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    try {
                      await login();
                    } catch {
                      // Handled by hook error state
                    }
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  Log In with SSH CA
                </button>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onOpenSettings();
                    }}
                    className="flex w-full items-center justify-center gap-1 text-[11px] text-txt-muted hover:text-txt-primary transition-colors py-1"
                  >
                    Configure in Settings
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
