import { describe, it, expect, vi } from 'vitest';
import { handleHostKeyChanged, knownHostsPattern, parseHostKeyChanged } from '../../src/main/ssh/hostKeyChanged';

const WARNING = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'The fingerprint for the ED25519 key sent by the remote host is',
  'SHA256:abc+DEF/123.',
  'Host key verification failed.',
].join('\r\n');

describe('parseHostKeyChanged', () => {
  it('extracts key type and fingerprint', () => {
    expect(parseHostKeyChanged(WARNING)).toEqual({ keyType: 'ED25519', fingerprint: 'SHA256:abc+DEF/123' });
  });
  it('ignores ANSI escapes and falls back to unknown without a fingerprint', () => {
    expect(parseHostKeyChanged('\x1b[1mREMOTE HOST IDENTIFICATION HAS CHANGED\x1b[0m')).toEqual({
      keyType: 'unknown',
      fingerprint: 'unknown',
    });
  });
  it('returns null for other output', () => {
    expect(parseHostKeyChanged('Permission denied (publickey).')).toBeNull();
  });
});

describe('knownHostsPattern', () => {
  it('brackets non-default ports', () => {
    expect(knownHostsPattern('h', 22)).toBe('h');
    expect(knownHostsPattern('h', 2222)).toBe('[h]:2222');
  });
});

describe('handleHostKeyChanged', () => {
  const target = { host: 'h', port: 22, keyType: 'ED25519', fingerprint: 'SHA256:x' };

  it('removes the old entry only after the user agrees', async () => {
    const removeKnownHost = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    const promptHostKeyTrust = vi.fn().mockResolvedValue(true);
    expect(await handleHostKeyChanged(target, { promptHostKeyTrust, notify, removeKnownHost })).toBe(true);
    expect(promptHostKeyTrust).toHaveBeenCalledWith(expect.objectContaining({ status: 'mismatch', host: 'h' }));
    expect(removeKnownHost).toHaveBeenCalledWith('h', 22);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Reconnect'));
  });

  it('leaves known_hosts alone when declined', async () => {
    const removeKnownHost = vi.fn();
    const promptHostKeyTrust = vi.fn().mockResolvedValue(false);
    expect(await handleHostKeyChanged(target, { promptHostKeyTrust, notify: vi.fn(), removeKnownHost })).toBe(false);
    expect(removeKnownHost).not.toHaveBeenCalled();
  });

  it('reports a failed removal', async () => {
    const notify = vi.fn();
    const removeKnownHost = vi.fn().mockRejectedValue(new Error('boom'));
    const promptHostKeyTrust = vi.fn().mockResolvedValue(true);
    expect(await handleHostKeyChanged(target, { promptHostKeyTrust, notify, removeKnownHost })).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });
});
