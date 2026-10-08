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
  updatedAt: string;
  updatedBy: string;
  accessHeader: TeamVaultAccessEntry[];
  recovery: TeamVaultRecovery;
  encryptedPayload: string;
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
}
