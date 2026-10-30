/**
 * Whether connecting to a profile should write its `lastUsedAt` back. `source` is the Connection
 * Manager's tab key: 'personal' or a Team Vault id. A Team Vault profile never gets the write: every
 * mutating save bumps the vault's revision, which every other member's background poll would then
 * pick up as a change, for what is really a per-viewer stat.
 */
export function shouldTouchLastUsed(source: string): boolean {
  return source === 'personal';
}
