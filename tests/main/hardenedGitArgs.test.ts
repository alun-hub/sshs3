import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectGitConfigNames, safeGitEnv } from '../../src/main/git/gitSafety';
import { hardenedGitConfigArgs } from '../../src/main/git/hardenedGitArgs';
import { GitStatusService } from '../../src/main/git/GitStatusService';
import { RemoteGitService } from '../../src/main/git/RemoteGitService';

describe('inspectGitConfigNames', () => {
  it('trusts the config git itself writes for a clone', () => {
    const names = [
      'core.repositoryformatversion',
      'core.filemode',
      'core.bare',
      'core.logallrefupdates',
      'core.ignorecase',
      'core.precomposeunicode',
      'core.symlinks',
      'core.autocrlf',
      'remote.origin.url',
      'remote.origin.fetch',
      'branch.main.remote',
      'branch.main.merge',
      'user.name',
      'user.email',
      'extensions.worktreeconfig',
      'submodule.libs/x.url',
      'submodule.libs/x.active',
    ];
    expect(inspectGitConfigNames(names)).toEqual({ trusted: true, overrides: [] });
  });

  it('refuses every key that makes git run a program, whether or not we know it', () => {
    for (const key of [
      'filter.x.clean',
      'filter.x.smudge',
      'filter.x.process',
      'filter.lfs.driver',
      'core.sshcommand',
      'core.gitproxy',
      'core.askpass',
      'core.fsmonitor',
      'core.hookspath',
      'core.pager',
      'core.alternaterefscommand',
      'diff.external',
      'diff.foo.textconv',
      'merge.bar.driver',
      'credential.helper',
      'credential.https://h.example.helper',
      'remote.origin.uploadpack',
      'remote.origin.vcs',
      'remote.origin.promisor',
      'gpg.ssh.program',
      'gpg.ssh.defaultkeycommand',
      'pager.status',
      'trailer.x.command',
      'submodule.x.update',
      'core.worktree',
      'alias.st',
      'http.sslcommand',
    ]) {
      expect(inspectGitConfigNames(['core.bare', key]), key).toEqual({ trusted: false, overrides: [] });
    }
  });

  it('does not let a section take a subsection it does not have', () => {
    expect(inspectGitConfigNames(['core.x.filemode']).trusted).toBe(false);
    expect(inspectGitConfigNames(['remote.url']).trusted).toBe(false);
    expect(inspectGitConfigNames(['nodots']).trusted).toBe(false);
    expect(inspectGitConfigNames(['remote.origin.']).trusted).toBe(false);
  });

  it('lets Git LFS through but blanks its commands instead of running them', () => {
    const lfs = ['filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.process', 'filter.lfs.required', 'lfs.repositoryformatversion', 'lfs.url'];
    const { trusted, overrides } = inspectGitConfigNames(['core.bare', ...lfs]);
    expect(trusted).toBe(true);
    expect(overrides).toEqual(
      ['filter.lfs.clean', 'filter.lfs.smudge', 'filter.lfs.process'].flatMap((k) => ['-c', `${k}=`])
    );
    // a custom LFS transfer agent runs a program
    expect(inspectGitConfigNames(['lfs.customtransfer.x.path']).trusted).toBe(false);
  });

  it('does not trust a config that includes other files', () => {
    expect(inspectGitConfigNames(['include.path']).trusted).toBe(false);
    expect(inspectGitConfigNames(['includeif.gitdir:/x/.path']).trusted).toBe(false);
  });

  it('does not trust a program-running key that -c cannot address (name contains "=")', () => {
    expect(inspectGitConfigNames(['filter.a=b.clean']).trusted).toBe(false);
    expect(inspectGitConfigNames(['credential.https://h/?x=y.helper']).trusted).toBe(false);
    // "=" in a harmless key is fine
    expect(inspectGitConfigNames(['branch.a=b.remote']).trusted).toBe(true);
  });
});

describe('a repository whose .git/config runs programs', () => {
  let dir: string;
  let marker: string;

  const env = () => ({ ...safeGitEnv(), GIT_CONFIG_GLOBAL: os.devNull });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: env() });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-hardened-git-'));
    marker = `${dir}.pwned`;
    git('init', '-q', '.');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'hi\n');
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'f.txt filter=x\n');
    git('add', '-A');
    git('-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-qm', 'init');
    git('config', 'filter.x.clean', `touch '${marker}'; cat`);
    git('config', 'core.sshCommand', `touch '${marker}'`);
    git('remote', 'add', 'origin', 'ssh://x@127.0.0.1/r.git');
    // Same size, old mtime: git has to hash the file, which runs the clean filter.
    fs.writeFileSync(path.join(dir, 'f.txt'), 'ho\n');
    fs.utimesSync(path.join(dir, 'f.txt'), new Date('2020-01-01'), new Date('2020-01-01'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(marker, { force: true });
  });

  it('is the case we defend against: plain git runs the filter', () => {
    git('status', '--porcelain');
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('refuses a repository with a custom filter or core.sshCommand, and runs nothing', async () => {
    expect(await hardenedGitConfigArgs(dir)).toBeUndefined();
    const status = await GitStatusService.getStatus(dir);
    expect((await RemoteGitService.pull(dir)).success).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
    // A repository nobody looked at must not be reported as clean: the counts stay unset, the branch is still shown.
    expect(status).toMatchObject({ isRepo: true, branch: expect.any(String) });
    expect(status.isClean).toBeUndefined();
    expect(status.ahead).toBeUndefined();
    expect(status.behind).toBeUndefined();
    expect(status.modifiedCount).toBeUndefined();
    expect(status.untrackedCount).toBeUndefined();
  });

  it('blanks the commands of a Git LFS filter and still runs git', async () => {
    git('config', '--remove-section', 'filter.x');
    git('config', '--unset', 'core.sshCommand');
    git('config', 'filter.lfs.clean', `touch '${marker}'; cat`);
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'f.txt filter=lfs\n');
    fs.utimesSync(path.join(dir, 'f.txt'), new Date('2020-01-01'), new Date('2020-01-01'));

    // Plain git runs it...
    git('status', '--porcelain');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker, { force: true });
    fs.utimesSync(path.join(dir, 'f.txt'), new Date('2020-01-01'), new Date('2020-01-01'));

    // ...the hardened arguments do not.
    const args = await hardenedGitConfigArgs(dir);
    expect(args).toContain('filter.lfs.clean=');
    execFileSync('git', [...args!, 'status', '--porcelain'], { cwd: dir, env: env() });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('GitStatusService does not run the filter', async () => {
    const status = await GitStatusService.getStatus(dir);
    expect(status.isRepo).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('RemoteGitService.pull does not run core.sshCommand', async () => {
    await RemoteGitService.pull(dir);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('also covers .git/config.worktree (extensions.worktreeConfig)', async () => {
    fs.rmSync(marker, { force: true });
    // A clean-looking .git/config plus a malicious .git/config.worktree: --local alone would not see the filter.
    git('config', '--unset', 'filter.x.clean');
    git('config', '--unset', 'core.sshCommand');
    git('config', 'core.repositoryformatversion', '1');
    git('config', 'extensions.worktreeConfig', 'true');
    fs.writeFileSync(path.join(dir, '.git', 'config.worktree'), `[filter "x"]\n\tclean = touch '${marker}'; cat\n`);

    // Plain git runs it...
    git('status', '--porcelain');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker, { force: true });
    fs.utimesSync(path.join(dir, 'f.txt'), new Date('2020-01-01'), new Date('2020-01-01'));

    // ...the hardened arguments and the services do not.
    // The filter itself sits in config.worktree, which is read too: filter.x.* is not allowlisted, so git is not run.
    expect(await hardenedGitConfigArgs(dir)).toBeUndefined();
    await GitStatusService.getStatus(dir);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses, and runs nothing, for a filter whose name contains "="', async () => {
    fs.rmSync(marker, { force: true });
    git('config', '--unset', 'filter.x.clean');
    git('config', '--unset', 'core.sshCommand');
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'f.txt filter=a=b\n');
    fs.appendFileSync(path.join(dir, '.git', 'config'), `[filter "a=b"]\n\tclean = touch '${marker}'; cat\n`);
    fs.utimesSync(path.join(dir, 'f.txt'), new Date('2020-01-01'), new Date('2020-01-01'));

    // Plain git runs it...
    git('status', '--porcelain');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker, { force: true });
    fs.utimesSync(path.join(dir, 'f.txt'), new Date('2020-01-01'), new Date('2020-01-01'));

    // ...and we neither run git nor run the filter.
    expect(await hardenedGitConfigArgs(dir)).toBeUndefined();
    await GitStatusService.getStatus(dir);
    expect((await RemoteGitService.pull(dir)).success).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('still trusts an ordinary clone made by git itself', async () => {
    const clone = `${dir}-clone`;
    try {
      execFileSync('git', ['clone', '-q', dir, clone], { env: { ...env(), GIT_ALLOW_PROTOCOL: 'file' } });
      expect(await hardenedGitConfigArgs(clone)).toBeDefined();
      const status = await GitStatusService.getStatus(clone);
      expect(status).toMatchObject({ isRepo: true, isClean: true, ahead: 0, behind: 0, modifiedCount: 0, untrackedCount: 0 });
    } finally {
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });

  it('turns off submodule recursion', async () => {
    git('config', '--remove-section', 'filter.x');
    git('config', '--unset', 'core.sshCommand');
    const args = await hardenedGitConfigArgs(dir);
    expect(args).toEqual(expect.arrayContaining(['submodule.recurse=false', 'fetch.recurseSubmodules=false']));
  });

  it('refuses a repository whose config includes another file', async () => {
    git('config', 'include.path', '/etc/hostname');
    expect(await hardenedGitConfigArgs(dir)).toBeUndefined();
    expect((await RemoteGitService.pull(dir)).success).toBe(false);
  });
});
