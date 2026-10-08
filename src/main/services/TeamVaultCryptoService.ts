import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAgeBinary } from './AgeBinaryResolver';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VAULT_KEY_LENGTH = 32;
const EXEC_TIMEOUT_MS = 15000;
const MAX_BUFFER = 4 * 1024 * 1024;

export class TeamVaultDecryptionError extends Error {
  constructor(message = 'Wrong Vault Key or corrupted vault payload') {
    super(message);
    this.name = 'TeamVaultDecryptionError';
  }
}

/** The additional authenticated data binding a payload to one specific vault and format — see
 * docs/team-vault-plan.md §2.3 ("AAD=vault_id+format_version"). Without this, a payload cut from
 * one vault file could silently decrypt as if it belonged to a different one. */
function buildAad(vaultId: string, formatVersion: number): Buffer {
  return Buffer.from(`${vaultId}:${formatVersion}`, 'utf8');
}

/**
 * Rejects a value that would be interpreted as another CLI flag rather than the positional
 * argument it's meant to be (classic argument-injection: a value like `-o/etc/passwd` or
 * `--output=...` landing where a recipient string or file path was expected). `execFile` already
 * avoids shell interpolation, but it does nothing to stop the *binary itself* from parsing an
 * attacker-influenced value as one of its own flags — this is the defense for that, applied at
 * the actual sink regardless of what the IPC layer already checked. */
function assertNotFlagLike(value: string, label: string): void {
  if (!value || value.startsWith('-')) {
    throw new Error(`Invalid ${label}`);
  }
}

/**
 * Crypto primitives for the Team Vault (docs/team-vault-plan.md), a separate trust model from
 * `SyncCryptoService`: instead of one password shared by everyone, a random "Vault Key" encrypts
 * the payload, and that Vault Key is wrapped individually per recipient via `age` +
 * `age-plugin-yubikey` against each member's PIV hardware key (§2.1-2.2). The Vault Key itself is
 * never derived from a password and never touches disk outside this process' memory — callers are
 * responsible for discarding it on lock/quit, exactly as `SyncCryptoService.lock()` does for its
 * own keys today.
 */
export class TeamVaultCryptoService {
  /** A fresh, random 256-bit Vault Key. Never persisted directly — only its per-recipient
   * `age`-wrapped form (see `wrapVaultKeyForRecipient`) is written to the vault file. */
  generateVaultKey(): Buffer {
    return crypto.randomBytes(VAULT_KEY_LENGTH);
  }

  /** AES-256-GCM-encrypts `plaintext` under `vaultKey`, bound to `vaultId`/`formatVersion` via
   * AAD. Returns base64 of `[iv(12)][authTag(16)][ciphertext]`, matching the vault file's
   * `encrypted_payload` field (§2.3). */
  encryptPayload(vaultKey: Buffer, vaultId: string, formatVersion: number, plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
    cipher.setAAD(buildAad(vaultId, formatVersion));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  /** Reverses `encryptPayload`. Throws `TeamVaultDecryptionError` on a wrong Vault Key,
   * mismatched `vaultId`/`formatVersion`, or a corrupted/tampered payload — AES-GCM's auth tag
   * check doubles as that verification, same as `SyncCryptoService.decrypt()`. */
  decryptPayload(vaultKey: Buffer, vaultId: string, formatVersion: number, encryptedPayload: string): string {
    const data = Buffer.from(encryptedPayload, 'base64');
    if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new TeamVaultDecryptionError('Encrypted payload is truncated or corrupt');
    }
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAAD(buildAad(vaultId, formatVersion));
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new TeamVaultDecryptionError();
    }
  }

  /**
   * Wraps `vaultKey` for one recipient via the `age` CLI — a pure public-key operation (§4.3:
   * "admin needs only the member's public certificate"), so no PIV card or PIN is involved on
   * either side. `ageRecipient` is the recipient's public `age1...`/`age1yubikey1...` string.
   * Returns the armored ciphertext to store as that recipient's `wrapped_vault_key` (§2.3).
   */
  async wrapVaultKeyForRecipient(vaultKey: Buffer, ageRecipient: string): Promise<string> {
    assertNotFlagLike(ageRecipient, 'age recipient');
    const stdout = await runAgeCommand(resolveAgeBinary('age'), ['-r', ageRecipient, '-a'], vaultKey);
    return stdout.toString('utf8');
  }

  /**
   * Unwraps a `wrapped_vault_key` back into the raw Vault Key bytes, via `age -d -i
   * <identityFilePath>`. `identityFilePath` holds a public `AGE-PLUGIN-YUBIKEY-...` identity
   * stanza (a reference to the card's slot, not a secret) — `age` resolves it through the
   * `age-plugin-yubikey` plugin binary, which talks to the physical PIV token.
   *
   * PIN handling note: like `AskpassServer`'s SSH flows, a PIN must never be passed as a CLI
   * argument. `options.pin`, when given, is written to this process' own stdin alongside the
   * ciphertext — but whether `age-plugin-yubikey` actually reads a PIN from that stream
   * non-interactively (rather than its own controlling TTY) is NOT yet verified against real
   * hardware; see docs/team-vault-plan.md Fas 1 "Öppna risker" #1. Until verified, callers should
   * assume the card's PIV slot is configured with a touch-only policy (no PIN prompt) for this
   * path to work end-to-end.
   */
  async unwrapVaultKey(wrappedVaultKey: string, identityFilePath: string): Promise<Buffer> {
    assertNotFlagLike(identityFilePath, 'identity file path');
    const agePath = resolveAgeBinary('age');
    const pluginPath = resolveAgeBinary('age-plugin-yubikey');
    const stdout = await runAgeCommand(
      agePath,
      ['-d', '-i', identityFilePath],
      Buffer.from(wrappedVaultKey, 'utf8'),
      // `age` discovers `age-plugin-yubikey` by name on PATH; prepend its resolved directory so a
      // bundled (packaged-app) or dev-fetched copy is found even when it isn't installed system-wide.
      pluginPathEnv(pluginPath)
    );
    return stdout;
  }

  /**
   * Generates a fresh `age-plugin-yubikey` recipient from the operator's own PIV card
   * (`age-plugin-yubikey --generate`) and persists the resulting identity stanza to a file under
   * `identityOutDir` for later use by `unwrapVaultKey`. Returns the public `age1yubikey1...`
   * recipient string — safe to hand to whoever is adding this person to the vault (§4.3: "admin
   * needs only the member's public certificate").
   *
   * Hardware-unverified (docs/team-vault-plan.md Fas 2 "Kvarstående risker"): whether
   * `--generate` prompts for touch/PIN, and how, has not been confirmed against real hardware.
   */
  async enrollOwnPivRecipient(identityOutDir: string): Promise<{ recipient: string; identityFilePath: string }> {
    const stdout = await runAgeCommand(resolveAgeBinary('age-plugin-yubikey'), ['--generate'], Buffer.alloc(0));
    const text = stdout.toString('utf8');
    const recipientMatch = text.match(/age1yubikey1\S+/);
    if (!recipientMatch) {
      throw new Error('age-plugin-yubikey --generate did not produce a recipient string');
    }

    await fs.mkdir(identityOutDir, { recursive: true });
    const identityFilePath = path.join(identityOutDir, `${crypto.randomUUID()}.txt`);
    await fs.writeFile(identityFilePath, text, { mode: 0o600 });

    return { recipient: recipientMatch[0], identityFilePath };
  }

  /**
   * Generates a fresh software age identity (via `age-keygen`) for the vault's recovery key
   * (§4.1): an ordinary age keypair the admin prints and locks away, deliberately not tied to any
   * hardware so it still works if every PIV card is lost. Returns the plaintext identity (to show
   * the admin exactly once — the caller must never persist it) and its public recipient string.
   */
  async generateRecoveryIdentity(): Promise<{ identity: string; recipient: string }> {
    const stdout = await runAgeCommand(resolveAgeBinary('age-keygen'), [], Buffer.alloc(0));
    const identity = stdout.toString('utf8');
    const recipientMatch = identity.match(/#\s*public key:\s*(age1\S+)/i);
    if (!recipientMatch) {
      throw new Error('age-keygen did not produce a recognizable public key comment');
    }
    return { identity, recipient: recipientMatch[1] };
  }
}

function pluginPathEnv(pluginPath: string): NodeJS.ProcessEnv {
  const pluginDir = pluginPath.includes('/') || pluginPath.includes('\\') ? dirnameOf(pluginPath) : undefined;
  if (!pluginDir) return process.env;
  const pathSep = process.platform === 'win32' ? ';' : ':';
  return { ...process.env, PATH: `${pluginDir}${pathSep}${process.env.PATH ?? ''}` };
}

function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? '' : p.slice(0, idx);
}

/** Runs an `age`-family binary, feeding `input` on stdin and collecting stdout as a Buffer.
 * Mirrors the defensive timeout/maxBuffer style already used for `certWorker.cjs` invocations. */
function runAgeCommand(
  binary: string,
  args: string[],
  input: Buffer,
  env: NodeJS.ProcessEnv = process.env
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      args,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER, encoding: 'buffer', env },
      (err, stdout, stderr) => {
        if (err) {
          const stderrText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr ?? '');
          reject(new Error(stderrText.trim() || err.message));
          return;
        }
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      }
    );
    child.stdin?.end(input);
  });
}
