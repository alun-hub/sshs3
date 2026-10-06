import { describe, it, expect } from 'vitest';
import { classifyAskpassPrompt, describeAskpassPrompt, isPasswordPrompt } from '../../src/main/ssh/askpassPrompt';

describe('askpassPrompt', () => {
  it('recognises account password prompts but not PIN or passphrase prompts mentioning "password"', () => {
    expect(isPasswordPrompt('alice@host.example.com\'s password: ')).toBe(true);
    expect(isPasswordPrompt('Enter passphrase for key (password protected):')).toBe(false);
    expect(isPasswordPrompt('Enter PIN for PKCS#11 password:')).toBe(false);
  });

  it('classifies password, fido2, passphrase and smartcard prompts', () => {
    expect(classifyAskpassPrompt("bob@h's password:")).toBe('password');
    expect(classifyAskpassPrompt('Enter PIN for sk-ssh-ed25519@openssh.com key', 'privateKey')).toBe('fido2');
    expect(classifyAskpassPrompt('Confirm user presence for YubiKey')).toBe('fido2');
    expect(classifyAskpassPrompt('Enter anything', 'fido2')).toBe('fido2');
    expect(classifyAskpassPrompt('Enter passphrase for /home/me/.ssh/id_ed25519:')).toBeUndefined();
    expect(classifyAskpassPrompt('Enter PIN for PIV_II (PIV Card Holder pin):', 'smartcard')).toBe('smartcard');
  });

  it('describes a prompt with the host label used in the dialog', () => {
    expect(describeAskpassPrompt("bob@h's password: ", { name: 'Prod', host: 'h' })).toEqual({
      kind: 'password',
      prompt: "bob@h's password:",
      context: 'SSH: Prod (h)',
    });
    expect(describeAskpassPrompt('', { authType: 'fido2', host: 'h' })).toEqual({
      kind: 'fido2',
      prompt: 'Enter PIN for security key to connect via SSH to h:',
      context: 'FIDO2: h',
    });
    expect(describeAskpassPrompt('Enter PIN', { authType: 'smartcard', name: 'Prod', host: 'h' })).toEqual({
      kind: 'smartcard',
      prompt: 'Enter your smartcard PIN to connect via SSH to Prod (h):',
      context: 'Smartcard: Prod (h)',
    });
  });

  it('describes a passphrase prompt like a smartcard prompt (kind undefined, generic text)', () => {
    const d = describeAskpassPrompt('Enter passphrase for key:', { host: 'h' });
    expect(d.kind).toBeUndefined();
    expect(d.prompt).toBe('Enter your smartcard PIN to connect via SSH to h:');
  });
});
