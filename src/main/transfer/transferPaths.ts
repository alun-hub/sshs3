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
