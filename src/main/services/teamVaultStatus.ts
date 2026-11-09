import type { TeamVaultStatus } from '../../shared/types/teamVault';
import type { TeamVaultConfigEntry } from './TeamVaultConfigStore';
import { redactS3Secrets } from './teamVaultSecretGuards';

/**
 * Pure: where a remembered identity file is now. A remembered identity path from before the single-team ->
 * multi-team migration still points at the old flat identities directory, which migrateLegacyIdentitiesDir
 * has since moved out from under it — self-heal it (checked, not assumed, every time the status is read)
 * rather than only once at startup, so this also covers installs that migrated before this fix existed.
 * Without it, a returning member's one-click unlock silently regresses to the manual path-entry form (see
 * relocateMigratedIdentityPath's doc comment).
 *
 * `relocatedTo` is set only when the stored path was replaced, so the caller can persist the new one. The
 * file system is injected (`exists`, `relocate`) to keep this free of side effects.
 */
export function healIdentityPath(
  storedPath: string | undefined,
  vaultId: string,
  exists: (path: string) => boolean,
  relocate: (path: string, vaultId: string) => string | undefined
): { path: string | undefined; relocatedTo?: string } {
  if (storedPath && !exists(storedPath)) {
    const relocated = relocate(storedPath, vaultId);
    if (relocated) return { path: relocated, relocatedTo: relocated };
  }
  return { path: storedPath };
}

/**
 * Pure: merges `TeamVaultService`'s local-file-derived status with `TeamVaultConfigStore`'s S3 target config,
 * so `TeamVaultService` stays unaware of where (or whether) its file is pushed/pulled from.
 */
export function mergeTeamVaultStatus(
  status: TeamVaultStatus,
  config: TeamVaultConfigEntry,
  vaultId: string,
  selfIdentityFilePath: string | undefined
): TeamVaultStatus {
  return {
    ...status,
    // `TeamVaultService.getStatus` only knows `vaultId` once a local file exists — a
    // configured-but-never-pulled (or orphaned-pending) entry has none, and without this the
    // renderer gets back `vaultId: undefined` and can't act on the row (e.g. "forget" sends
    // `undefined` to an IPC handler that requires a real id). The vaultId we were asked about
    // is always the right one to report back, file or no file.
    vaultId: status.vaultId ?? vaultId,
    remoteConfigured: !!config.target,
    // Decrypted, for autofilling the target editor form — same precedent the general Synchronization
    // panel's own target set (§ edit-target prefill). The S3 secret itself never leaves: redactS3Secrets.
    targetConfig:
      config.target?.type === 's3' && config.target.s3Config
        ? { type: 's3', s3Config: redactS3Secrets(config.target.s3Config) }
        : undefined,
    remoteBasePath: config.remoteBasePath,
    lastSyncAt: config.lastSyncAt,
    selfRecipientId: config.selfRecipientId,
    selfIdentityFilePath,
    selfRole: config.selfRecipientId
      ? status.members?.find((m) => m.recipientId === config.selfRecipientId)?.role
      : undefined,
  };
}

/**
 * Pure: every vault this device knows about — those with a local file and those that only have a configured
 * remote (join-in-progress, parked under the pending sentinel; see `TEAM_VAULT_PENDING_VAULT_ID`'s doc
 * comment), which the local-file list alone would miss. Each id once; local files first.
 */
export function allKnownVaultIds(localVaultIds: readonly string[], configs: Record<string, unknown>): string[] {
  const ids = new Set<string>(localVaultIds);
  for (const vaultId of Object.keys(configs)) ids.add(vaultId);
  return Array.from(ids);
}
