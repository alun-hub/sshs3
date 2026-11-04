import fsp from 'node:fs/promises';
import path from 'node:path';
import type { StorageType } from '../../shared/types/storage';

export const SAME_FILE_ERROR = 'Source and target are the same file';

/**
 * Canonical form used only to compare two paths on one provider: native rules for local paths
 * (case-insensitive on Windows), posix rules with no trailing slash for SFTP, S3 and K8s.
 */
export function comparablePath(providerType: StorageType, p: string): string {
  if (providerType === 'local') {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
  const normalized = path.posix.normalize(p.replace(/\\/g, '/'));
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

/**
 * True when copying `sourcePath` to `targetPath` on the same provider would write a file onto itself
 * (the target is opened and truncated while the source is still being read). The caller must already
 * know both paths belong to one provider.
 */
export function isSamePathOnProvider(providerType: StorageType, sourcePath: string, targetPath: string): boolean {
  return comparablePath(providerType, sourcePath) === comparablePath(providerType, targetPath);
}

/**
 * Like `isSamePathOnProvider`, but for local files it also compares device and inode when the spelling differs. That
 * catches a differently-cased name on a case-insensitive filesystem (default on macOS), a symlink and a hard link to
 * the source, none of which a string comparison can see. A target that does not exist yet is never the same file.
 */
export async function isSameFileOnProvider(
  providerType: StorageType,
  sourcePath: string,
  targetPath: string,
  /** Maps a provider path to the real path (a `LocalStorageProvider` with a base path resolves relative paths against it). */
  resolve: (p: string) => string = (p) => p
): Promise<boolean> {
  if (isSamePathOnProvider(providerType, sourcePath, targetPath)) return true;
  if (providerType !== 'local') return false;
  try {
    const [a, b] = await Promise.all([fsp.stat(resolve(sourcePath), { bigint: true }), fsp.stat(resolve(targetPath), { bigint: true })]);
    // Some filesystems (exFAT, FUSE, network mounts) report constant or truncated inodes, so equal ino and dev alone could block
    // an ordinary copy. A real hard link or symlink also shares size and modification time, which costs nothing to require.
    return a.ino !== 0n && a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeNs === b.mtimeNs;
  } catch {
    return false;
  }
}
