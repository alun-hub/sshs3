import { describe, it, expect } from 'vitest';
import { estimatePasswordStrength, MIN_ACCEPTABLE_SCORE } from '../../src/renderer/src/components/SettingsModal/passwordStrength';

// LOW finding (code review): the old heuristic only counted length and
// character classes, so a well-known weak password like "Password1!" would
// score as "strong" simply by having upper/lowercase, a digit and a symbol.
// zxcvbn-ts actually checks against common passwords/dictionary words.
describe('estimatePasswordStrength (M-low: zxcvbn)', () => {
  it('scores an empty password as 0/very weak without loading zxcvbn', async () => {
    const result = await estimatePasswordStrength('');
    expect(result.score).toBe(0);
    expect(result.label).toBe('Very weak');
  });

  it('scores well-known weak passwords below the minimum acceptable score', async () => {
    for (const weak of ['password', 'Password1!', '12345678', 'qwertyuiop']) {
      const result = await estimatePasswordStrength(weak);
      expect(result.score, `expected "${weak}" to score below ${MIN_ACCEPTABLE_SCORE}`).toBeLessThan(
        MIN_ACCEPTABLE_SCORE
      );
    }
  });

  it('scores a long, unpredictable passphrase at or above the minimum acceptable score', async () => {
    const result = await estimatePasswordStrength('correct-horse-battery-staple-9182-zephyr');
    expect(result.score).toBeGreaterThanOrEqual(MIN_ACCEPTABLE_SCORE);
  });

  it('caches the loaded zxcvbn factory across calls (second call is much faster)', async () => {
    await estimatePasswordStrength('warm-up-call'); // Ensure the dynamic import has already resolved once.

    const start = Date.now();
    await estimatePasswordStrength('another-password-to-check');
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(500);
  });
});
