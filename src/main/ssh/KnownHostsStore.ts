import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

export type HostKeyCheckResult = 'match' | 'mismatch' | 'unknown';

interface KnownHostsEntry {
  patterns: string[];
  keyBuffer: Buffer;
}

/**
 * Builds the host identifier OpenSSH uses as the known_hosts lookup key: the
 * bare hostname for the default port, or "[host]:port" otherwise.
 */
export function hostIdentifier(host: string, port: number): string {
  return port && port !== 22 ? `[${host}]:${port}` : host;
}

/**
 * Reads the first SSH-wire-format length-prefixed string from a public key
 * blob, which is its algorithm name (e.g. "ssh-ed25519", "ssh-rsa").
 */
export function readKeyType(keyBuffer: Buffer): string {
  if (keyBuffer.length < 4) return 'unknown';
  const len = keyBuffer.readUInt32BE(0);
  return keyBuffer.subarray(4, 4 + len).toString('utf8');
}

/**
 * Computes the OpenSSH-style "SHA256:base64" fingerprint shown by
 * `ssh-keygen -lf` for a raw public key blob.
 */
export function fingerprintKey(keyBuffer: Buffer): string {
  const hash = crypto.createHash('sha256').update(keyBuffer).digest('base64').replace(/=+$/, '');
  return `SHA256:${hash}`;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesHashedPattern(pattern: string, identifier: string): boolean {
  const parts = pattern.split('|');
  // Hashed entries look like "|1|<base64 salt>|<base64 hmac>"
  if (parts.length !== 4 || parts[1] !== '1') return false;
  try {
    const salt = Buffer.from(parts[2], 'base64');
    const expected = Buffer.from(parts[3], 'base64');
    const actual = crypto.createHmac('sha1', salt).update(identifier).digest();
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function matchesPattern(pattern: string, identifier: string): boolean {
  if (pattern.startsWith('|1|')) {
    return matchesHashedPattern(pattern, identifier);
  }
  return globToRegExp(pattern).test(identifier);
}

/**
 * Reads and writes an OpenSSH-format known_hosts file, used to detect
 * unknown/changed SFTP host keys (trust-on-first-use) instead of the
 * previous silent accept-anything behavior.
 */
export class KnownHostsStore {
  private filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath ?? path.join(os.homedir(), '.ssh', 'known_hosts');
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private async readEntries(): Promise<KnownHostsEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err: any) {
      if (err?.code === 'ENOENT') return [];
      return [];
    }

    const entries: KnownHostsEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) {
        // Blank/comment lines and marker lines (@cert-authority, @revoked)
        // are not part of the plain host/key matching this store performs.
        continue;
      }
      const fields = trimmed.split(/\s+/);
      if (fields.length < 3) continue;
      const [patternField, , keyField] = fields;
      try {
        const keyBuffer = Buffer.from(keyField, 'base64');
        if (keyBuffer.length === 0) continue;
        entries.push({ patterns: patternField.split(','), keyBuffer });
      } catch {
        continue;
      }
    }
    return entries;
  }

  /**
   * Compares a presented host key against known_hosts for that host.
   * - 'match': an entry exists for this host and its key bytes are identical.
   * - 'mismatch': entries exist for this host but none match this key
   *   (possible MITM, or the server's key was legitimately rotated).
   * - 'unknown': no entry exists for this host at all (first connection).
   */
  public async checkHost(host: string, port: number, keyBuffer: Buffer): Promise<HostKeyCheckResult> {
    const identifier = hostIdentifier(host, port);
    const entries = await this.readEntries();
    let sawHost = false;
    for (const entry of entries) {
      if (!entry.patterns.some((p) => matchesPattern(p, identifier))) continue;
      sawHost = true;
      if (entry.keyBuffer.equals(keyBuffer)) {
        return 'match';
      }
    }
    return sawHost ? 'mismatch' : 'unknown';
  }

  /**
   * Appends a trusted host key entry in plain (non-hashed) OpenSSH format.
   * Existing (now-stale) entries for the same host, if any, are left in
   * place rather than rewritten/removed to keep this operation simple and
   * non-destructive.
   */
  public async addHostKey(host: string, port: number, keyBuffer: Buffer): Promise<void> {
    if (!host || typeof host !== 'string' || /[\r\n\s\0]/.test(host)) {
      throw new Error(`Invalid host for known_hosts: ${host}`);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port for known_hosts: ${port}`);
    }
    const identifier = hostIdentifier(host, port);
    const keyType = readKeyType(keyBuffer);
    if (!keyType || keyType === 'unknown' || /[\r\n\s\0]/.test(keyType)) {
      throw new Error(`Invalid key type for known_hosts: ${keyType}`);
    }
    const line = `${identifier} ${keyType} ${keyBuffer.toString('base64')}\n`;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.appendFile(this.filePath, line, { encoding: 'utf-8', mode: 0o644 });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        await fs.writeFile(this.filePath, line, { encoding: 'utf-8', mode: 0o644 });
      } else {
        throw err;
      }
    }
  }
}
