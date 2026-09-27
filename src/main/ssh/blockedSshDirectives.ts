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
]);
