/**
 * The PKCS#11 modules the app's own ssh-agent may load on macOS (matched against the module's real path). OpenSSH
 * only allows `/usr/lib*` and `/usr/local/lib*` by default, which leaves out where the OpenSC installer puts its module.
 * Deliberately narrow: Homebrew's `/opt/homebrew` is writable without administrator rights, so it is not added.
 */
export const MAC_AGENT_PROVIDER_ALLOWLIST = '/usr/lib*/*,/usr/local/lib*/*,/Library/OpenSC/*';

/** Extra `ssh-agent` arguments for the allow-list. Other platforms keep OpenSSH's default. */
export function agentProviderArgs(platform: NodeJS.Platform): string[] {
  return platform === 'darwin' ? ['-P', MAC_AGENT_PROVIDER_ALLOWLIST] : [];
}
