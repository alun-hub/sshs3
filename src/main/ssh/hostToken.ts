/**
 * Whether a string is safe to embed, unquoted, inside an OpenSSH `ProxyCommand=...` value that is executed via `/bin/sh -c`
 * (or `cmd.exe`) by the `ssh` client itself. This gates `config.host` (substituted by ssh's own `%h` expansion into the
 * ProxyCommand string), `config.proxy.host` (interpolated directly by `buildSSHArguments`) and the host name `ssh -G`
 * resolves for an alias (`resolvedHostName.ts`): any character outside this allowlist could break out of the command and
 * execute arbitrary shell commands when the connection is established.
 * Restricted to characters valid in a DNS hostname or IPv4/IPv6 literal.
 */
export function isSafeHostToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && /^[A-Za-z0-9.\-_[\]:]+$/.test(value);
}
