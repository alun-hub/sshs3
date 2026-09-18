import React, { useEffect, useState } from 'react';
import {
  Cloud,
  Server,
  Loader2,
  UploadCloud,
  DownloadCloud,
  ShieldAlert,
  CheckCircle2,
  Pencil,
  RefreshCw,
  ArrowUpCircle,
  ArrowDownCircle,
  GitCompare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { ProfileSyncStatus, SyncComparisonResult, KnownHostsConflict } from '@shared/types/sync';
import {
  SyncTargetForm,
  emptySyncTargetDraft,
  draftFromTargetConfig,
  buildSyncTarget,
  validateSyncTargetDraft,
  type SyncTargetDraft,
} from './SyncTargetForm';
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

function formatDateTime(iso?: string): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function formatTimestampWithRelative(iso?: string): string {
  if (!iso) return 'Never';
  const rel = formatRelative(iso);
  const dt = formatDateTime(iso);
  return `${dt} (${rel})`;
}

export const SyncSettingsPanel: React.FC = () => {
  const [status, setStatus] = useState<ProfileSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [comparison, setComparison] = useState<SyncComparisonResult | null>(null);
  const [checkingSync, setCheckingSync] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

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

  const checkSync = async () => {
    setCheckingSync(true);
    setCheckError(null);
    try {
      const res = await window.multissh?.profileSyncCompare?.();
      if (res) {
        setComparison(res);
      }
    } catch (err: any) {
      setCheckError(err?.message || 'Failed to check sync status.');
    } finally {
      setCheckingSync(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const s = await window.multissh?.profileSyncStatus?.();
      if (s) {
        setStatus(s);
        if (s.targetConfig) {
          setTargetDraft(draftFromTargetConfig(s.targetConfig, s.remoteBasePath ?? ''));
        }
        if (s.comparison) {
          setComparison(s.comparison);
        }
        if (!s.configured) {
          setEditingTarget(true);
        } else if (s.topologyUnlocked && s.credentialsUnlocked) {
          void checkSync();
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
      if (s?.comparison) {
        setComparison(s.comparison);
      } else {
        void checkSync();
      }
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
      if (s?.comparison) {
        setComparison(s.comparison);
      } else {
        void checkSync();
      }
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
      if (result?.comparison) {
        setComparison(result.comparison);
      } else {
        void checkSync();
      }
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
                if (status.targetConfig) {
                  setTargetDraft(draftFromTargetConfig(status.targetConfig, status.remoteBasePath ?? ''));
                } else {
                  setTargetDraft((prev) => ({ ...prev, remoteBasePath: status.remoteBasePath ?? prev.remoteBasePath }));
                }
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
            Last sync: {formatTimestampWithRelative(status.lastSyncAt)}
          </div>

          {status.topologyUnlocked && status.credentialsUnlocked && (
            <div className="rounded-lg border border-border-subtle bg-app-bg/50 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {checkingSync ? (
                    <div className="flex items-center gap-1.5 text-txt-muted text-xs">
                      <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                      <span>Checking remote sync state...</span>
                    </div>
                  ) : comparison ? (
                    <div className="flex items-center gap-2">
                      {comparison.state === 'in_sync' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          In sync with remote
                        </span>
                      )}
                      {comparison.state === 'ahead' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 px-2.5 py-0.5 text-[11px] font-medium text-sky-400">
                          <ArrowUpCircle className="h-3.5 w-3.5" />
                          Client ahead ({comparison.aheadCount} unpushed {comparison.aheadCount === 1 ? 'change' : 'changes'})
                        </span>
                      )}
                      {comparison.state === 'behind' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
                          <ArrowDownCircle className="h-3.5 w-3.5" />
                          Client behind ({comparison.behindCount} remote {comparison.behindCount === 1 ? 'change' : 'changes'})
                        </span>
                      )}
                      {comparison.state === 'diverged' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 px-2.5 py-0.5 text-[11px] font-medium text-purple-400">
                          <GitCompare className="h-3.5 w-3.5" />
                          Diverged ({comparison.aheadCount} ahead, {comparison.behindCount} behind)
                        </span>
                      )}
                      {comparison.state === 'not_initialized' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 text-[11px] font-medium text-indigo-400">
                          <UploadCloud className="h-3.5 w-3.5" />
                          Remote not initialized ({comparison.aheadCount} {comparison.aheadCount === 1 ? 'item' : 'items'} to push)
                        </span>
                      )}
                      {comparison.state === 'error' && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-[11px] font-medium text-red-400">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Sync check failed
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-txt-muted">Sync status not checked yet</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void checkSync()}
                  disabled={checkingSync || pushing || pulling}
                  title="Check status against remote"
                  className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-txt-muted hover:text-txt-primary hover:bg-app-surface transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-3 w-3 ${checkingSync ? 'animate-spin' : ''}`} />
                  <span>Check</span>
                </button>
              </div>

              {comparison && comparison.checkedAt && (
                <div className="flex items-center justify-between text-[10px] text-txt-muted">
                  <span>Checked: {formatDateTime(comparison.checkedAt)}</span>
                  {(comparison.aheadCount > 0 || comparison.behindCount > 0) && (
                    <button
                      type="button"
                      onClick={() => setShowDetails((prev) => !prev)}
                      className="flex items-center gap-0.5 text-sky-400 hover:underline"
                    >
                      <span>{showDetails ? 'Hide details' : 'Show details'}</span>
                      {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              )}

              {showDetails && comparison && (comparison.aheadCount > 0 || comparison.behindCount > 0) && (
                <div className="space-y-1.5 pt-1.5 border-t border-border-subtle/50 text-[11px]">
                  {comparison.categories.map((cat) => {
                    if (cat.state === 'in_sync' && cat.ahead === 0 && cat.behind === 0) return null;
                    return (
                      <div key={cat.category} className="flex items-start justify-between gap-2 text-txt-secondary">
                        <span className="font-medium capitalize">{cat.category.replace('-', ' ')}:</span>
                        <span className="text-txt-muted text-right">
                          {cat.state === 'ahead' && `${cat.ahead} to push`}
                          {cat.state === 'behind' && `${cat.behind} to pull`}
                          {cat.state === 'diverged' && `${cat.ahead} to push, ${cat.behind} to pull`}
                          {cat.details && cat.details.length > 0 && (
                            <span className="block text-[10px] text-txt-muted/80">{cat.details.join(', ')}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {checkError && <p className="text-[11px] text-red-400">{checkError}</p>}
            </div>
          )}

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
                  disabled={pushing || checkingSync}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    comparison?.aheadCount && comparison.aheadCount > 0
                      ? 'border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20'
                      : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                  }`}
                >
                  {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                  <span>Push</span>
                  {comparison?.aheadCount && comparison.aheadCount > 0 ? (
                    <span className="rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-sky-300">
                      {comparison.aheadCount}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={handlePull}
                  disabled={pulling || checkingSync}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    comparison?.behindCount && comparison.behindCount > 0
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                      : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
                  }`}
                >
                  {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
                  <span>Pull</span>
                  {comparison?.behindCount && comparison.behindCount > 0 ? (
                    <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-amber-300">
                      {comparison.behindCount}
                    </span>
                  ) : null}
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
                onClick={() => {
                  setEditingTarget(false);
                  if (status?.targetConfig) {
                    setTargetDraft(draftFromTargetConfig(status.targetConfig, status.remoteBasePath ?? ''));
                  }
                }}
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
