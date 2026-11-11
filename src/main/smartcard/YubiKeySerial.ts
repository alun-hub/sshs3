import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';

/**
 * Which YubiKey a security-key SSH key file (`id_*_sk`) belongs to. The key file itself has no device id (its key
 * handle only opens on the YubiKey that made it), so the serial number is written into the key's comment when sshs3
 * generates it, as `yubikey:<serial>`, and read back from the `.pub` before connecting. Nothing is stored in the
 * profile, so it follows the key file and shows up in `ssh-keygen -l`.
 */

const SERIAL_TAG_RE = /(?:^|\s)yubikey:(\d{4,12})(?:\s|$)/i;
const LIST_TIMEOUT_MS = 5000;

/** The serial number tagged in a public key line's comment (`ssh-ed25519-sk AAAA… user@host yubikey:20185052`), if any. */
export function parseYubiKeySerialTag(publicKeyLine: string): string | undefined {
  // Fields: type, base64 blob, then the comment (which may itself contain spaces).
  const comment = publicKeyLine.trim().split(/\s+/).slice(2).join(' ');
  return SERIAL_TAG_RE.exec(comment)?.[1];
}

/** The key comment for a new key: what ssh-keygen would use by default (`user@host`), plus the YubiKey serial tag. */
export function buildKeyComment(serial: string): string {
  let user = 'user';
  try {
    user = os.userInfo().username || user;
  } catch {
    // userInfo() can throw when there is no passwd entry; fall back to the placeholder.
  }
  return `${user}@${os.hostname()} yubikey:${serial}`;
}

/** The serial tagged in `<privateKeyPath>.pub`, or undefined when the file or the tag is missing. */
export async function readKeyYubiKeySerial(privateKeyPath: string): Promise<string | undefined> {
  try {
    return parseYubiKeySerialTag(await fs.readFile(`${privateKeyPath}.pub`, 'utf-8'));
  } catch {
    return undefined;
  }
}

/** Parses `ykman list --serials` (one serial per line). */
export function parseSerialList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{4,12}$/.test(line));
}

/**
 * The serial numbers of the YubiKeys that are plugged in now, via `ykman list --serials`. `undefined` whenever that cannot be
 * told (ykman not installed, it failed or timed out, or not Windows): callers then behave as before, never block.
 *
 * Windows only for now: the key files are the only way to use a security key there (no resident keys), and the other
 * platforms have not been checked against listing devices while a FIDO session is open.
 */
export function listConnectedYubiKeySerials(): Promise<string[] | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile('ykman', ['list', '--serials'], { timeout: LIST_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      resolve(err ? undefined : parseSerialList(String(stdout)));
    });
  });
}
