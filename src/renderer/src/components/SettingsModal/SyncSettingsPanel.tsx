import React, { useEffect, useState } from 'react';
import { Cloud, Server, Loader2, UploadCloud, DownloadCloud, ShieldAlert, CheckCircle2, Pencil } from 'lucide-react';
import type { ProfileSyncStatus } from '@shared/types/sync';
import type { KnownHostsConflict } from '@shared/types/sync';
import { SyncTargetForm, emptySyncTargetDraft, buildSyncTarget, validateSyncTargetDraft, type SyncTargetDraft } from './SyncTargetForm';
import { MasterPasswordDialog } from './MasterPasswordDialog';

function formatRelative(iso?: string): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export const SyncSettingsPanel: React.FC = () => {
  const [status, setStatus] = useState<ProfileSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingTarget, setEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState<SyncTargetDraft>(emptySyncTargetDraft());
  const [targetError, setTargetError] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<KnownHostsConflict[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const s = await window.multissh?.profileSyncStatus?.();
      if (s) {
        setStatus(s);
        if (!s.configured) {
          setEditingTarget(true);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSaveTarget = async () => {
    const validationError = validateSyncTargetDraft(targetDraft);
    if (validationError) {
      setTargetError(validationError);
      return;
    }
    setTargetError(null);
    setSavingTarget(true);
    try {
      await window.multissh?.profileSyncSetup?.({
        target: buildSyncTarget(targetDraft),
        remoteBasePath: targetDraft.remoteBasePath,
      });
      setEditingTarget(false);
      setActionMessage('Sync target saved.');
      await load();
    } catch (err: any) {
      setTargetError(err?.message || 'Failed to save the sync target.');
    } finally {
      setSavingTarget(false);
    }
  };

  const handlePasswordSubmit = async (passwords: { topologyPassword: string; credentialsPassword: string }) => {
    setEnabling(true);
    setEnableError(null);
    try {
      const s = await window.multissh?.profileSyncEnable?.(passwords);
      setStatus(s);
      setPasswordDialogOpen(false);
      setActionMessage('Sync unlocked and up to date.');
    } catch (err: any) {
      setEnableError(err?.message || 'Failed to unlock sync.');
    } finally {
      setEnabling(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const s = await window.multissh?.profileSyncPush?.();
      setStatus(s);
      setActionMessage('Pushed local changes to the remote.');
    } catch (err: any) {
      setActionError(err?.message || 'Push failed.');
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setActionError(null);
    setActionMessage(null);
    setConflicts([]);
    try {
      const result = await window.multissh?.profileSyncPull?.();
      setStatus(result);
      setConflicts(result.sshNativeConflicts ?? []);
      setActionMessage(
        result.changedCategories.length > 0
          ? `Pulled changes: ${result.changedCategories.join(', ')}.`
          : 'Already up to date.'
      );
    } catch (err: any) {
      setActionError(err?.message || 'Pull failed.');
    } finally {
      setPulling(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-xs text-txt-muted">Loading sync status...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-[11px] text-txt-muted leading-relaxed">
          Back up and sync your connection profiles, dotfile pools, and settings to your own S3 bucket or SFTP
          server. Everything is encrypted on this device before it ever leaves — with two independent master
          passwords, so a topology password can be shared with a team later without exposing saved credentials.
        </p>
      </div>

      {status?.configured && !editingTarget && (
        <div className="rounded-lg border border-border-subtle bg-app-surface p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-txt-primary font-medium">
              {status.target?.type === 's3' ? <Cloud className="h-4 w-4 text-sky-400" /> : <Server className="h-4 w-4 text-sky-400" />}
              <span>{status.target?.type === 's3' ? 'S3 bucket' : 'SFTP server'}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingTarget(true);
                setTargetDraft((prev) => ({ ...prev, remoteBasePath: status.remoteBasePath ?? prev.remoteBasePath }));
              }}
              className="flex items-center gap-1 text-[11px] text-sky-400 hover:underline"
            >
              <Pencil className="h-3 w-3" />
              Change target
            </button>
          </div>
          {status.remoteBasePath && <div className="font-mono text-[11px] text-txt-muted">{status.remoteBasePath}</div>}

          <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
            <div className="flex items-center gap-1.5">
              {status.topologyUnlocked ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
              )}
              <span className="text-txt-secondary">Topology {status.topologyUnlocked ? 'unlocked' : 'locked'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {status.credentialsUnlocked ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
              )}
              <span className="text-txt-secondary">Credentials {status.credentialsUnlocked ? 'unlocked' : 'locked'}</span>
            </div>
          </div>

          <div className="text-[11px] text-txt-muted pt-1 border-t border-border-subtle">
            Last sync: {formatRelative(status.lastSyncAt)}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {(!status.topologyUnlocked || !status.credentialsUnlocked) && (
              <button
                type="button"
                onClick={() => setPasswordDialogOpen(true)}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors"
              >
                {status.hasLocalSalts ? 'Unlock sync' : 'Set up master passwords'}
              </button>
            )}
            {status.topologyUnlocked && status.credentialsUnlocked && (
              <>
                <button
                  type="button"
                  onClick={handlePush}
                  disabled={pushing}
                  className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors disabled:opacity-50"
                >
                  {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  Push
                </button>
                <button
                  type="button"
                  onClick={handlePull}
                  disabled={pulling}
                  className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors disabled:opacity-50"
                >
                  {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
                  Pull
                </button>
              </>
            )}
          </div>

          {actionMessage && <p className="text-[11px] text-emerald-400">{actionMessage}</p>}
          {actionError && <p className="text-[11px] text-red-400">{actionError}</p>}

          {conflicts.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
              <div className="flex items-center gap-1.5 text-amber-300 font-medium text-[11px]">
                <ShieldAlert className="h-3.5 w-3.5" />
                {conflicts.length} known_hosts conflict{conflicts.length > 1 ? 's' : ''} — not applied automatically
              </div>
              {conflicts.map((c) => (
                <div key={c.hostPatternField} className="font-mono text-[10px] text-amber-200 leading-relaxed">
                  <div>{c.hostPatternField}</div>
                  <div className="pl-2 text-amber-300/80">local: {c.localFingerprint}</div>
                  <div className="pl-2 text-amber-300/80">remote: {c.remoteFingerprint}</div>
                </div>
              ))}
              <p className="text-[10px] text-amber-200/80 leading-relaxed">
                This host has a different key locally than on the remote — a possible sign of a rotated or spoofed
                key. Review it yourself (e.g. with <code>ssh-keygen -R</code>) before trusting either one; sync will
                never overwrite a local known_hosts entry automatically.
              </p>
            </div>
          )}
        </div>
      )}

      {editingTarget && (
        <div className="space-y-3 rounded-lg border border-border-subtle bg-app-surface p-3.5">
          <SyncTargetForm draft={targetDraft} onChange={setTargetDraft} disabled={savingTarget} />
          {targetError && <p className="text-[11px] text-red-400">{targetError}</p>}
          <div className="flex items-center justify-end gap-2">
            {status?.configured && (
              <button
                type="button"
                onClick={() => setEditingTarget(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveTarget}
              disabled={savingTarget}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shadow-sm transition-colors disabled:opacity-50"
            >
              {savingTarget && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save target
            </button>
          </div>
        </div>
      )}

      <MasterPasswordDialog
        open={passwordDialogOpen}
        mode={status?.hasLocalSalts ? 'unlock' : 'setup'}
        title={status?.hasLocalSalts ? 'Unlock sync' : 'Set up master passwords'}
        description={
          status?.hasLocalSalts
            ? 'Enter your existing master passwords to unlock sync for this session.'
            : 'Choose the two master passwords that will encrypt your synced data. They are never sent anywhere or stored on disk.'
        }
        submitLabel={status?.hasLocalSalts ? 'Unlock' : 'Activate sync'}
        submitting={enabling}
        error={enableError}
        onCancel={() => {
          setPasswordDialogOpen(false);
          setEnableError(null);
        }}
        onSubmit={handlePasswordSubmit}
      />
    </div>
  );
};

export default SyncSettingsPanel;
