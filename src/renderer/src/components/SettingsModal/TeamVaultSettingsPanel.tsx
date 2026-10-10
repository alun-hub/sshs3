import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Cloud,
  Copy,
  DownloadCloud,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Shield,
  ShieldOff,
  Trash2,
  Unlock,
  UploadCloud,
  Users,
} from 'lucide-react';
import type { TeamVaultRole, TeamVaultStatus } from '@shared/types/teamVault';
import { SyncTargetForm, emptySyncTargetDraft, buildSyncTarget, type SyncTargetDraft } from './SyncTargetForm';
import { describeIpcError } from '../../lib/format';
import { formatDateTime } from '../../lib/dateFormat';
import { buildTeamVaultJoinInfo, parseTeamVaultJoinInfo } from '../../lib/teamVaultJoinInfo';
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

  // "Generate my Team Vault ID" — produces the age1yubikey1... string this device's PIV card
  // will use, either to create the vault as its first admin or to join an existing one. Named
  // for what it means to the user (their personal ID for Team Vault access), not the underlying
  // age/PIV jargon.
  const [enrolling, setEnrolling] = useState(false);
  const [myRecipient, setMyRecipient] = useState<{ recipient: string; identityFilePath: string } | null>(null);
  const [selfRecipientId, setSelfRecipientId] = useState('');
  const [joinInfoCopied, setJoinInfoCopied] = useState(false);

  const [creating, setCreating] = useState(false);
  const [vaultNameDraft, setVaultNameDraft] = useState('');
  const [recoveryIdentity, setRecoveryIdentity] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  // Rename the vault (admin only) — the descriptive name shown instead of the opaque vaultId.
  const [editingVaultName, setEditingVaultName] = useState(false);
  const [vaultNameEdit, setVaultNameEdit] = useState('');
  const [savingVaultName, setSavingVaultName] = useState(false);

  // Unlock (needed for add/remove — see TeamVaultService.unlock's doc comment on the still-open
  // PIN question).
  const [unlockRecipientId, setUnlockRecipientId] = useState('');
  const [unlockIdentityPath, setUnlockIdentityPath] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  // Shown only as a fallback (multiple identities, a new machine, or a lost config) — when
  // status.selfRecipientId/selfIdentityFilePath are already known, unlocking needs no fields at
  // all, just a button (found to be a real usability problem otherwise — see docs/team-vault-plan.md).
  const [showManualUnlock, setShowManualUnlock] = useState(false);

  // Recover using the saved recovery key text — guided alternative to "Use a different identity"
  // for someone who has only the printed/saved recovery identity, not a file path and not the
  // internal recipientId (both handled by teamVaultUnlockWithRecoveryText).
  const [showRecoveryUnlock, setShowRecoveryUnlock] = useState(false);
  const [recoveryTextInput, setRecoveryTextInput] = useState('');
  const [recovering, setRecovering] = useState(false);

  const [deletingVault, setDeletingVault] = useState(false);

  // Add member — the admin pastes the whole join-info blob a new member copies from their own
  // "Generate my Team Vault ID" step (see buildTeamVaultJoinInfo); parsed automatically so the admin
  // never has to hand-copy the long age1yubikey1... string themselves.
  const [joinInfoPaste, setJoinInfoPaste] = useState('');
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
      // Prefill rather than making the admin retype/relocate these every session — found to be a
      // real usability problem during end-to-end testing (see docs/team-vault-plan.md). Only
      // fills an empty field, so it never clobbers something the admin already typed this
      // session (e.g. unlocking as a different member than the one remembered).
      setUnlockRecipientId((prev) => prev || s.selfRecipientId || '');
      setUnlockIdentityPath((prev) => prev || s.selfIdentityFilePath || '');
      setSelfRecipientId((prev) => prev || s.selfRecipientId || '');
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
      // Best-effort suggestion from an existing smartcard cert's UPN — never overwrites something
      // the admin already typed.
      if (result.suggestedLabel) {
        setSelfRecipientId((prev) => prev || result.suggestedLabel || '');
      }
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
        myRecipient.recipient,
        vaultNameDraft.trim()
      );
      setRecoveryIdentity(identity);
      setRecoverySaved(false);
      setRecoveryCopied(false);
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to create the Team Vault'));
    } finally {
      setCreating(false);
    }
  };

  const handleRenameVault = async () => {
    setSavingVaultName(true);
    setError(null);
    try {
      await window.multissh.teamVaultRename(vaultNameEdit.trim());
      setEditingVaultName(false);
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to rename the vault'));
    } finally {
      setSavingVaultName(false);
    }
  };

  const handleCopyJoinInfo = async () => {
    if (!myRecipient || !selfRecipientId.trim()) return;
    try {
      await navigator.clipboard.writeText(buildTeamVaultJoinInfo(selfRecipientId.trim(), myRecipient.recipient));
      setJoinInfoCopied(true);
      setTimeout(() => setJoinInfoCopied(false), 3000);
    } catch {
      setError('Failed to copy join info to clipboard');
    }
  };

  const handleCopyRecovery = async () => {
    if (!recoveryIdentity) return;
    try {
      await navigator.clipboard.writeText(recoveryIdentity);
      setRecoveryCopied(true);
      setTimeout(() => setRecoveryCopied(false), 3000);
    } catch {
      setError('Failed to copy recovery key to clipboard');
    }
  };

  const handleJoinInfoPaste = (value: string) => {
    setJoinInfoPaste(value);
    const parsed = parseTeamVaultJoinInfo(value);
    if (parsed) {
      setNewRecipientId(parsed.recipientId);
      setNewAgeRecipient(parsed.ageRecipient);
    } else {
      setNewAgeRecipient('');
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

  const handleUnlockWithRecovery = async () => {
    if (!recoveryTextInput.trim()) return;
    setRecovering(true);
    setError(null);
    try {
      await window.multissh.teamVaultUnlockWithRecoveryText(recoveryTextInput);
      setRecoveryTextInput('');
      setShowRecoveryUnlock(false);
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to recover the Team Vault with that key'));
    } finally {
      setRecovering(false);
    }
  };

  const handleAddMember = async () => {
    if (!newRecipientId.trim() || !newAgeRecipient.trim() || !status) return;
    setAddingMember(true);
    setError(null);
    try {
      await window.multissh.teamVaultAddMember(newRecipientId.trim(), newAgeRecipient.trim(), newRole);
      setJoinInfoPaste('');
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
      await window.multissh.teamVaultRemoveMember(recipientId);
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to remove member'));
    } finally {
      setBusyRecipientId(null);
    }
  };

  const handleDeleteVault = async () => {
    if (!(await confirm({
      title: 'Remove vault from this machine',
      message:
        'This forgets the Team Vault on this machine only — the remote S3 copy (if any) is not touched, and other members keep their access. You can get it back later with "Pull existing vault" if a remote copy exists.',
    }))) {
      return;
    }
    setDeletingVault(true);
    setError(null);
    try {
      await window.multissh.teamVaultDelete();
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to remove the vault from this machine'));
    } finally {
      setDeletingVault(false);
    }
  };

  const handleSetRole = async (recipientId: string, role: TeamVaultRole) => {
    setBusyRecipientId(recipientId);
    setError(null);
    try {
      await window.multissh.teamVaultSetRole(recipientId, role);
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

  const handlePull = async (force = false) => {
    setPulling(true);
    setError(null);
    try {
      await window.multissh.teamVaultPull(force ? { force: true } : undefined);
      await load();
    } catch (err) {
      // TeamVaultUnpushedChangesError loses its class crossing IPC (plain Error on this side),
      // so this matches on the message text — see TeamVaultService.pullFromRemote's doc comment
      // for why this needs an explicit choice rather than silently overwriting local changes.
      const message = err instanceof Error ? err.message : '';
      if (!force && message.includes('have not been pushed yet')) {
        setPulling(false);
        const proceed = await confirm({
          title: 'Unpushed local changes',
          message:
            'This machine has local Team Vault changes (e.g. shared profile edits) that have not been pushed yet. Pulling now would discard them. Push first instead, or pull anyway and discard them?',
          confirmLabel: 'Pull anyway (discard local changes)',
        });
        if (proceed) {
          await handlePull(true);
        }
        return;
      }
      setError(describeIpcError(err, 'Pull failed'));
    } finally {
      setPulling(false);
    }
  };

  // Client-side only, for deciding whether to show the delete-vault button — the server enforces
  // the real admin check (`TeamVaultService.requireUnlockedAsAdmin`) regardless of this.
  const isAdmin = !!status?.members?.some((m) => m.recipientId === status.selfRecipientId && m.role === 'admin');

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

      {/* Always visible, regardless of whether a vault already exists on this machine — not just
          in the empty state. Generating a fresh recipient / copying join info is also how you'd
          ask to join a *second* team later (multi-team support is future work, Fas D in
          connection-manager-workspaces-plan.md), so this shouldn't be locked away once the first
          vault is set up. */}
      <div className="space-y-3 rounded-lg border border-border-subtle bg-app-surface p-4">
        <p className="text-xs font-medium text-txt-secondary">Your Team Vault identity</p>
        {!status?.exists && (
          <p className="text-xs text-txt-secondary">
            No Team Vault exists on this machine yet. Generate a recipient from your PIV card,
            then create the vault with yourself as its first admin — or copy your join info below
            to join a team that already has one.
          </p>
        )}

        <button
          type="button"
          onClick={() => void handleEnroll()}
          disabled={enrolling}
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
        >
          {enrolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fingerprint className="h-3.5 w-3.5 text-sky-400" />}
          Generate my Team Vault ID
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
            {!status?.exists && (
              <div>
                <label className="mb-1 block text-xs font-medium text-txt-secondary">
                  Vault name (optional)
                </label>
                <input
                  type="text"
                  value={vaultNameDraft}
                  onChange={(e) => setVaultNameDraft(e.target.value)}
                  placeholder="e.g. Acme Infra Team"
                  maxLength={200}
                  className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
                />
              </div>
            )}
            <div className="flex gap-2">
              {!status?.exists && (
                <button
                  type="button"
                  onClick={() => void handleCreateVault()}
                  disabled={creating || !selfRecipientId.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create Vault
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCopyJoinInfo()}
                disabled={!selfRecipientId.trim()}
                title="Copy a join-info blob to send to a team admin"
                className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
              >
                {joinInfoCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {joinInfoCopied ? 'Copied' : 'Copy join info'}
              </button>
            </div>
            <p className="text-xs text-txt-muted">
              {status?.exists
                ? "Generating a new recipient here doesn't affect this vault — it's for joining a different team's vault later; copy your join info and send it to that team's admin."
                : "Creating a vault makes you its first admin. To join a team's existing vault instead, copy your join info and send it to their admin."}
            </p>
          </div>
        )}
      </div>

      {!status?.exists && hasRemoteVault && (
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

      {status?.exists && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border-subtle bg-app-surface p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-txt-muted">Vault</span>
              {editingVaultName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    autoFocus
                    value={vaultNameEdit}
                    onChange={(e) => setVaultNameEdit(e.target.value)}
                    maxLength={200}
                    placeholder={status.vaultId}
                    className="rounded border border-border-subtle bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => void handleRenameVault()}
                    disabled={savingVaultName}
                    className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                    title="Save"
                  >
                    {savingVaultName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingVaultName(false)}
                    disabled={savingVaultName}
                    className="text-txt-muted hover:text-txt-secondary disabled:opacity-50"
                    title="Cancel"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-txt-secondary">{status.vaultName || status.vaultId}</span>
                  {status.unlocked && isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setVaultNameEdit(status.vaultName ?? '');
                        setEditingVaultName(true);
                      }}
                      className="text-txt-muted hover:text-txt-secondary"
                      title="Rename vault"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
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

              {!showManualUnlock && status.selfRecipientId && status.selfIdentityFilePath ? (
                <>
                  <p className="text-xs text-txt-muted">
                    Unlock as <span className="text-txt-secondary">{status.selfRecipientId}</span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUnlock()}
                      disabled={unlocking}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {unlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                      Unlock
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowManualUnlock(true);
                        setUnlockRecipientId('');
                        setUnlockIdentityPath('');
                      }}
                      className="text-xs text-txt-muted underline hover:text-txt-secondary"
                    >
                      Use a different identity...
                    </button>
                  </div>
                </>
              ) : (
                <>
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
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUnlock()}
                      disabled={unlocking || !unlockRecipientId.trim() || !unlockIdentityPath.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {unlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                      Unlock
                    </button>
                    {showManualUnlock && status.selfRecipientId && status.selfIdentityFilePath && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowManualUnlock(false);
                          setUnlockRecipientId(status.selfRecipientId ?? '');
                          setUnlockIdentityPath(status.selfIdentityFilePath ?? '');
                        }}
                        className="text-xs text-txt-muted underline hover:text-txt-secondary"
                      >
                        Use my saved identity
                      </button>
                    )}
                  </div>
                </>
              )}

              {!showRecoveryUnlock ? (
                <button
                  type="button"
                  onClick={() => setShowRecoveryUnlock(true)}
                  className="text-xs text-txt-muted underline hover:text-txt-secondary"
                >
                  Lost your card? Recover using your saved recovery key...
                </button>
              ) : (
                <div className="space-y-2 border-t border-border-subtle pt-2">
                  <p className="text-xs text-txt-secondary">
                    Paste the recovery key text you saved when this vault was created (the
                    &quot;AGE-SECRET-KEY-1...&quot; block). This unlocks the vault with
                    admin-equivalent access so you can re-add yourself as a regular member.
                  </p>
                  <textarea
                    value={recoveryTextInput}
                    onChange={(e) => setRecoveryTextInput(e.target.value)}
                    placeholder="AGE-SECRET-KEY-1..."
                    rows={3}
                    className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted font-mono"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUnlockWithRecovery()}
                      disabled={recovering || !recoveryTextInput.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                    >
                      {recovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                      Recover vault access
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowRecoveryUnlock(false);
                        setRecoveryTextInput('');
                      }}
                      disabled={recovering}
                      className="text-xs text-txt-muted underline hover:text-txt-secondary disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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
                      disabled={!status.unlocked || busyRecipientId === m.recipientId}
                      title={status.unlocked ? undefined : 'Unlock the vault first'}
                      className="rounded-lg border border-border-subtle px-2 py-1 text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
                    >
                      {m.role === 'admin' ? 'Demote' : 'Promote'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRemoveMember(m.recipientId)}
                      disabled={!status.unlocked || busyRecipientId === m.recipientId}
                      title={status.unlocked ? 'Remove member' : 'Unlock the vault first'}
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
            <textarea
              value={joinInfoPaste}
              onChange={(e) => handleJoinInfoPaste(e.target.value)}
              placeholder="Paste their join info (the blob they copied from Generate my Team Vault ID)"
              rows={3}
              className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            />
            {joinInfoPaste.trim() && !newAgeRecipient && (
              <p className="text-xs text-amber-300">
                That doesn't look like a join-info blob — make sure you pasted everything they
                copied from their own "Generate my Team Vault ID" step.
              </p>
            )}
            {newRecipientId && newAgeRecipient && (
              <div className="space-y-0.5 rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-2">
                <p data-testid="parsed-join-info-recipient-id" className="text-xs font-medium text-emerald-300">
                  {newRecipientId}
                </p>
                <p data-testid="parsed-join-info-age-recipient" className="break-all text-xs text-txt-muted">
                  {newAgeRecipient}
                </p>
              </div>
            )}
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

          {status.unlocked && isAdmin && (
            <div className="space-y-2 rounded-lg border border-red-900/60 bg-red-950/20 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-300">
                <ShieldOff className="h-3.5 w-3.5" />
                Danger zone
              </p>
              <p className="text-xs text-txt-muted">
                Forgets this Team Vault on this machine only. The remote S3 copy (if any) is not
                touched, and other members keep their access.
              </p>
              <button
                type="button"
                onClick={() => void handleDeleteVault()}
                disabled={deletingVault}
                className="flex items-center gap-1.5 rounded-lg border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-50"
              >
                {deletingVault ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Remove vault from this machine
              </button>
            </div>
          )}
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
                    disabled={pulling || !status?.unlocked}
                    title={!status?.unlocked ? 'Unlock the Team Vault first — pulling needs the Vault Key to verify the update' : undefined}
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
            <div className="relative">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border-subtle bg-app-input p-3 pr-20 text-xs text-txt-primary">
                {recoveryIdentity}
              </pre>
              <button
                type="button"
                onClick={() => void handleCopyRecovery()}
                className="absolute right-2 top-2 flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2 py-1 text-2xs font-medium text-txt-secondary hover:bg-app-surface-hover"
              >
                {recoveryCopied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {recoveryCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
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
