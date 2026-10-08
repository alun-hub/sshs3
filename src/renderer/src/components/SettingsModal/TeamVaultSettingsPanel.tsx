import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  DownloadCloud,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Shield,
  Trash2,
  Unlock,
  UploadCloud,
  Users,
} from 'lucide-react';
import type { TeamVaultRole, TeamVaultStatus } from '@shared/types/teamVault';
import { SyncTargetForm, emptySyncTargetDraft, buildSyncTarget, type SyncTargetDraft } from './SyncTargetForm';
import { describeIpcError } from '../../lib/format';
import { formatDateTime } from '../../lib/dateFormat';
import { useConfirm } from '../ConfirmDialog';

function emptyS3TargetDraft(): SyncTargetDraft {
  return { ...emptySyncTargetDraft(), type: 's3' };
}

/** Admin UI for the local Team Vault (docs/team-vault-plan.md Fas 2 — a single local vault, no
 * S3 sync yet; Fas 3 adds remote read/write on top of the same `window.multissh.teamVault*`
 * calls used here). */
export const TeamVaultSettingsPanel: React.FC = () => {
  const confirm = useConfirm();
  const [status, setStatus] = useState<TeamVaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // "Generate my recipient" — produces the age1yubikey1... string this device's PIV card will
  // use, either to create the vault as its first admin or to join an existing one.
  const [enrolling, setEnrolling] = useState(false);
  const [myRecipient, setMyRecipient] = useState<{ recipient: string; identityFilePath: string } | null>(null);
  const [selfRecipientId, setSelfRecipientId] = useState('');

  const [creating, setCreating] = useState(false);
  const [recoveryIdentity, setRecoveryIdentity] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);

  // Unlock (needed for add/remove — see TeamVaultService.unlock's doc comment on the still-open
  // PIN question).
  const [unlockRecipientId, setUnlockRecipientId] = useState('');
  const [unlockIdentityPath, setUnlockIdentityPath] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  // Add member
  const [newRecipientId, setNewRecipientId] = useState('');
  const [newAgeRecipient, setNewAgeRecipient] = useState('');
  const [newRole, setNewRole] = useState<TeamVaultRole>('member');
  const [addingMember, setAddingMember] = useState(false);

  const [busyRecipientId, setBusyRecipientId] = useState<string | null>(null);

  // S3 target config + push/pull (Fas 3)
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetDraft, setTargetDraft] = useState<SyncTargetDraft>(emptyS3TargetDraft());
  const [targetError, setTargetError] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [hasRemoteVault, setHasRemoteVault] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await window.multissh.teamVaultGetStatus();
      setStatus(s);
      if (!s.exists && s.remoteConfigured) {
        setHasRemoteVault(await window.multissh.teamVaultHasRemoteVault());
      } else {
        setHasRemoteVault(false);
      }
    } catch (err) {
      setError(describeIpcError(err, 'Failed to load Team Vault status'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleEnroll = async () => {
    setEnrolling(true);
    setError(null);
    try {
      const result = await window.multissh.teamVaultEnrollRecipient();
      setMyRecipient(result);
    } catch (err) {
      setError(describeIpcError(err, 'Failed to generate a recipient from this PIV card'));
    } finally {
      setEnrolling(false);
    }
  };

  const handleCreateVault = async () => {
    if (!myRecipient || !selfRecipientId.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const { recoveryIdentity: identity } = await window.multissh.teamVaultCreate(
        selfRecipientId.trim(),
        myRecipient.recipient
      );
      setRecoveryIdentity(identity);
      setRecoverySaved(false);
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to create the Team Vault'));
    } finally {
      setCreating(false);
    }
  };

  const handleUnlock = async () => {
    if (!unlockRecipientId.trim() || !unlockIdentityPath.trim()) return;
    setUnlocking(true);
    setError(null);
    try {
      await window.multissh.teamVaultUnlock(unlockRecipientId.trim(), unlockIdentityPath.trim());
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to unlock the Team Vault'));
    } finally {
      setUnlocking(false);
    }
  };

  const handleAddMember = async () => {
    if (!newRecipientId.trim() || !newAgeRecipient.trim() || !status) return;
    setAddingMember(true);
    setError(null);
    try {
      await window.multissh.teamVaultAddMember(newRecipientId.trim(), newAgeRecipient.trim(), newRole, 'me');
      setNewRecipientId('');
      setNewAgeRecipient('');
      setNewRole('member');
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to add member'));
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (recipientId: string) => {
    if (!(await confirm({
      title: 'Remove member',
      message: `Remove "${recipientId}" from the Team Vault? They keep whatever they already synced, but lose access to anything added after this.`,
    }))) {
      return;
    }
    setBusyRecipientId(recipientId);
    setError(null);
    try {
      await window.multissh.teamVaultRemoveMember(recipientId, 'me');
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to remove member'));
    } finally {
      setBusyRecipientId(null);
    }
  };

  const handleSetRole = async (recipientId: string, role: TeamVaultRole) => {
    setBusyRecipientId(recipientId);
    setError(null);
    try {
      await window.multissh.teamVaultSetRole(recipientId, role, 'me');
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to change role'));
    } finally {
      setBusyRecipientId(null);
    }
  };

  // There's nothing to prefill from: the renderer never receives the saved target's secrets back
  // (same principle as every other credential field in this app), so editing always starts from
  // a blank S3 draft — the admin re-enters the target if they want to change it.
  const openEditTarget = () => {
    setTargetDraft(emptyS3TargetDraft());
    setTargetError(null);
    setEditingTarget(true);
  };

  const handleSaveTarget = async () => {
    if (targetDraft.type !== 's3') {
      setTargetError('The Team Vault only supports an S3-compatible target.');
      return;
    }
    if (!targetDraft.remoteBasePath.trim()) {
      setTargetError('A bucket (optionally "bucket/prefix") is required.');
      return;
    }
    if (!targetDraft.accessKeyId?.trim() || !targetDraft.secretAccessKey) {
      setTargetError('Access key ID and secret access key are required.');
      return;
    }
    setTargetError(null);
    setSavingTarget(true);
    try {
      await window.multissh.teamVaultSetTarget(buildSyncTarget(targetDraft), targetDraft.remoteBasePath);
      setEditingTarget(false);
      await load();
    } catch (err) {
      setTargetError(describeIpcError(err, 'Failed to save the Team Vault target'));
    } finally {
      setSavingTarget(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    try {
      await window.multissh.teamVaultPush();
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Push failed'));
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setError(null);
    try {
      await window.multissh.teamVaultPull();
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Pull failed'));
    } finally {
      setPulling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-txt-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Team Vault status...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-txt-primary">
          <Shield className="h-4 w-4 text-sky-400" />
          Team Vault
        </h3>
        <p className="mt-1 text-xs text-txt-muted">
          Share connection profiles and system credentials with your team, unlocked per-member by
          PIV hardware key instead of a shared password.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {!status?.exists ? (
        <div className="space-y-3 rounded-lg border border-border-subtle bg-app-surface p-4">
          {hasRemoteVault && (
            <div className="space-y-2 rounded-lg border border-sky-900/50 bg-sky-950/20 p-3">
              <p className="text-xs text-sky-300">
                Your team already has a Team Vault at the configured S3 target. Pull it instead of
                creating a new one.
              </p>
              <button
                type="button"
                onClick={() => void handlePull()}
                disabled={pulling}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
                Pull existing vault
              </button>
            </div>
          )}

          <p className="text-xs text-txt-secondary">
            No Team Vault exists on this machine yet. Generate a recipient from your PIV card,
            then create the vault with yourself as its first admin.
          </p>

          <button
            type="button"
            onClick={() => void handleEnroll()}
            disabled={enrolling}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
          >
            {enrolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5 text-sky-400" />}
            Generate my recipient
          </button>

          {myRecipient && (
            <div className="space-y-2 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-3">
              <p className="break-all text-xs text-emerald-300">{myRecipient.recipient}</p>
              <div>
                <label className="mb-1 block text-xs font-medium text-txt-secondary">Your recipient id</label>
                <input
                  type="text"
                  value={selfRecipientId}
                  onChange={(e) => setSelfRecipientId(e.target.value)}
                  placeholder="e.g. alice@piv:yubikey-1"
                  className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleCreateVault()}
                disabled={creating || !selfRecipientId.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create Vault
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-border-subtle bg-app-surface p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-txt-muted">Vault</span>
              <span className="font-mono text-txt-secondary">{status.vaultId}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-txt-muted">Status</span>
              <span className={status.unlocked ? 'text-emerald-400' : 'text-amber-400'}>
                {status.unlocked ? 'Unlocked for this session' : 'Locked'}
              </span>
            </div>
          </div>

          {(status.adminCount ?? 0) < 2 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This vault has fewer than 2 admins. If the sole admin loses their card, only the
              recovery key can restore access.
            </div>
          )}

          {!status.unlocked && (
            <div className="space-y-2 rounded-lg border border-border-subtle bg-app-surface p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-txt-secondary">
                <Lock className="h-3.5 w-3.5 text-amber-400" />
                Unlock to add, remove, or promote members
              </p>
              <input
                type="text"
                value={unlockRecipientId}
                onChange={(e) => setUnlockRecipientId(e.target.value)}
                placeholder="Your recipient id"
                className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
              />
              <input
                type="text"
                value={unlockIdentityPath}
                onChange={(e) => setUnlockIdentityPath(e.target.value)}
                placeholder="Path to your identity file"
                className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
              />
              <button
                type="button"
                onClick={() => void handleUnlock()}
                disabled={unlocking || !unlockRecipientId.trim() || !unlockIdentityPath.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {unlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                Unlock
              </button>
            </div>
          )}

          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-txt-secondary">
              <Users className="h-3.5 w-3.5 text-sky-400" />
              Members ({status.members?.length ?? 0})
            </p>
            <div className="space-y-1.5">
              {(status.members ?? []).map((m) => (
                <div
                  key={m.recipientId}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-txt-primary">{m.recipientId}</div>
                    <div className="text-txt-muted">{m.role}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleSetRole(m.recipientId, m.role === 'admin' ? 'member' : 'admin')}
                      disabled={busyRecipientId === m.recipientId}
                      className="rounded-lg border border-border-subtle px-2 py-1 text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
                    >
                      {m.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveMember(m.recipientId)}
                      disabled={busyRecipientId === m.recipientId}
                      title="Remove member"
                      className="rounded-lg border border-red-900/60 p-1.5 text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-lg border border-border-subtle bg-app-surface p-3">
            <p className="text-xs font-medium text-txt-secondary">Add a member</p>
            <input
              type="text"
              value={newRecipientId}
              onChange={(e) => setNewRecipientId(e.target.value)}
              placeholder="Their recipient id (e.g. bob@piv:yubikey-1)"
              className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            />
            <input
              type="text"
              value={newAgeRecipient}
              onChange={(e) => setNewAgeRecipient(e.target.value)}
              placeholder="Their age1yubikey1... recipient string"
              className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as TeamVaultRole)}
              className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="button"
              onClick={() => void handleAddMember()}
              disabled={addingMember || !newRecipientId.trim() || !newAgeRecipient.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {addingMember && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add member
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-border-subtle bg-app-surface p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-txt-secondary">
          <Cloud className="h-3.5 w-3.5 text-sky-400" />
          Remote sync (S3)
        </p>

        {!editingTarget ? (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-txt-muted">
                {status?.remoteConfigured ? 'S3 target configured' : 'No S3 target configured yet'}
              </span>
              <button
                type="button"
                onClick={openEditTarget}
                className="flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-txt-secondary hover:bg-app-surface-hover"
              >
                <Pencil className="h-3 w-3" />
                {status?.remoteConfigured ? 'Edit target' : 'Configure target'}
              </button>
            </div>
            {status?.remoteConfigured && (
              <>
                <div className="flex items-center justify-between text-xs text-txt-muted">
                  <span>Last synced</span>
                  <span>{status.lastSyncAt ? formatDateTime(status.lastSyncAt) : 'Never'}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handlePush()}
                    disabled={pushing || !status?.exists}
                    className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
                  >
                    {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                    Push
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePull()}
                    disabled={pulling}
                    className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
                  >
                    {pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
                    Pull
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {targetError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {targetError}
              </div>
            )}
            <SyncTargetForm draft={targetDraft} onChange={setTargetDraft} disabled={savingTarget} />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTarget(false)}
                disabled={savingTarget}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTarget()}
                disabled={savingTarget}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {savingTarget && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save target
              </button>
            </div>
          </div>
        )}
      </div>

      {recoveryIdentity && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Save your recovery key"
            className="w-full max-w-lg space-y-3 rounded-xl border border-amber-500/40 bg-app-surface p-4 shadow-2xl"
          >
            <div className="flex items-center gap-2 text-amber-400">
              <KeyRound className="h-4 w-4" />
              <h4 className="text-sm font-semibold">Save your recovery key now</h4>
            </div>
            <p className="text-xs text-txt-secondary">
              This is the Team Vault's recovery identity. It is shown <strong>once</strong> and
              never saved by the app — print it and store it somewhere safe (e.g. a safe), per
              docs/team-vault-plan.md §4.1. Anyone who recovers this text can decrypt the vault.
            </p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border-subtle bg-app-input p-3 text-xs text-txt-primary">
              {recoveryIdentity}
            </pre>
            <label className="flex items-center gap-2 text-xs text-txt-secondary">
              <input
                type="checkbox"
                checked={recoverySaved}
                onChange={(e) => setRecoverySaved(e.target.checked)}
              />
              I have printed/saved this recovery key
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!recoverySaved}
                onClick={() => setRecoveryIdentity(null)}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
