import { KnownHostsStore, fingerprintKey, readKeyType } from './KnownHostsStore';

export interface HostKeyPromptInfo {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  /** 'unknown' = first time seeing this host. 'mismatch' = the key changed since it was last trusted. */
  status: 'unknown' | 'mismatch';
}

export type SshHostVerifierFn = (key: Buffer, verify: (matches: boolean) => void) => void;

export interface CreateHostVerifierOptions {
  host: string;
  port: number;
  knownHosts: KnownHostsStore;
  /** Prompts the user (TOFU dialog) and resolves to whether they chose to trust the key. */
  onUnknownOrChanged: (info: HostKeyPromptInfo) => Promise<boolean>;
}

/**
 * Builds an ssh2 `hostVerifier` callback that checks a presented host key
 * against known_hosts, auto-accepting an exact match and asking the caller
 * to prompt the user (trust-on-first-use) for an unknown or changed key.
 * Accepted new/changed keys are persisted to known_hosts so future
 * connections to the same host are silently accepted.
 */
export function createHostVerifier(options: CreateHostVerifierOptions): SshHostVerifierFn {
  const { host, port, knownHosts, onUnknownOrChanged } = options;

  return (key: Buffer, verify: (matches: boolean) => void) => {
    void (async () => {
      try {
        const status = await knownHosts.checkHost(host, port, key);
        if (status === 'match') {
          verify(true);
          return;
        }

        const trusted = await onUnknownOrChanged({
          host,
          port,
          keyType: readKeyType(key),
          fingerprint: fingerprintKey(key),
          status,
        });

        if (trusted) {
          try {
            await knownHosts.addHostKey(host, port, key);
          } catch {
            // Persisting the trust decision failed (e.g. read-only home dir)
            // - still honor the user's choice for this connection attempt.
          }
        }
        verify(trusted);
      } catch {
        // Fail closed: any unexpected error verifying the host key rejects
        // the connection rather than silently accepting it.
        verify(false);
      }
    })();
  };
}
