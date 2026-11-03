import type { StorageConnectConfig } from '../../shared/types/ipc';

interface TargetLocation {
  target?: StorageConnectConfig;
  remoteBasePath?: string;
}

const trimSlashes = (value: string | undefined): string => (value ?? '').trim().replace(/\/+$/, '');

/**
 * Where the sync files live, reduced to what decides whose data they are: the connection type, host/port/user
 * (SFTP) or endpoint/region (S3) and the base path (which carries the S3 bucket). Credentials and auth type are
 * left out on purpose, so rotating a password or key does not count as a new target. The target `id` is not
 * used either: the renderer gives every sync target the same id.
 */
function locationKey({ target, remoteBasePath }: TargetLocation): string | null {
  if (!target) return null;
  const base = trimSlashes(remoteBasePath);
  if (target.type === 'sftp') {
    const c = target.sftpConfig;
    return JSON.stringify(['sftp', (c?.host ?? '').trim().toLowerCase(), c?.port ?? 22, c?.username ?? '', base]);
  }
  if (target.type === 's3') {
    const c = target.s3Config;
    return JSON.stringify(['s3', trimSlashes(c?.endpoint).toLowerCase(), (c?.region ?? '').trim(), base]);
  }
  return JSON.stringify([target.type, target.id, base]);
}

/**
 * True when `next` points at different storage than the previously configured target. A first setup (nothing
 * configured before) is not a change. Used to drop the cached sync key and salts, which belong to the data on
 * the old target and must never be used to write to a new one.
 */
export function isSyncTargetChanged(previous: TargetLocation, next: TargetLocation): boolean {
  const before = locationKey(previous);
  if (before === null) return false;
  return before !== locationKey(next);
}
