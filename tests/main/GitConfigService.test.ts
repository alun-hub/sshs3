import { describe, it, expect } from 'vitest';
import { normalizeGitConfigPath, GitConfigService } from '../../src/main/git/GitConfigService';

describe('GitConfigService', () => {
  describe('normalizeGitConfigPath', () => {
    it('converts Windows backslashes to forward slashes', () => {
      expect(normalizeGitConfigPath('C:\\Users\\alice\\.ssh\\allowed_signers')).toBe(
        'C:/Users/alice/.ssh/allowed_signers'
      );
    });

    it('keeps Unix forward slashes unchanged', () => {
      expect(normalizeGitConfigPath('/home/alice/.ssh/allowed_signers')).toBe(
        '/home/alice/.ssh/allowed_signers'
      );
    });
  });

  describe('configureSigning', () => {
    it('returns error when signing key is missing or empty', async () => {
      const res = await GitConfigService.configureSigning({ signingKey: '' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('signing key is required');
    });
  });

  describe('getSigningConfig', () => {
    it('returns a GitSigningConfig structure without throwing', async () => {
      const config = await GitConfigService.getSigningConfig();
      expect(config).toBeDefined();
      expect(typeof config.enabled).toBe('boolean');
    });
  });

  describe('setSigningEnabled', () => {
    it('executes without throwing unhandled error', async () => {
      const res = await GitConfigService.setSigningEnabled(false);
      expect(res).toBeDefined();
      expect(typeof res.success).toBe('boolean');
    });
  });
});
