import { getBaseName, joinPaths } from '../transfer/TransferPipeline';
import type { StorageType } from '../../shared/types/storage';
import type { K8sWebLoginOptions } from '../../shared/types/kubernetes';

/** True when any leaf pane of a saved session's pane tree uses the given auth type. */
export function paneTreeHasAuthType(node: unknown, authType: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, any>;
  if (n.type === 'leaf') {
    return n.config?.authType === authType;
  }
  if (Array.isArray(n.children)) {
    return n.children.some((child) => paneTreeHasAuthType(child, authType));
  }
  return false;
}

/**
 * `ssh-add -K` (load FIDO2 *resident/discoverable* credentials) reports "Provider \"internal\"
 * returned failure -1" / "Unable to load resident keys: invalid format" whenever the
 * authenticator's own CTAP2 stack returns FIDO_ERR_PIN_AUTH_BLOCKED — verified directly with
 * `ssh-add -v -K`, which prints that exact libfido2 error code for this failure. That's a
 * device-side safety lockout (CTAP2 blocks further PIN verification until the key is unplugged
 * and reconnected, after a few failed/rapid PIN submissions in the current power cycle) — it is
 * NOT the persistent PIN-retry counter (`ykman fido info` still showed all attempts remaining
 * while this reproduced), so it is unrelated to whether the PIN typed was actually correct, and
 * unplugging/reconnecting the key is the only way to clear it — retrying in-app cannot help.
 */
export function describeFido2StartupError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/provider "internal" returned failure -1/i.test(message) && /invalid format/i.test(message)) {
    if (process.platform === 'win32') {
      // The Linux-verified PIN_AUTH_BLOCKED cause above was not confirmed on Windows: the same
      // message persisted after unplugging/reconnecting and entering the PIN once. Windows also
      // blocks direct HID access to FIDO devices for non-elevated processes, which the built-in
      // provider needs to enumerate resident keys — so don't claim a cause we haven't proven.
      return 'Windows could not read the resident keys from the security key (ssh-add -K failed with "Provider internal returned failure -1"). If you already unplugged and reconnected the key and entered the PIN once, this is likely because reading resident credentials needs direct access to the device, which Windows only allows for an elevated (Administrator) process. Resident-key login may need sshs3 started as Administrator, or a key file instead.';
    }
    return 'This security key has temporarily blocked PIN verification (likely after a few failed or rapid attempts) and needs to be unplugged and reconnected before it will accept a PIN again. This is not a wrong PIN.';
  }
  return message;
}

/**
 * The target field always names an existing parent directory (so it stays
 * browsable even when the eventual sync root doesn't exist yet); the
 * source folder's own name is nested under it, mirroring how drag/drop
 * copy (TRANSFER_ADD, above) and most file managers behave.
 */
export function resolveDirSyncTargetRoot(
  sourcePath: string,
  targetProviderType: StorageType,
  targetParentPath: string
): string {
  const sourceBaseName = getBaseName(sourcePath);
  if (!sourceBaseName) {
    return targetParentPath;
  }
  return joinPaths(targetProviderType, targetParentPath, sourceBaseName);
}

/**
 * True when a storage provider's error means "that path does not exist" (as opposed to a lost
 * connection, a permission problem or a timeout). Codes and status fields only, plus the exact
 * "not found" messages the S3 and pod providers throw, so a connection failure is never read as a miss.
 */
export function isMissingPathError(err: unknown): boolean {
  const e = err as { code?: unknown; statusCode?: unknown; name?: unknown; message?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'NoSuchKey' || e.code === 'NotFound') return true;
  if (e.name === 'NotFound' || e.name === 'NoSuchKey') return true;
  // SFTP status 2 (SSH_FX_NO_SUCH_FILE).
  if (e.name === 'SftpError' && e.statusCode === 2) return true;
  return typeof e.message === 'string' && /^(?:Path|File or directory|Directory) not found\b/.test(e.message);
}

const MAX_SERVER_URL_LENGTH = 2048;
const MAX_NAMESPACE_LENGTH = 253;

/** Validates the cluster API URL that the renderer sends for the OpenShift browser sign-in. */
export function parseK8sServerArg(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Server URL is required');
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_SERVER_URL_LENGTH) {
    throw new Error('Server URL is too long');
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Invalid server URL');
  }
  if (!url.hostname) {
    throw new Error('Invalid server URL');
  }
  return trimmed;
}

/** Validates untrusted IPC arguments for the OpenShift browser sign-in. */
export function parseWebLoginOptions(raw: unknown): K8sWebLoginOptions {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid sign-in options');
  }
  const input = raw as Record<string, unknown>;
  const options: K8sWebLoginOptions = { server: parseK8sServerArg(input.server) };

  if (input.insecureSkipTlsVerify !== undefined) {
    if (typeof input.insecureSkipTlsVerify !== 'boolean') {
      throw new Error('Invalid TLS option');
    }
    options.insecureSkipTlsVerify = input.insecureSkipTlsVerify;
  }
  if (input.namespace !== undefined) {
    if (typeof input.namespace !== 'string' || input.namespace.length > MAX_NAMESPACE_LENGTH) {
      throw new Error('Invalid namespace');
    }
    const namespace = input.namespace.trim();
    if (namespace) options.namespace = namespace;
  }
  if (input.callbackPort !== undefined) {
    const port = input.callbackPort;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Callback port must be an integer between 1024 and 65535');
    }
    options.callbackPort = port;
  }
  return options;
}
