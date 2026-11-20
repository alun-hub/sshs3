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

/** The directive's value from a config line (`Key value` or `Key=value`), or undefined when the line has none. */
export function directiveValue(line: string): string | undefined {
  const match = /^\s*\S+?(?:\s*=\s*|\s+)(.*?)\s*$/.exec(line);
  return match?.[1];
}

/** False when the value of a managed-block directive could put shell syntax into an ssh-expanded command. */
export function isSafeManagedDirectiveValue(directive: string, value: string | undefined): boolean {
  if (value === undefined) return true;
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
