import React from 'react';
import { Globe, Loader2 } from 'lucide-react';

interface OpenShiftWebLoginSectionProps {
  supported: boolean;
  waiting: boolean;
  onStart: () => void;
  onCancel: () => void;
}

/** Browser sign-in for OpenShift clusters whose OAuth server was detected; renders nothing otherwise. */
export const OpenShiftWebLoginSection: React.FC<OpenShiftWebLoginSectionProps> = ({
  supported,
  waiting,
  onStart,
  onCancel,
}) => {
  if (!supported && !waiting) return null;

  return (
    <div
      data-testid="openshift-web-login"
      className="rounded-xl border border-border-subtle bg-app-surface p-3.5 space-y-2"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-txt-primary">
        <Globe className="h-3.5 w-3.5 text-red-400" />
        <span>Sign in with your browser</span>
      </div>
      {waiting ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-txt-muted" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Waiting for browser sign-in… Finish logging in, then return here.</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-txt-muted">
            No token to copy: uses your cluster&apos;s own login (OpenShift 4.13 or newer). Press Enter in the server
            field to start.
          </p>
          <button
            type="button"
            onClick={onStart}
            className="shrink-0 flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white px-3.5 py-1.5 text-xs font-medium shadow-sm transition-colors"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Sign in with browser</span>
          </button>
        </div>
      )}
    </div>
  );
};
