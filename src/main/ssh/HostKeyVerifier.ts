export interface HostKeyPromptInfo {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  /** 'unknown' = first time seeing this host. 'mismatch' = the key changed since it was last trusted. */
  status: 'unknown' | 'mismatch';
}

/**
 * Host key trust for SFTP/SSH transports. OpenSSH does the key exchange itself and keeps
 * `~/.ssh/known_hosts` up to date; the app only answers its "continue connecting?" question
 * (via askpass) by showing `hostKeyPrompt` to the user. There is no known_hosts handling of
 * our own: an absent `hostKeyPrompt` means the question is answered "no" (fail closed).
 */
export interface SshHostVerifier {
  host: string;
  port: number;
  /** Prompts the user (trust-on-first-use dialog) and resolves to whether they chose to trust the key. */
  hostKeyPrompt: (info: HostKeyPromptInfo) => Promise<boolean>;
}

export interface CreateHostVerifierOptions {
  host: string;
  port: number;
  onUnknownOrChanged: (info: HostKeyPromptInfo) => Promise<boolean>;
}

export function createHostVerifier(options: CreateHostVerifierOptions): SshHostVerifier {
  return { host: options.host, port: options.port, hostKeyPrompt: options.onUnknownOrChanged };
}
