import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseHeadBranch,
  parseOriginUrl,
  toWebRepoUrl,
  GitStatusService,
} from '../../src/main/git/GitStatusService';

describe('GitStatusService', () => {
  describe('parseHeadBranch', () => {
    it('parses standard branch reference', () => {
      expect(parseHeadBranch('ref: refs/heads/main\n')).toBe('main');
      expect(parseHeadBranch('ref: refs/heads/feature/awesome-git')).toBe('feature/awesome-git');
    });

    it('parses detached HEAD commit hash to 7-character short SHA', () => {
      expect(parseHeadBranch('0123456789abcdef0123456789abcdef01234567\n')).toBe('0123456');
    });

    it('returns undefined for invalid or empty HEAD content', () => {
      expect(parseHeadBranch('')).toBeUndefined();
      expect(parseHeadBranch('unknown format')).toBeUndefined();
    });
  });

  describe('parseOriginUrl', () => {
    it('extracts remote origin url from git config content', () => {
      const gitConfig = `
[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = false
[remote "origin"]
\turl = git@github.com:octocat/Hello-World.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
\tmerge = refs/heads/main
`;
      expect(parseOriginUrl(gitConfig)).toBe('git@github.com:octocat/Hello-World.git');
    });

    it('handles HTTPS remote origin URLs', () => {
      const gitConfig = `
[remote "origin"]
    url = https://gitlab.com/group/project.git
`;
      expect(parseOriginUrl(gitConfig)).toBe('https://gitlab.com/group/project.git');
    });

    it('returns undefined when no remote origin is defined', () => {
      const gitConfig = `
[core]
\tbare = false
`;
      expect(parseOriginUrl(gitConfig)).toBeUndefined();
    });
  });

  describe('toWebRepoUrl', () => {
    it('converts SSH git@ URLs to browser URLs', () => {
      expect(toWebRepoUrl('git@github.com:octocat/Hello-World.git')).toBe('https://github.com/octocat/Hello-World');
      expect(toWebRepoUrl('git@gitlab.com:org/subgroup/project.git')).toBe('https://gitlab.com/org/subgroup/project');
    });

    it('strips .git suffix from HTTPS URLs', () => {
      expect(toWebRepoUrl('https://github.com/octocat/Hello-World.git')).toBe('https://github.com/octocat/Hello-World');
      expect(toWebRepoUrl('https://gitlab.example.org/alice/repo')).toBe('https://gitlab.example.org/alice/repo');
    });

    it('returns undefined for unrecognized formats', () => {
      expect(toWebRepoUrl('invalid-url')).toBeUndefined();
    });
  });

  describe('GitStatusService.getStatus', () => {
    it('returns isRepo: false for non-repo directory', async () => {
      const res = await GitStatusService.getStatus('/tmp/does-not-exist-dir-xyz-123');
      expect(res.isRepo).toBe(false);
    });

    it('returns isRepo: true and discovers branch for the current repo', async () => {
      const res = await GitStatusService.getStatus(process.cwd());
      expect(res.isRepo).toBe(true);
      expect(res.branch).toBeDefined();
      expect(res.rootPath).toBe(process.cwd());
    });

    it('does not execute core.fsmonitor from an untrusted repository config', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-fsmon-'));
      try {
        execFileSync('git', ['init', '-q', dir]);
        const marker = path.join(dir, 'pwned');
        fs.appendFileSync(
          path.join(dir, '.git', 'config'),
          `[core]\n\tfsmonitor = touch ${marker.replace(/\\/g, '/')}\n`
        );
        const res = await GitStatusService.getStatus(dir);
        expect(res.isRepo).toBe(true);
        expect(fs.existsSync(marker)).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('ignores a .git file whose gitdir points outside worktrees/modules', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-gitfile-'));
      try {
        fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /tmp/evil-gitdir\n');
        const res = await GitStatusService.getStatus(dir);
        expect(res.rootPath).not.toBe(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
