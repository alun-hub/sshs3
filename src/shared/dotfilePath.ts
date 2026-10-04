/**
 * Suggests the remote path (relative to the remote home) for a local or
 * remote source file. When the file lives under `homeDir`, the path below
 * home is kept ("/home/u/.kube/config" -> "~/.kube/config"). Otherwise the
 * part from the first dot-segment onward is kept, and as a last resort
 * "~/.<name>".
 */
export function defaultDotfileRemotePath(sourcePath: string, homeDir?: string): string {
  const norm = sourcePath.replace(/\\/g, '/');
  if (homeDir) {
    const home = homeDir.replace(/\\/g, '/').replace(/\/+$/, '');
    if (home && norm.startsWith(`${home}/`)) {
      return `~/${norm.slice(home.length + 1)}`;
    }
  }
  const segments = norm.split('/').filter(Boolean);
  const dotIndex = segments.findIndex((s) => s.startsWith('.') && s !== '.' && s !== '..');
  if (dotIndex >= 0) {
    return `~/${segments.slice(dotIndex).join('/')}`;
  }
  const name = segments[segments.length - 1] ?? '';
  return name ? `~/.${name}` : '~/';
}
