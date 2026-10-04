/**
 * Suggests the remote path (relative to the remote home) for a file or
 * directory picked in the file manager. Keeps the part of the source path
 * from the first dot-segment onward, so "/home/u/.kube/config" maps to
 * "~/.kube/config" rather than "~/.config". Falls back to "~/.<name>" when
 * the path has no dot-segment.
 */
export function defaultDotfileRemotePath(sourcePath: string): string {
  const segments = sourcePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const dotIndex = segments.findIndex((s) => s.startsWith('.') && s !== '.' && s !== '..');
  if (dotIndex >= 0) {
    return `~/${segments.slice(dotIndex).join('/')}`;
  }
  const name = segments[segments.length - 1] ?? '';
  return name ? `~/.${name}` : '~/';
}
