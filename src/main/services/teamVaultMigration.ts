import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { createLogger } from '../log/Logger';

const migrationLog = createLogger('team-vault-migration');

/** Same userData-or-fallback resolution every Team Vault file/store uses (see
 * `TeamVaultService`'s/`TeamVaultConfigStore`'s constructors) — duplicated here (rather than
 * imported from either) so this migration can run standalone, before either is constructed. */
export function resolveTeamVaultBaseDir(): string {
  try {
    return app.getPath('userData');
  } catch {
    return path.join(os.homedir(), '.sshs3');
  }
}

/**
 * One-time, idempotent migration from the single-team on-disk layout (`<baseDir>/team-vault.json`
 * + a flat `<baseDir>/team-vault-identities/`) to the multi-team layout
 * (`<baseDir>/team-vaults/<vaultId>.json` + `<baseDir>/team-vault-identities/<vaultId>/`).
 *
 * Deliberately synchronous: it must finish before `TeamVaultService`/`TeamVaultConfigStore` are
 * constructed (same instant, early in `IpcBridge`'s constructor — a constructor can't `await`),
 * and it only ever touches a handful of small files once per install, so the sync fs cost is
 * negligible compared to the correctness win of "this can never race a later async read of the
 * same paths".
 *
 * Never deletes anything — the legacy vault file is renamed to `team-vault.json.migrated` (a
 * backup in case this migration has a bug), never removed, matching the project's documented
 * decision (see docs/team-vault-plan.md) to prefer a safety copy over a clean delete for a
 * security-sensitive data migration.
 *
 * Returns the discovered `vaultId` when a legacy vault existed (migrated just now, or already
 * migrated by an earlier run with exactly one vault file present) — callers (ones that also
 * need to migrate `TeamVaultConfigStore`'s matching entry onto the real `vaultId` instead of the
 * pending sentinel) use this to skip the sentinel. `undefined` means either a fresh install (no
 * legacy or migrated vault at all) or more than one vault already present (multi-team already in
 * use — there's no single "the" vaultId to hand back).
 */
export function migrateLegacyTeamVaultLayout(baseDir: string): string | undefined {
  const legacyFilePath = path.join(baseDir, 'team-vault.json');
  const legacyIdentitiesDir = path.join(baseDir, 'team-vault-identities');
  const vaultsDir = path.join(baseDir, 'team-vaults');

  if (fs.existsSync(vaultsDir)) {
    // Already migrated (or a fresh multi-team install that never had a legacy file) — the
    // directory only ever exists once this function (or a later vault creation) has run.
    return singleExistingVaultId(vaultsDir);
  }

  if (!fs.existsSync(legacyFilePath)) {
    // No legacy file to migrate — still create the directory so `singleExistingVaultId`'s
    // "already migrated" fast path above is accurate on the next call, and so a brand-new
    // install's first `createVault()` doesn't need to special-case directory creation either.
    try {
      fs.mkdirSync(vaultsDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      migrationLog.warn('Failed to create the team-vaults directory (non-fatal):', err);
    }
    return undefined;
  }

  let vaultId: string | undefined;
  try {
    const raw = fs.readFileSync(legacyFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    vaultId = typeof parsed?.vaultId === 'string' && parsed.vaultId ? parsed.vaultId : undefined;
    if (!vaultId) {
      migrationLog.warn('Legacy Team Vault file has no vaultId — leaving it in place, unmigrated.');
      return undefined;
    }

    fs.mkdirSync(vaultsDir, { recursive: true, mode: 0o700 });
    const newFilePath = path.join(vaultsDir, `${vaultId}.json`);
    // Byte-for-byte copy (same raw string that was just read) — preserves accessHeader/roles/
    // every other field exactly, no re-serialization that could subtly reformat numbers/strings.
    fs.writeFileSync(newFilePath, raw, { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(legacyFilePath, `${legacyFilePath}.migrated`);
    migrationLog.info(`Migrated legacy Team Vault file to the multi-team layout (vaultId=${vaultId}).`);
  } catch (err) {
    migrationLog.warn('Failed to migrate the legacy Team Vault file (leaving it in place):', err);
    return undefined;
  }

  migrateLegacyIdentitiesDir(legacyIdentitiesDir, vaultId);
  return vaultId;
}

/** Moves every file directly under the legacy flat identities directory into a `vaultId`-named
 * subdirectory of itself — e.g. `team-vault-identities/abc.txt` ->
 * `team-vault-identities/<vaultId>/abc.txt`. Only ever called once a legacy vault file (and
 * therefore a real `vaultId`) was found; a flat identities directory with no legacy vault file
 * has nothing to key its contents by, so it's left alone. */
function migrateLegacyIdentitiesDir(legacyIdentitiesDir: string, vaultId: string): void {
  if (!fs.existsSync(legacyIdentitiesDir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(legacyIdentitiesDir, { withFileTypes: true });
  } catch (err) {
    migrationLog.warn('Failed to read the legacy Team Vault identities directory (non-fatal):', err);
    return;
  }

  const fileEntries = entries.filter((e) => e.isFile());
  if (fileEntries.length === 0) return;

  const targetDir = path.join(legacyIdentitiesDir, vaultId);
  try {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    for (const entry of fileEntries) {
      fs.renameSync(path.join(legacyIdentitiesDir, entry.name), path.join(targetDir, entry.name));
    }
    migrationLog.info(`Migrated ${fileEntries.length} legacy Team Vault identity file(s) under vaultId=${vaultId}.`);
  } catch (err) {
    migrationLog.warn('Failed to migrate legacy Team Vault identity files (non-fatal):', err);
  }
}

/** Returns the sole vaultId in `vaultsDir` when there's exactly one `<vaultId>.json` file in it —
 * used by `migrateLegacyTeamVaultLayout`'s "already migrated" fast path to still report the
 * vaultId (so `TeamVaultConfigStore`'s matching migration can target it) on every run after the
 * first, not just the one that actually performed the migration. Returns `undefined` for zero or
 * more than one vault file — there's no single unambiguous answer in either case. */
function singleExistingVaultId(vaultsDir: string): string | undefined {
  try {
    const files = fs.readdirSync(vaultsDir).filter((f) => f.endsWith('.json'));
    return files.length === 1 ? files[0].slice(0, -'.json'.length) : undefined;
  } catch {
    return undefined;
  }
}
