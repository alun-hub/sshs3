import { describe, it, expect } from 'vitest';
import { fingerprintKey } from '../../src/main/ssh/hostKeyFingerprint';

describe('fingerprintKey', () => {
  it('produces a stable OpenSSH-style SHA256 fingerprint', () => {
    const key = Buffer.from('payload', 'utf8');
    const fp = fingerprintKey(key);
    expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(fingerprintKey(key)).toBe(fp);
    expect(fingerprintKey(Buffer.from('other', 'utf8'))).not.toBe(fp);
  });
});
