import { describe, it, expect } from 'vitest';
import { parseGitUrl } from '../../src/main/dotfiles/DotfileGitImporter';

describe('DotfileGitImporter', () => {
  describe('parseGitUrl', () => {
    it('converts owner/repo shorthand to GitHub clone URL and default pool name', () => {
      const res = parseGitUrl('alun/dotfiles');
      expect(res.cloneUrl).toBe('https://github.com/alun/dotfiles.git');
      expect(res.defaultPoolName).toBe('dotfiles-dotfiles');
    });

    it('handles full https repository URLs', () => {
      const res = parseGitUrl('https://github.com/torvalds/my-configs.git');
      expect(res.cloneUrl).toBe('https://github.com/torvalds/my-configs.git');
      expect(res.defaultPoolName).toBe('my-configs-dotfiles');
    });

    it('handles git@ SSH URLs', () => {
      const res = parseGitUrl('git@gitlab.com:alice/work-dots.git');
      expect(res.cloneUrl).toBe('git@gitlab.com:alice/work-dots.git');
      expect(res.defaultPoolName).toBe('work-dots-dotfiles');
    });

    it('throws error for invalid Git URL', () => {
      expect(() => parseGitUrl('not a git url')).toThrow(/Invalid Git repository URL/);
      expect(() => parseGitUrl('https://github.com/evil/repo; rm -rf /')).toThrow(/Invalid Git repository URL/);
    });
  });
});
