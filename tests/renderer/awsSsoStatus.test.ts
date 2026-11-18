import { describe, it, expect } from 'vitest';
import { describeSsoStatus } from '../../src/renderer/src/lib/awsSsoStatus';

describe('describeSsoStatus', () => {
  it('describes each state in words, not just colour', () => {
    expect(describeSsoStatus(null, true)).toEqual({ tone: 'none', text: 'Checking sign-in…' });
    expect(describeSsoStatus(null, false)).toEqual({ tone: 'none', text: 'Not signed in' });
    expect(describeSsoStatus({ status: 'missing' }, false).text).toBe('Not signed in');
    expect(describeSsoStatus({ status: 'expired' }, false)).toEqual({ tone: 'warn', text: 'Sign-in expired. Sign in again.' });
    const ok = describeSsoStatus({ status: 'valid', expiresAt: '2030-05-06T07:08:00' }, false);
    expect(ok.tone).toBe('ok');
    expect(ok.text).toBe('Signed in until 2030-05-06 07:08');
  });
});
