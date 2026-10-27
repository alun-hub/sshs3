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

/**
 * Quotes a path for use as a file operand of a remote command. A relative path is anchored with `./`
 * so it can never be read as something else: a leading `-` is an option (GNU `sed -e1e…` runs shell
 * commands), and `find` also takes a leading `!`, `(`, `)` or `,` for part of its expression. Preferred
 * over `--` because not every tool (e.g. `find`) accepts it.
 */
export function quotePathOperand(value: string): string {
  const sanitized = value.replace(/\0/g, '');
  return quoteShellArg(sanitized.startsWith('/') ? sanitized : `./${sanitized}`);
}
