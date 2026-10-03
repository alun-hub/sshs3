import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

const runSshCommand = vi.hoisted(() => vi.fn());
vi.mock('../../src/main/ssh/KeyInstallService', () => ({ runSshCommand }));

import { isValidGitCloneUrl, RemoteGitService } from '../../src/main/git/RemoteGitService';

describe('RemoteGitService', () => {
  beforeEach(() => {
    runSshCommand.mockReset();
    runSshCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  });

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

    it('rejects URLs that start with a dash (option injection)', () => {
      expect(isValidGitCloneUrl('--upload-pack=touch pwned')).toBe(false);
      expect(isValidGitCloneUrl('-ucmd@host:path')).toBe(false);
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

  describe('clone hardening', () => {
    const sftpConfig = { host: 'h', port: 22, username: 'u' } as unknown as SSHConnectionConfig;
    const base = { url: 'https://github.com/example/repo.git', providerId: 'sftp-1', sftpConfig };

    it('rejects directoryName starting with a dash', async () => {
      const res = await RemoteGitService.clone({
        ...base,
        targetDirectory: '/tmp',
        directoryName: '--upload-pack=calc',
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid directory name');
      expect(runSshCommand).not.toHaveBeenCalled();
    });

    it('rejects non-integer depth', async () => {
      const res = await RemoteGitService.clone({ ...base, targetDirectory: '/tmp', depth: 1.5 });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid clone depth');
    });

    it('single-quotes the target directory so shell metacharacters are inert', async () => {
      await RemoteGitService.clone({ ...base, targetDirectory: '/srv/x$(touch /tmp/p);id' });
      const cmd = runSshCommand.mock.calls[0][1] as string;
      expect(cmd.startsWith("cd -- '/srv/x$(touch /tmp/p);id' && git ")).toBe(true);
      expect(cmd).toContain("'--' 'https://github.com/example/repo.git'");
    });

    it('escapes embedded single quotes in the target directory', async () => {
      await RemoteGitService.clone({ ...base, targetDirectory: "/srv/it's" });
      const cmd = runSshCommand.mock.calls[0][1] as string;
      expect(cmd.startsWith("cd -- '/srv/it'\\''s' && ")).toBe(true);
    });

    it('rejects target directories containing newlines', async () => {
      const res = await RemoteGitService.clone({ ...base, targetDirectory: '/srv/a\nb' });
      expect(res.success).toBe(false);
      expect(runSshCommand).not.toHaveBeenCalled();
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
