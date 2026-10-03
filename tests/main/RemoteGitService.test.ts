import { describe, it, expect } from 'vitest';
import { isValidGitCloneUrl, RemoteGitService } from '../../src/main/git/RemoteGitService';

describe('RemoteGitService', () => {
  describe('isValidGitCloneUrl', () => {
    it('accepts HTTPS and HTTP URLs', () => {
      expect(isValidGitCloneUrl('https://github.com/torvalds/linux.git')).toBe(true);
      expect(isValidGitCloneUrl('https://gitlab.com/group/repo')).toBe(true);
      expect(isValidGitCloneUrl('http://git.internal.net/team/project.git')).toBe(true);
    });

    it('accepts ssh:// and git:// URLs', () => {
      expect(isValidGitCloneUrl('ssh://git@github.com:22/user/repo.git')).toBe(true);
      expect(isValidGitCloneUrl('git://git.kernel.org/pub/scm/linux.git')).toBe(true);
    });

    it('accepts scp-style SSH URLs', () => {
      expect(isValidGitCloneUrl('git@github.com:octocat/Hello-World.git')).toBe(true);
      expect(isValidGitCloneUrl('git@gitlab.com:org/subgroup/project.git')).toBe(true);
    });

    it('rejects URLs with dangerous shell characters', () => {
      expect(isValidGitCloneUrl('https://github.com/user/repo; rm -rf /')).toBe(false);
      expect(isValidGitCloneUrl('git@github.com:user/`whoami`')).toBe(false);
      expect(isValidGitCloneUrl('https://github.com/user/repo$(id)')).toBe(false);
      expect(isValidGitCloneUrl('https://github.com/user/repo && echo pwned')).toBe(false);
      expect(isValidGitCloneUrl('git@github.com:user/repo|cat')).toBe(false);
    });

    it('rejects empty or excessively long URLs', () => {
      expect(isValidGitCloneUrl('')).toBe(false);
      expect(isValidGitCloneUrl('   ')).toBe(false);
      expect(isValidGitCloneUrl('https://github.com/' + 'a'.repeat(2500))).toBe(false);
    });
  });

  describe('clone validation', () => {
    it('fails when URL is invalid', async () => {
      const res = await RemoteGitService.clone({
        url: 'bad-url',
        targetDirectory: '/tmp',
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid Git repository URL');
    });

    it('fails when targetDirectory is missing', async () => {
      const res = await RemoteGitService.clone({
        url: 'https://github.com/example/repo.git',
        targetDirectory: '',
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Target directory is required');
    });

    it('fails when directoryName contains invalid characters', async () => {
      const res = await RemoteGitService.clone({
        url: 'https://github.com/example/repo.git',
        targetDirectory: '/tmp',
        directoryName: 'sub/dir;rm',
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid directory name');
    });
  });

  describe('pull validation', () => {
    it('fails when directoryPath is missing', async () => {
      const res = await RemoteGitService.pull('');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Directory path is required');
    });
  });
});
