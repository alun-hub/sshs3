/**
 * True when the app's renderer is running on Windows. Used to hide or reword features that only work
 * on other platforms — e.g. resident FIDO2 credentials, which Windows' OpenSSH build can't read back
 * (`ssh-add -K` fails there), so FIDO2 profiles use a key file and are never PIN-cached.
 */
export const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

/**
 * Why SFTP (the dual-pane file manager) can't be used with a profile, or undefined when it can.
 * SFTP runs over the system OpenSSH client (`ssh -s sftp`), so every auth type — including FIDO2
 * security keys — works wherever the terminal does. Kept as a hook for future restrictions.
 */
export function sftpUnavailableReason(_authType: string | undefined): string | undefined {
  return undefined;
}
