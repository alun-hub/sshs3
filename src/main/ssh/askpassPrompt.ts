import type { AskpassPromptKind } from '../../shared/types/ipc';

/** OpenSSH asking for an account password (as opposed to a PIN or key passphrase). */
export function isPasswordPrompt(rawPrompt: string): boolean {
  return /password/i.test(rawPrompt) && !/pin|passphrase/i.test(rawPrompt);
}

/**
 * Which kind of secret an OpenSSH askpass prompt wants. `undefined` is a key passphrase;
 * anything unrecognised is treated as a smartcard PIN.
 */
export function classifyAskpassPrompt(rawPrompt: string, authType?: string): AskpassPromptKind | undefined {
  if (isPasswordPrompt(rawPrompt)) return 'password';
  if (authType === 'fido2' || /authenticator|security key|yubikey|fido|sk-/i.test(rawPrompt)) return 'fido2';
  return /passphrase/i.test(rawPrompt) ? undefined : 'smartcard';
}

/** What to show the user for an askpass prompt of an interactive SSH session. */
export function describeAskpassPrompt(
  rawPrompt: string,
  config: { authType?: string; name?: string; host: string }
): { kind: AskpassPromptKind | undefined; prompt: string; context: string } {
  const kind = classifyAskpassPrompt(rawPrompt, config.authType);
  const hostLabel = config.name ? `${config.name} (${config.host})` : config.host;
  if (kind === 'password') {
    return { kind, prompt: rawPrompt.trim(), context: `SSH: ${hostLabel}` };
  }
  if (kind === 'fido2') {
    return {
      kind,
      prompt: rawPrompt.trim() || `Enter PIN for security key to connect via SSH to ${hostLabel}:`,
      context: `FIDO2: ${hostLabel}`,
    };
  }
  return {
    kind,
    prompt: `Enter your smartcard PIN to connect via SSH to ${hostLabel}:`,
    context: `Smartcard: ${hostLabel}`,
  };
}
