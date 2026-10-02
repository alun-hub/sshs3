import { describe, it, expect } from 'vitest';
import { dedupeKeys } from '../../src/main/ssh/PublicKeyDiscovery';
import type { LocalPublicKey } from '../../src/shared/types/ssh';

const key = (over: Partial<LocalPublicKey>): LocalPublicKey => ({
  id: 'SHA256:a',
  line: 'ssh-ed25519 AAAA',
  type: 'ssh-ed25519',
  fingerprint: 'SHA256:a',
  comment: '',
  source: 'agent',
  label: 'x',
  ...over,
});

describe('dedupeKeys', () => {
  it('lets a FIDO2/smartcard source win over the desktop agent that also holds the key', () => {
    const out = dedupeKeys([key({ source: 'agent', label: 'ssh-agent' })], [key({ source: 'fido2', label: 'FIDO2' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'fido2', label: 'FIDO2' });
  });

  it('prefers file over agent and keeps the private key path whichever entry has it', () => {
    const out = dedupeKeys(
      [key({ source: 'agent' })],
      [key({ source: 'file', privateKeyPath: '/home/a/.ssh/id' })],
      [key({ source: 'fido2' })]
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'fido2', privateKeyPath: '/home/a/.ssh/id' });
  });

  it('keeps distinct keys and does not mutate its inputs', () => {
    const a = key({ fingerprint: 'SHA256:a', id: 'SHA256:a' });
    const b = key({ fingerprint: 'SHA256:b', id: 'SHA256:b', source: 'file' });
    const out = dedupeKeys([a], [b, key({ source: 'file', privateKeyPath: '/p' })]);
    expect(out.map((k) => k.fingerprint)).toEqual(['SHA256:a', 'SHA256:b']);
    expect(a.source).toBe('agent');
    expect(a.privateKeyPath).toBeUndefined();
  });
});
