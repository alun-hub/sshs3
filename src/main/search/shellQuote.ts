/**
 * Single-quotes a string for safe interpolation into a POSIX shell command line,
 * escaping any embedded single quotes. Shared by every service that builds a
 * remote command from user-controlled input (paths, search patterns, globs) so
 * the escaping logic lives in exactly one place.
 */
export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
