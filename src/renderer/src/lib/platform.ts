/**
 * True when the app's renderer is running on Windows. Used to hide or reword features that only work
 * on other platforms — e.g. resident FIDO2 credentials, which Windows' OpenSSH build can't read back
 * (`ssh-add -K` fails there), so FIDO2 profiles use a key file and are never PIN-cached.
 */
export const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

/**
 * Why SFTP (the dual-pane file manager) can't be used with a profile, or undefined when it can.
 * The file manager's SSH library can't use FIDO2 security keys (`-sk` keys are filtered out even
 * when loaded in an ssh-agent), and on Windows there is no resident-key fallback — so FIDO2
 * profiles are terminal-only there.
 */
export function sftpUnavailableReason(authType: string | undefined): string | undefined {
  if (IS_WINDOWS && authType === 'fido2') {
    return 'SFTP is not available for FIDO2 security key profiles on Windows — the file manager cannot use security keys. Use the terminal, or a separate profile with an SSH key or smartcard for file transfers.';
  }
  return undefined;
}
