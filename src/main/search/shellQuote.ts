/**
 * Single-quotes a string for safe interpolation into a POSIX shell command line,
 * escaping any embedded single quotes and removing null bytes to prevent argument truncation.
 * Shared by every service that builds a remote command from user-controlled input
 * (paths, search patterns, globs) so the escaping logic lives in exactly one place.
 */
export function quoteShellArg(value: string): string {
  const sanitized = value.replace(/\0/g, '');
  return `'${sanitized.replace(/'/g, "'\\''")}'`;
}
