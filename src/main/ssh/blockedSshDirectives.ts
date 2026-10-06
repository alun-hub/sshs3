/**
 * ssh_config / ssh command-line directives that must never be accepted from
 * untrusted input — either a connection profile's free-form `extraOptions`
 * (built into a native `ssh` command line by `SmartcardDetector`) or a
 * managed block written into the user's real `~/.ssh/config` by remote
 * profile sync (`SshNativeFileMerger`). Both call sites share this single
 * list so adding a new dangerous directive only has to happen once.
 *
 * A sync source that can plant one of these (a compromised sync target, a
 * compromised paired device, or a leaked master password) would otherwise
 * get, depending on the directive: arbitrary command execution as the local
 * user (`ProxyCommand`, `LocalCommand`, `RemoteCommand`, `KnownHostsCommand`),
 * config injection (`Match`, `Include`), or a silent host-key-verification
 * bypass enabling MITM (`StrictHostKeyChecking`, `UserKnownHostsFile`,
 * `GlobalKnownHostsFile`, `HostbasedAuthentication`, `IdentityAgent`).
 *
 * Do not remove entries without understanding why they're here.
 */
export const BLOCKED_SSH_DIRECTIVES = new Set([
  'proxycommand',
  'localcommand',
  'permitlocalcommand',
  'remotecommand',
  'match',
  'include',
  'knownhostscommand',
  'stricthostkeychecking',
  'userknownhostsfile',
  'globalknownhostsfile',
  'hostbasedauthentication',
  'identityagent',
  // Load an arbitrary local library into ssh / spawn a local helper.
  'securitykeyprovider',
  'xauthlocation',
]);

/**
 * Additionally blocked in a profile's free-form `extraOptions` only. They are
 * legitimate in a user's `~/.ssh/config` (so not in the shared list above), but
 * the app sets both itself — from `pkcs11LibPath` and the profile's jump host —
 * so a value arriving via `extraOptions` can only be an override from untrusted
 * data: a library loaded into ssh, or a hop through an attacker-chosen host.
 */
export const BLOCKED_SSH_EXTRA_OPTION_DIRECTIVES = new Set(['pkcs11provider', 'proxyjump']);

/** A bare ssh option keyword: letters/digits only, so it cannot smuggle a second token (`Key value`), `=` or quotes. */
export function isValidSshOptionKeyword(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(key);
}
