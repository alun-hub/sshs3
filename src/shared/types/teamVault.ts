export type TeamVaultRole = 'admin' | 'member';

/** One recipient's wrapped copy of the Vault Key. `method` is deliberately an open field (only
 * `'piv-rsa-oaep'` exists in v1) so a future recipient mechanism doesn't need a format change —
 * see docs/team-vault-plan.md §2.3. */
export interface TeamVaultAccessEntry {
  recipientId: string;
  role: TeamVaultRole;
  method: 'piv-rsa-oaep';
  /** The recipient's public `age1yubikey1...` string. Public by definition (already shared
   * out-of-band per §4.3), and storing it is not optional: offboarding (removeMember) re-wraps a
   * fresh Vault Key for every *remaining* recipient, which is only possible if their public key
   * is available — `wrappedVaultKey` alone can't be reversed to recover it. Correction to the
   * original §2.3 sketch in docs/team-vault-plan.md, which omitted this field. */
  ageRecipient: string;
  wrappedVaultKey: string;
  addedAt: string;
  addedBy: string;
}

/** The recovery key is an ordinary recipient, not a special case in the format — only flagged
 * separately so the UI can give it the "print this, store it in a safe" ceremony (§4.1/§4.3). */
export interface TeamVaultRecovery {
  recipientId: string;
  /** See `TeamVaultAccessEntry.ageRecipient` — same reason, needed to re-wrap on offboarding. */
  ageRecipient: string;
  wrappedVaultKey: string;
  note?: string;
}

export interface TeamVaultFile {
  formatVersion: 1;
  vaultId: string;
  /** Monotonically incremented on every mutating write (create=1, then +1 per add/remove/role
   * change). Rollback/replay guard: anyone with mere S3 write access to the vault's path (not
   * necessarily a real recipient — bucket permissions and "is a vault member" are different
   * things) could otherwise overwrite the file with an older version to resurrect a removed
   * member's access to the pre-removal state. `pullFromRemote` refuses a revision that goes
   * backwards relative to the local copy. */
  revision: number;
  updatedAt: string;
  updatedBy: string;
  accessHeader: TeamVaultAccessEntry[];
  recovery: TeamVaultRecovery;
  encryptedPayload: string;
  /** HMAC-SHA256 (base64) over `vaultId`+`revision`+`accessHeader`+`recovery`, keyed by a subkey
   * derived from the Vault Key — see `TeamVaultCryptoService.computeAccessHeaderMac`. Lets
   * `pullFromRemote` detect any tampering with the header itself (a substituted or wholly new
   * entry, a changed role, ...) without depending on a specific `revision` delta: mere S3 write
   * access can't produce a valid tag, since that requires the real Vault Key. */
  accessHeaderMac: string;
}

export interface TeamVaultMemberSummary {
  recipientId: string;
  role: TeamVaultRole;
  addedAt: string;
}

/** `access_header` is plaintext JSON (§2.3), so this status is derivable without ever unlocking
 * the vault — only decrypting `encrypted_payload` needs the Vault Key. */
export interface TeamVaultStatus {
  exists: boolean;
  vaultId?: string;
  members?: TeamVaultMemberSummary[];
  adminCount?: number;
  unlocked: boolean;
  filePath: string;
  /** Whether an S3 target has been configured for this vault (Fas 3) — distinct from `exists`,
   * since a brand new install can have a remote target configured but no local file yet (join an
   * existing team's vault) or vice versa (a local-only vault never pushed anywhere). Optional
   * because `TeamVaultService.getStatus()` itself doesn't know about remote config (that's
   * `TeamVaultConfigStore`'s job) — only `IpcBridge.buildTeamVaultStatus()`, which merges both,
   * always sets it for a real IPC response. */
  remoteConfigured?: boolean;
  lastSyncAt?: string;
}
