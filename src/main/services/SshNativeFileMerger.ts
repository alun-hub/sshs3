import { fingerprintKey } from '../ssh/KnownHostsStore';
import type { KnownHostsConflict } from '../../shared/types/sync';

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

/**
 * ssh_config directives that can execute an arbitrary command (client-side
 * or server-side) or pull in additional, unvalidated config, so are never
 * allowed into a block written by remote profile sync. This block lands in
 * the user's *real* `~/.ssh/config` — read by the system's own `ssh` binary
 * for every future connection, not just inside sshs3 — so a sync source
 * that can plant `ProxyCommand`/`LocalCommand`/etc. here (a compromised
 * sync target, a compromised paired device, or a leaked master password)
 * would get silent, persistent code execution on every subsequent `ssh`
 * invocation matching the Host pattern, from any tool, indefinitely.
 * SECURITY: do not remove entries from this list without understanding why
 * they're here — see the finding this addresses.
 */
const BLOCKED_DIRECTIVES = new Set([
  'proxycommand',
  'localcommand',
  'permitlocalcommand',
  'remotecommand',
  'match',
  'include',
]);

export interface SanitizeSshConfigBodyResult {
  body: string;
  removedLines: string[];
}

/**
 * Strips any line whose directive is in BLOCKED_DIRECTIVES from a managed
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
    if (directive && BLOCKED_DIRECTIVES.has(directive)) {
      removedLines.push(line);
      continue;
    }
    keptLines.push(line);
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
