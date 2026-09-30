import { fingerprintKey } from '../ssh/KnownHostsStore';
import { BLOCKED_SSH_DIRECTIVES } from '../ssh/blockedSshDirectives';
import type { KnownHostsConflict } from '../../shared/types/sync';
import type { SSHConnectionConfig } from '../../shared/types/ssh';

export type { KnownHostsConflict };

/**
 * Merge logic for the two real OpenSSH files (`~/.ssh/config` and
 * `~/.ssh/known_hosts`) that remote profile sync can optionally manage.
 * These are shared with the system's own SSH client and other tools, so —
 * unlike the JSON stores — they must never be wholesale overwritten. This
 * module is pure text manipulation with no filesystem access, so it can be
 * unit tested without risk of touching a real ~/.ssh directory; the caller
 * is responsible for reading/writing the actual files.
 */

const MANAGED_BEGIN = '# BEGIN sshs3-managed (do not edit by hand -- managed by sshs3 Remote Profile Sync)';
const MANAGED_END = '# END sshs3-managed';
const TIMESTAMP_PREFIX = '# sshs3-sync-updated-at: ';

export interface ManagedSshConfigBlock {
  updatedAt: string;
  /** The Host entries etc. inside the managed block, excluding the markers and timestamp comment. */
  body: string;
}

const PATH_DIRECTIVES = new Set(['pkcs11provider', 'identityfile', 'certificatefile']);

/**
 * ssh_config splits unquoted values on whitespace, so a path like
 * `C:\Program Files\OpenSC Project\...` (typical on Windows) makes ssh abort with "extra arguments
 * at end of line" for every connection, not just inside sshs3. Quotes such a value (and uses
 * forward slashes, which Win32-OpenSSH accepts and which survive ssh_config's backslash handling
 * inside quotes) so a synced block is always parseable. Already-quoted values are left alone.
 */
function quoteSpacedPathValue(line: string): string {
  const match = /^(\s*)(\S+?)(\s*=\s*|\s+)(.+?)\s*$/.exec(line);
  if (!match) return line;
  const [, indent, key, sep, value] = match;
  if (!PATH_DIRECTIVES.has(key.toLowerCase())) return line;
  if (value.startsWith('"') || !/\s/.test(value)) return line;
  // A trailing " # comment" is not part of the path — don't swallow it into the quotes.
  if (/\s#/.test(value)) return line;
  // Backslashes only mean "path separator" for a Windows drive path (C:\...); leave anything else byte-for-byte.
  const normalized = /^[A-Za-z]:[\\/]/.test(value) ? value.replace(/\\/g, '/') : value;
  return `${indent}${key}${sep}"${normalized}"`;
}

export interface SanitizeSshConfigBodyResult {
  body: string;
  removedLines: string[];
}

/**
 * Strips any line whose directive is in BLOCKED_SSH_DIRECTIVES from a managed
 * block body before it's ever written to disk. Applied only on the
 * receiving end of a sync pull (see writeManagedSshConfigBlock) — the
 * user's own locally-authored content is never touched, only content
 * arriving from the (untrusted-until-proven-otherwise) sync source.
 */
export function sanitizeSshConfigBody(body: string): SanitizeSshConfigBodyResult {
  const removedLines: string[] = [];
  const keptLines: string[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      keptLines.push(line);
      continue;
    }
    // ssh_config directives are "Key value" or "Key=value", optionally
    // preceded by whitespace; keys are case-insensitive.
    const directive = trimmed.split(/[\s=]+/, 1)[0]?.toLowerCase();
    if (directive && BLOCKED_SSH_DIRECTIVES.has(directive)) {
      removedLines.push(line);
      continue;
    }
    keptLines.push(quoteSpacedPathValue(line));
  }

  return { body: keptLines.join('\n'), removedLines };
}

/** Reads the sshs3-managed block out of a `~/.ssh/config` file's content, if present. */
export function parseManagedSshConfigBlock(fileContent: string): ManagedSshConfigBlock | null {
  const beginIdx = fileContent.indexOf(MANAGED_BEGIN);
  const endIdx = fileContent.indexOf(MANAGED_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return null;
  }

  const inner = fileContent.slice(beginIdx + MANAGED_BEGIN.length, endIdx);
  const lines = inner.replace(/^\r?\n/, '').split('\n');
  let updatedAt = '';
  let bodyLines = lines;
  if (lines[0]?.startsWith(TIMESTAMP_PREFIX)) {
    updatedAt = lines[0].slice(TIMESTAMP_PREFIX.length).trim();
    bodyLines = lines.slice(1);
  }
  const body = bodyLines.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return { updatedAt, body };
}

/**
 * Writes (inserts or replaces) the sshs3-managed block in a `~/.ssh/config`
 * file's content. Everything outside the markers is left untouched; if no
 * managed block exists yet, one is appended at the end of the file.
 */
export function writeManagedSshConfigBlock(fileContent: string, block: ManagedSshConfigBlock): string {
  const { body: safeBody, removedLines } = sanitizeSshConfigBody(block.body);
  if (removedLines.length > 0) {
    console.warn(
      `[sshs3] Remote Profile Sync: refused to write ${removedLines.length} disallowed ssh_config directive(s) ` +
        `synced from remote into ~/.ssh/config (would allow code execution from any future "ssh" invocation): ` +
        removedLines.map((l) => JSON.stringify(l.trim())).join(', ')
    );
  }
  const blockText = `${MANAGED_BEGIN}\n${TIMESTAMP_PREFIX}${block.updatedAt}\n${safeBody}\n${MANAGED_END}`;

  const beginIdx = fileContent.indexOf(MANAGED_BEGIN);
  const endIdx = fileContent.indexOf(MANAGED_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    if (fileContent.length === 0) {
      return `${blockText}\n`;
    }
    const separator = fileContent.endsWith('\n') ? '\n' : '\n\n';
    return `${fileContent}${separator}${blockText}\n`;
  }

  const before = fileContent.slice(0, beginIdx);
  const after = fileContent.slice(endIdx + MANAGED_END.length);
  return `${before}${blockText}${after}`;
}

/**
 * ssh_config `Host` patterns treat whitespace as a pattern separator and
 * `* ? ! [ ] ,` as glob/negation syntax, so a profile name containing any of
 * those can't be used as a literal alias — replace them rather than let one
 * profile's alias accidentally match (or fail to match) unrelated hosts.
 */
const HOST_ALIAS_UNSAFE_CHARS = /[\s*?![\],]+/g;

function sshConfigHostAlias(profile: SSHConnectionConfig): string {
  const base = (profile.name?.trim() || profile.host || profile.id).replace(HOST_ALIAS_UNSAFE_CHARS, '-');
  return base.replace(/^-+|-+$/g, '') || profile.id;
}

/**
 * Builds one `Host` entry's directive lines for a single SSH profile.
 * Only connection-shape settings that have a direct, safe ssh_config
 * equivalent are emitted — secrets (password/passphrase/PIN) have no
 * ssh_config representation and are deliberately left out; native `ssh`
 * will just prompt for them interactively same as it always has.
 */
function buildSshConfigHostBlock(
  profile: SSHConnectionConfig,
  alias: string,
  aliasById: Map<string, string>
): string {
  const lines = [`Host ${alias}`, `    HostName ${profile.host}`];

  if (profile.port && profile.port !== 22) {
    lines.push(`    Port ${profile.port}`);
  }
  if (profile.username) {
    lines.push(`    User ${profile.username}`);
  }
  if (profile.authType === 'privateKey' && profile.privateKeyPath) {
    lines.push(`    IdentityFile ${profile.privateKeyPath}`);
  }
  if (profile.authType === 'smartcard' && profile.pkcs11LibPath) {
    lines.push(`    PKCS11Provider ${profile.pkcs11LibPath}`);
  }
  const jumpAlias = profile.proxyJumpProfileId ? aliasById.get(profile.proxyJumpProfileId) : undefined;
  if (jumpAlias) {
    // Reference the jump profile's own Host alias rather than resolving to a literal
    // user@host: this block is generated for every profile in one pass, so the alias is
    // already stable and native ssh can chain through it exactly like the app does.
    lines.push(`    ProxyJump ${jumpAlias}`);
  } else if (profile.proxyJump) {
    lines.push(`    ProxyJump ${profile.proxyJump}`);
  }
  if (profile.forwardAgent) {
    lines.push('    ForwardAgent yes');
  }
  if (profile.compression) {
    lines.push('    Compression yes');
  }
  if (profile.serverAliveInterval) {
    lines.push(`    ServerAliveInterval ${profile.serverAliveInterval}`);
  }
  if (profile.ciphers) {
    lines.push(`    Ciphers ${profile.ciphers}`);
  }
  if (profile.kexAlgorithms) {
    lines.push(`    KexAlgorithms ${profile.kexAlgorithms}`);
  }
  if (profile.macs) {
    lines.push(`    MACs ${profile.macs}`);
  }
  for (const [key, value] of Object.entries(profile.extraOptions ?? {})) {
    if (!key.trim() || !value.trim()) continue;
    lines.push(`    ${key} ${value}`);
  }

  return lines.join('\n');
}

/**
 * Generates the sshs3-managed block's body from the user's saved SSH
 * profiles, so a plain `ssh <alias>` typed in any terminal (inside or
 * outside the app) picks up the same host/port/user/identity/etc. as the
 * matching profile. `extraOptions` can carry arbitrary directive names —
 * possibly merged in from a remote sync source — so the result still goes
 * through the same sanitizeSshConfigBody() pass as a synced block before
 * ever being written to disk (see writeManagedSshConfigBlock).
 *
 * `previousBlock`'s `updatedAt` is reused whenever regeneration produces the
 * same body as before, so re-generating on every profile save doesn't
 * perpetually mark this machine "ahead" in sync comparisons for a no-op.
 */
export function buildManagedSshConfigBlockFromProfiles(
  profiles: SSHConnectionConfig[],
  previousBlock: ManagedSshConfigBlock | null,
  now: string = new Date().toISOString()
): ManagedSshConfigBlock {
  const usedAliases = new Set<string>();
  const aliasById = new Map<string, string>();
  const sortedProfiles = [...profiles].sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
  for (const profile of sortedProfiles) {
    let alias = sshConfigHostAlias(profile);
    let suffix = 2;
    while (usedAliases.has(alias)) {
      alias = `${sshConfigHostAlias(profile)}-${suffix}`;
      suffix += 1;
    }
    usedAliases.add(alias);
    aliasById.set(profile.id, alias);
  }
  const blocks = sortedProfiles.map((profile) =>
    buildSshConfigHostBlock(profile, aliasById.get(profile.id)!, aliasById)
  );

  const body = blocks.join('\n\n');
  const updatedAt = previousBlock && previousBlock.body === body ? previousBlock.updatedAt : now;
  return { updatedAt, body };
}

export interface SshConfigMergeResult {
  merged: string;
  changed: boolean;
}

/**
 * Merges a downloaded `~/.ssh/config` managed block into the local file.
 * Whichever side's block has the newer `updatedAt` wins wholesale (the
 * block is small and hand-edited as a unit, unlike the JSON per-record
 * stores) — never touches anything outside the markers.
 */
export function mergeSshConfigBlocks(localContent: string, remoteContent: string): SshConfigMergeResult {
  const remoteBlock = parseManagedSshConfigBlock(remoteContent);
  if (!remoteBlock) {
    return { merged: localContent, changed: false };
  }
  const localBlock = parseManagedSshConfigBlock(localContent);
  if (localBlock && localBlock.updatedAt >= remoteBlock.updatedAt) {
    return { merged: localContent, changed: false };
  }
  return { merged: writeManagedSshConfigBlock(localContent, remoteBlock), changed: true };
}

export interface KnownHostsMergeResult {
  mergedContent: string;
  addedCount: number;
  /** Same host, different key on each side. Never auto-resolved — surface to the user. */
  conflicts: KnownHostsConflict[];
  changed: boolean;
}

interface ParsedKnownHostsLine {
  patternField: string;
  keyType: string;
  keyBase64: string;
}

function parseKnownHostsLines(content: string): ParsedKnownHostsLine[] {
  const lines: ParsedKnownHostsLine[] = [];
  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) {
      // Blank/comment lines and marker lines (@cert-authority, @revoked) are
      // left alone — this merge only concerns plain host/key entries.
      continue;
    }
    const fields = trimmed.split(/\s+/);
    if (fields.length < 3) continue;
    const [patternField, keyType, keyBase64] = fields;
    lines.push({ patternField, keyType, keyBase64 });
  }
  return lines;
}

/**
 * Merges a downloaded `~/.ssh/known_hosts` into the local file. Strictly
 * append-only: local lines are never modified or removed. A remote entry
 * for a host/key combination already present locally is skipped; a remote
 * entry for a host that exists locally under a *different* key is reported
 * as a conflict rather than applied, since that's the same signal that
 * would indicate a possible MITM if seen during a live connection.
 */
export function mergeKnownHosts(localContent: string, remoteContent: string): KnownHostsMergeResult {
  const localLines = parseKnownHostsLines(localContent);
  const remoteLines = parseKnownHostsLines(remoteContent);

  const localByPattern = new Map<string, ParsedKnownHostsLine[]>();
  for (const line of localLines) {
    const arr = localByPattern.get(line.patternField) ?? [];
    arr.push(line);
    localByPattern.set(line.patternField, arr);
  }
  const seenExact = new Set(localLines.map((l) => `${l.patternField} ${l.keyType} ${l.keyBase64}`));

  const linesToAppend: string[] = [];
  const conflicts: KnownHostsConflict[] = [];

  for (const remoteLine of remoteLines) {
    const exactKey = `${remoteLine.patternField} ${remoteLine.keyType} ${remoteLine.keyBase64}`;
    if (seenExact.has(exactKey)) continue;

    const existingForHost = localByPattern.get(remoteLine.patternField) ?? [];
    const conflicting = existingForHost.find((l) => l.keyType === remoteLine.keyType && l.keyBase64 !== remoteLine.keyBase64);
    if (conflicting) {
      conflicts.push({
        hostPatternField: remoteLine.patternField,
        localKeyType: conflicting.keyType,
        localFingerprint: fingerprintKey(Buffer.from(conflicting.keyBase64, 'base64')),
        remoteKeyType: remoteLine.keyType,
        remoteFingerprint: fingerprintKey(Buffer.from(remoteLine.keyBase64, 'base64')),
      });
      continue;
    }

    linesToAppend.push(`${remoteLine.patternField} ${remoteLine.keyType} ${remoteLine.keyBase64}`);
    seenExact.add(exactKey);
  }

  if (linesToAppend.length === 0) {
    return { mergedContent: localContent, addedCount: 0, conflicts, changed: false };
  }

  const needsNewline = localContent.length > 0 && !localContent.endsWith('\n');
  const mergedContent = `${localContent}${needsNewline ? '\n' : ''}${linesToAppend.join('\n')}\n`;
  return { mergedContent, addedCount: linesToAppend.length, conflicts, changed: true };
}
