/**
 * Value checks for directives of a managed `~/.ssh/config` block that arrives from a sync pull.
 *
 * `blockedSshDirectives.ts` decides which directives may appear; this decides which VALUES may. ssh expands `%h`, `%p`
 * and `%r` itself from the resolved config (`HostName`, `Port`, `User`) into every ProxyCommand and into the command it
 * builds for `ProxyJump`, and those strings are run by a shell. So a synced `HostName "x$(cmd)"` (a quoted value passes
 * the ssh_config parser) would reach `sh -c "aws ssm start-session --target %h ..."` and run as the local user. Only text
 * that cannot carry shell syntax may be written.
 */

/** A host name, IPv4 literal or IPv6 literal: letters, digits, `.`, `-`, `_` and `:` (and brackets around IPv6). */
const HOSTNAME_VALUE = /^[A-Za-z0-9_.:[\]-]{1,255}$/;
const PORT_VALUE = /^\d{1,5}$/;
/** Quotes, backtick, `$`, `;`, `&`, `|`, redirects, brackets/braces of a command, backslash, `%` and control characters. */
const SHELL_SYNTAX = /["'`$;&|<>(){}\\%\x00-\x1f\x7f]/; // eslint-disable-line no-control-regex -- rejecting control characters is the point

/**
 * The directive's value from a config line (`Key value` or `Key=value`), or undefined when the line has none.
 * `[\s\S]` and not `.`: a `.` does not match CR, U+2028 or U+2029, and a line with one of them in the middle used to
 * give `undefined` here, which the check below then took for "no value, nothing to check".
 */
export function directiveValue(line: string): string | undefined {
  const match = /^\s*\S+?(?:\s*=\s*|\s+)([\s\S]*?)\s*$/.exec(line);
  return match?.[1];
}

/** Directives whose resolved value ssh expands (%h, %p, %r) into a command that a shell runs. */
const EXPANDED_DIRECTIVES = new Set(['hostname', 'port', 'user', 'proxyjump']);

/**
 * True when a config line holds a control character other than TAB (CR, VT, FF, NEL, ...) or a Unicode line/paragraph
 * separator. ssh only ends a line at LF, so these stay inside a quoted value, where they hide the rest of the value from
 * every check that stops at a "line" boundary. Nothing sshs3 generates contains them.
 */
const UNSAFE_LINE_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u2028\u2029]/; // eslint-disable-line no-control-regex -- rejecting control characters is the point
export function hasUnsafeLineChars(trimmedLine: string): boolean {
  return UNSAFE_LINE_CHARS.test(trimmedLine);
}

/**
 * False when the value of a managed-block directive could put shell syntax into an ssh-expanded command. Fails closed:
 * a directive whose value is expanded into a command and that cannot be read is NOT safe.
 */
export function isSafeManagedDirectiveValue(directive: string, value: string | undefined): boolean {
  if (value === undefined) return !EXPANDED_DIRECTIVES.has(directive);
  switch (directive) {
    case 'hostname':
      return HOSTNAME_VALUE.test(value);
    case 'port':
      return PORT_VALUE.test(value);
    case 'user':
    case 'proxyjump':
      // A jump alias or user@host:port list. No whitespace is needed here: several jump hosts are comma separated.
      return !SHELL_SYNTAX.test(value) && !/\s/.test(value);
    default:
      return true;
  }
}
