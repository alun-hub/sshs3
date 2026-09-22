/** Converts a simple filename glob (`*`, `?`) into a case-insensitive whole-name RegExp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchesAnyGlob(name: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(name));
}

/**
 * Cheap binary-file heuristic shared by the local and S3 backends (the SFTP backend gets
 * this for free from `grep -I`): a NUL byte in the first kilobyte reliably indicates
 * non-text content and is the same signal `grep -I`/git use to skip binaries.
 */
export function isLikelyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 1024);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
