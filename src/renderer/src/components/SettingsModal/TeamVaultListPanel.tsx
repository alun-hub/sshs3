import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  DownloadCloud,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Shield,
  Trash2,
  Unlock,
  UserPlus,
} from 'lucide-react';
import type { TeamVaultStatus } from '@shared/types/teamVault';
import { TeamVaultDetailPanel } from './TeamVaultDetailPanel';
import { SyncTargetForm, emptySyncTargetDraft, buildSyncTarget, type SyncTargetDraft } from './SyncTargetForm';
import { describeIpcError } from '../../lib/format';
import { buildTeamVaultJoinInfo } from '../../lib/teamVaultJoinInfo';
import { useConfirm } from '../ConfirmDialog';

function emptyS3TargetDraft(): SyncTargetDraft {
  return { ...emptySyncTargetDraft(), type: 's3' };
}

type ListMode = { kind: 'list' } | { kind: 'create' } | { kind: 'join' };

/**
 * Team list/switcher (docs/team-vault-plan.md's multi-team plan §7) — every team this device
 * knows about (`teamVaultList()`), each row showing its name/id, this device's role, and
 * locked/unlocked state. Selecting a row mounts `TeamVaultDetailPanel` with `key={vaultId}`
 * (resets that panel's own per-team draft state on every switch, same as the plan calls for).
 *
 * Creating a brand-new vault and generating a join-request identity both live here, not in the
 * detail panel — neither has a real `vaultId` to scope itself by yet (`createVault` mints one;
 * joining requires the admin to hand the real `vaultId` to the joiner out of band first — see
 * `handleJoinExistingVault`'s doc comment for why that's required now).
 */
export const TeamVaultListPanel: React.FC = () => {
  const confirm = useConfirm();
  const [vaults, setVaults] = useState<TeamVaultStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);
  // Set right after `teamVaultCreate` succeeds, but not navigated to until the recovery-key
  // modal below is dismissed — opening the detail panel immediately would unmount this list
  // (and the modal that must still block on "I have printed/saved this recovery key").
  const [pendingVaultId, setPendingVaultId] = useState<string | null>(null);
  const [mode, setMode] = useState<ListMode>({ kind: 'list' });
  const [busyVaultId, setBusyVaultId] = useState<string | null>(null);

  // "Generate my Team Vault ID" — produces the age1yubikey1... recipient this device's PIV card
  // will use, either to create a brand-new vault as its first admin, or to send to an existing
  // team's admin so they can add this device as a member.
  const [enrolling, setEnrolling] = useState(false);
  const [myRecipient, setMyRecipient] = useState<{ recipient: string; identityFilePath: string } | null>(null);
  const [selfRecipientId, setSelfRecipientId] = useState('');
  const [joinInfoCopied, setJoinInfoCopied] = useState(false);

  // Create a new vault
  const [creating, setCreating] = useState(false);
  const [vaultNameDraft, setVaultNameDraft] = useState('');
  const [recoveryIdentity, setRecoveryIdentity] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  // Join an existing vault: needs the team's real vaultId (the remote object path is keyed by
  // it — see handleJoinExistingVault's doc comment) plus the S3 target it lives at, then pulls.
  const [joinVaultId, setJoinVaultId] = useState('');
  const [joinTargetDraft, setJoinTargetDraft] = useState<SyncTargetDraft>(emptyS3TargetDraft());
  const [joinTargetError, setJoinTargetError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVaults(await window.multissh.teamVaultList());
    } catch (err) {
      setError(describeIpcError(err, 'Failed to load the list of teams'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetJoinCreateState = () => {
    setMyRecipient(null);
    setSelfRecipientId('');
    setJoinInfoCopied(false);
    setVaultNameDraft('');
    setJoinVaultId('');
    setJoinTargetDraft(emptyS3TargetDraft());
    setJoinTargetError(null);
  };

  const handleEnroll = async () => {
    setEnrolling(true);
    setError(null);
    try {
      // No vaultId: this identity is for a vault that doesn't exist locally yet, either because
      // we're about to create it or because we're about to ask an existing team's admin to add
      // us — see TeamVaultService.enrollOwnPivRecipient's doc comment.
      const result = await window.multissh.teamVaultEnrollRecipient();
      setMyRecipient(result);
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
      const { vaultId, recoveryIdentity: identity } = await window.multissh.teamVaultCreate(
        selfRecipientId.trim(),
        myRecipient.recipient,
        vaultNameDraft.trim(),
        myRecipient.identityFilePath
      );
      setRecoveryIdentity(identity);
      setRecoverySaved(false);
      setRecoveryCopied(false);
      setPendingVaultId(vaultId);
      await load();
    } catch (err) {
      setError(describeIpcError(err, 'Failed to create the Team Vault'));
    } finally {
      setCreating(false);
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

  /** The remote vault file's object path is keyed by `vaultId` (`team-vault/<vaultId>/vault.json`
   * — see `TeamVaultService.remoteVaultPath`'s doc comment: this is what lets two teams safely
   * share one bucket/prefix without colliding). That means a joiner can't discover the vault
   * blind by just pointing at a bucket the way a single-team install used to — the real `vaultId`
   * has to come from the team's admin out of band (they copy it from their own team's detail view
   * — see `TeamVaultDetailPanel`'s "Team ID" row — alongside however they already share the S3
   * target/credentials). `teamVaultSetTarget`/`teamVaultPull` are called with that real id
   * directly, never a placeholder — there's nothing to "promote" to it afterwards. */
  const handleJoinExistingVault = async () => {
    const vaultId = joinVaultId.trim();
    if (!vaultId) {
      setJoinTargetError("The team's Team ID is required (ask its admin — see their Team Vault detail view).");
      return;
    }
    if (joinTargetDraft.type !== 's3') {
      setJoinTargetError('The Team Vault only supports an S3-compatible target.');
      return;
    }
    if (!joinTargetDraft.remoteBasePath.trim()) {
      setJoinTargetError('A bucket (optionally "bucket/prefix") is required.');
      return;
    }
    if (!joinTargetDraft.accessKeyId?.trim() || !joinTargetDraft.secretAccessKey) {
      setJoinTargetError('Access key ID and secret access key are required.');
      return;
    }
    setJoinTargetError(null);
    setJoining(true);
    setError(null);
    try {
      const target = buildSyncTarget(joinTargetDraft);
      await window.multissh.teamVaultSetTarget(vaultId, target, joinTargetDraft.remoteBasePath);
      const hasRemote = await window.multissh.teamVaultHasRemoteVault(vaultId);
      if (!hasRemote) {
        setJoinTargetError('No Team Vault found at that location — check the Team ID, bucket/prefix, and credentials.');
        return;
      }
      const status = await window.multissh.teamVaultPull(vaultId);
      await load();
      setSelectedVaultId(vaultId || status.vaultId || null);
      setMode({ kind: 'list' });
      resetJoinCreateState();
    } catch (err) {
      setJoinTargetError(describeIpcError(err, 'Failed to join the existing Team Vault'));
    } finally {
      setJoining(false);
    }
  };

  const handleForget = async (vaultId: string) => {
    if (
      !(await confirm({
        title: 'Remove team from this device',
        message: 'Removes this team\'s local file, identity, and configuration from this device. Lock it first if it\'s currently unlocked.',
      }))
    ) {
      return;
    }
    setBusyVaultId(vaultId);
    setError(null);
    try {
      await window.multissh.teamVaultForget(vaultId);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message.includes('Lock this Team Vault')
          ? 'Lock this team first (open it and lock it), then try removing it again.'
          : describeIpcError(err, 'Failed to remove this team from this device')
      );
    } finally {
      setBusyVaultId(null);
    }
  };

  if (selectedVaultId) {
    return (
      <TeamVaultDetailPanel
        key={selectedVaultId}
        vaultId={selectedVaultId}
        onBack={() => {
          setSelectedVaultId(null);
          void load();
        }}
        onVaultRemoved={() => {
          setSelectedVaultId(null);
          void load();
        }}
      />
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
          PIV hardware key instead of a shared password. You can belong to more than one team.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {mode.kind === 'list' && (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                resetJoinCreateState();
                setMode({ kind: 'create' });
              }}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            >
              <Plus className="h-3.5 w-3.5" />
              Create a new team
            </button>
            <button
              type="button"
              onClick={() => {
                resetJoinCreateState();
                setMode({ kind: 'join' });
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Join an existing team
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-txt-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading teams...
            </div>
          ) : vaults.length === 0 ? (
            <p className="py-6 text-center text-xs text-txt-muted">
              No Team Vault has been set up on this machine yet. Create one, or join a team that
              already has one.
            </p>
          ) : (
            <div className="space-y-1.5">
              {vaults.map((v) => (
                <div
                  key={v.vaultId}
                  className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedVaultId(v.vaultId!)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-sky-400"
                  >
                    {v.unlocked ? (
                      <Unlock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-txt-primary">
                        {v.vaultName || v.vaultId}
                      </span>
                      <span className="block text-txt-muted">
                        {(v.members?.length ?? 0)} member{(v.members?.length ?? 0) === 1 ? '' : 's'}
                        {v.selfRole ? ` · ${v.selfRole}` : ''}
                      </span>
                    </span>
                  </button>
                  {!v.unlocked && (
                    <button
                      type="button"
                      onClick={() => void handleForget(v.vaultId!)}
                      disabled={busyVaultId === v.vaultId}
                      title="Remove this team from this device"
                      className="shrink-0 rounded-lg border border-red-900/60 p-1.5 text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                    >
                      {busyVaultId === v.vaultId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode.kind === 'create' && (
        <div className="space-y-3 rounded-lg border border-border-subtle bg-app-surface p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-txt-secondary">Create a new team</p>
            <button
              type="button"
              onClick={() => {
                setMode({ kind: 'list' });
                resetJoinCreateState();
              }}
              className="text-xs text-txt-muted underline hover:text-txt-secondary"
            >
              Cancel
            </button>
          </div>

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
              <div>
                <label className="mb-1 block text-xs font-medium text-txt-secondary">Team name (optional)</label>
                <input
                  type="text"
                  value={vaultNameDraft}
                  onChange={(e) => setVaultNameDraft(e.target.value)}
                  placeholder="e.g. Acme Infra Team"
                  maxLength={200}
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
                Create team
              </button>
            </div>
          )}
        </div>
      )}

      {mode.kind === 'join' && (
        <div className="space-y-3 rounded-lg border border-border-subtle bg-app-surface p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-txt-secondary">Join an existing team</p>
            <button
              type="button"
              onClick={() => {
                setMode({ kind: 'list' });
                resetJoinCreateState();
              }}
              className="text-xs text-txt-muted underline hover:text-txt-secondary"
            >
              Cancel
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-txt-secondary">
              Step 1 — generate your recipient and send it to that team's admin.
            </p>
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
                <button
                  type="button"
                  onClick={() => void handleCopyJoinInfo()}
                  disabled={!selfRecipientId.trim()}
                  title="Copy a join-info blob to send to that team's admin"
                  className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover disabled:opacity-50"
                >
                  {joinInfoCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {joinInfoCopied ? 'Copied' : 'Copy join info'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-border-subtle pt-3">
            <p className="text-xs text-txt-secondary">
              Step 2 — once their admin has added you as a member, ask them for the team's{' '}
              <strong>Team ID</strong> (shown in their Team Vault detail view) and point this
              device at the team's S3 target to pull the vault.
            </p>
            {joinTargetError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {joinTargetError}
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-txt-secondary">Team ID</label>
              <input
                type="text"
                value={joinVaultId}
                onChange={(e) => setJoinVaultId(e.target.value)}
                placeholder="vlt_..."
                disabled={joining}
                className="w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 font-mono text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted disabled:opacity-50"
              />
            </div>
            <SyncTargetForm draft={joinTargetDraft} onChange={setJoinTargetDraft} disabled={joining} />
            <button
              type="button"
              onClick={() => void handleJoinExistingVault()}
              disabled={joining || !joinVaultId.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
              Pull and join
            </button>
          </div>
        </div>
      )}

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
                onClick={() => {
                  setRecoveryIdentity(null);
                  setMode({ kind: 'list' });
                  resetJoinCreateState();
                  if (pendingVaultId) {
                    setSelectedVaultId(pendingVaultId);
                    setPendingVaultId(null);
                  }
                }}
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
