import { execFile } from 'node:child_process';
import type { HostKeyPromptInfo } from './HostKeyVerifier';

export interface HostKeyChangedInfo {
  keyType: string;
  fingerprint: string;
}

// eslint-disable-next-line no-control-regex -- strips terminal escape sequences from ssh's PTY output
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Reads OpenSSH's "REMOTE HOST IDENTIFICATION HAS CHANGED" warning from a session's output; null if absent. */
export function parseHostKeyChanged(output: string): HostKeyChangedInfo | null {
  const text = output.replace(ANSI_RE, '').replace(/\r/g, '');
  if (!/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) return null;
  const m = /fingerprint for the (\S+) key sent by the remote host is\s+(\S+?)\.?(?:\s|$)/i.exec(text);
  return { keyType: m?.[1] ?? 'unknown', fingerprint: m?.[2] ?? 'unknown' };
}

/** The known_hosts pattern OpenSSH stores a host under: `host`, or `[host]:port` for a non-default port. */
export function knownHostsPattern(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

/** Removes every known_hosts entry for the host (`ssh-keygen -R`), so the next connection asks about the new key. */
export function removeKnownHost(host: string, port: number): Promise<void> {
  // Never let a host be parsed as an ssh-keygen flag or smuggle whitespace/control characters.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!host || /^-|[\s\x00-\x1f]/.test(host)) return Promise.reject(new Error('Invalid host name'));
  const binary = process.platform === 'win32' ? 'ssh-keygen.exe' : 'ssh-keygen';
  return new Promise((resolve, reject) => {
    execFile(binary, ['-R', knownHostsPattern(host, port)], { timeout: 10_000 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve();
    });
  });
}

export interface HostKeyChangedDeps {
  promptHostKeyTrust: (info: HostKeyPromptInfo) => Promise<boolean>;
  /** Writes a notice into the session's terminal. */
  notify: (message: string) => void;
  removeKnownHost?: (host: string, port: number) => Promise<void>;
}

/** Asks whether to replace the stored key; on yes removes the old entry so the next connect re-verifies. */
export async function handleHostKeyChanged(
  target: { host: string; port: number } & HostKeyChangedInfo,
  deps: HostKeyChangedDeps
): Promise<boolean> {
  const replace = await deps.promptHostKeyTrust({
    host: target.host,
    port: target.port,
    keyType: target.keyType,
    fingerprint: target.fingerprint,
    status: 'mismatch',
  });
  if (!replace) return false;
  try {
    await (deps.removeKnownHost ?? removeKnownHost)(target.host, target.port);
  } catch (err) {
    deps.notify(`\r\n\x1b[31m[sshs3: could not remove the old host key: ${(err as Error).message}]\x1b[0m\r\n`);
    return false;
  }
  deps.notify(
    `\r\n\x1b[32m[sshs3: old host key for ${target.host} removed. Reconnect to verify and trust the new key.]\x1b[0m\r\n`
  );
  return true;
}
