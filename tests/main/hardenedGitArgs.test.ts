import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isKnownHarmlessConfigKey } from '../../src/main/git/gitConfigKeys';
import { describeConfigKey, inspectGitConfigNames, safeGitEnv, safeGitPullEnv } from '../../src/main/git/gitSafety';
import { hardenedGitConfigArgs } from '../../src/main/git/hardenedGitArgs';
import { GitStatusService } from '../../src/main/git/GitStatusService';
import { RemoteGitService } from '../../src/main/git/RemoteGitService';

// "No global git config". An empty file, not os.devNull: that is `\\.\nul` on Windows, which git for Windows cannot
// open as a config file ("fatal: unable to access '\\.\nul'").
const emptyConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-empty-gitconfig-'));
const emptyGitConfig = path.join(emptyConfigDir, 'gitconfig');
fs.writeFileSync(emptyGitConfig, '');
afterAll(() => fs.rmSync(emptyConfigDir, { recursive: true, force: true }));

const env = () => ({ ...safeGitEnv(), GIT_CONFIG_GLOBAL: emptyGitConfig });

// A path written as text into a git config file: a Windows `C:\Users\...` would read as invalid escape sequences
// ("bad config line"), and git for Windows accepts forward slashes.
const inConfig = (p: string): string => p.replace(/\\/g, '/');

describe('inspectGitConfigNames', () => {
  it('trusts the config git itself writes, for a clone, a sparse checkout and a reftable repository', () => {
    const names = [
      'core.repositoryformatversion',
      'core.filemode',
      'core.bare',
      'core.logallrefupdates',
      'core.ignorecase',
      'core.precomposeunicode',
      'core.symlinks',
      'core.autocrlf',
      'core.sparsecheckout',
      'core.sparsecheckoutcone',
      'extensions.worktreeconfig',
      'extensions.refstorage',
      'remote.origin.url',
      'remote.origin.fetch',
      // `git clone --filter=blob:none`
      'remote.origin.promisor',
      'remote.origin.partialclonefilter',
      'branch.main.remote',
      'branch.main.merge',
      'user.name',
      'user.email',
      // what `git clone --recurse-submodules` / `git submodule init` write
      'submodule.active',
      'submodule.sub.url',
      'submodule.sub.active',
      'submodule.recurse',
    ];
    expect(inspectGitConfigNames(names)).toEqual({ trusted: true });
  });

  it('refuses every key that makes git run a program, whether or not we know it', () => {
    for (const key of [
      'filter.x.clean',
      'filter.x.smudge',
      'filter.x.process',
      'filter.x.required',
      'filter.lfs.clean',
      'filter.lfs.smudge',
      'filter.lfs.process',
      'filter.lfs.required',
      'filter.a=b.clean',
      'lfs.repositoryformatversion',
      'lfs.customtransfer.x.path',
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
      'gpg.ssh.program',
      'gpg.ssh.defaultkeycommand',
      'pager.status',
      'trailer.x.command',
      'submodule.x.update',
      'core.worktree',
      'alias.st',
      'http.sslcommand',
      'include.path',
      'includeif.gitdir:/x/.path',
    ]) {
      expect(inspectGitConfigNames(['core.bare', key]).trusted, key).toBe(false);
    }
  });

  it('does not let a section take a subsection it does not have, or the reverse', () => {
    expect(inspectGitConfigNames(['core.x.filemode']).trusted).toBe(false);
    expect(inspectGitConfigNames(['remote.url']).trusted).toBe(false);
    expect(inspectGitConfigNames(['nodots']).trusted).toBe(false);
    expect(inspectGitConfigNames(['remote.origin.']).trusted).toBe(false);
    expect(inspectGitConfigNames(['submodule.url']).trusted).toBe(false);
    expect(inspectGitConfigNames(['submodule.sub.recurse']).trusted).toBe(false);
    expect(inspectGitConfigNames(['user.someone.name']).trusted).toBe(false);
    // "=" in a harmless key is fine
    expect(inspectGitConfigNames(['branch.a=b.remote']).trusted).toBe(true);
  });

  it('refuses, and does not throw for, section names that are members of Object.prototype', () => {
    for (const key of ['constructor.foo', '__proto__.x', 'tostring.y', 'hasownproperty.z', 'valueof.a']) {
      expect(() => isKnownHarmlessConfigKey(key), key).not.toThrow();
      expect(inspectGitConfigNames([key]).trusted, key).toBe(false);
    }
  });

  it('names the first rejected key as section.variable, without the subsection', () => {
    expect(inspectGitConfigNames(['core.bare', 'core.sshCommand'])).toEqual({ trusted: false, rejectedKey: 'core.sshcommand' });
    // the subsection can be a URL that holds credentials: it must not be repeated
    // fake credentials in a made-up URL, only here to prove they are not echoed
    expect(inspectGitConfigNames(['credential.https://user:secret@h.example.helper'])).toEqual({ // pragma: allowlist secret
      trusted: false,
      rejectedKey: 'credential.helper',
    });
    // a malformed name has no section.variable to show
    expect(describeConfigKey('nodots')).toBeUndefined();
    expect(inspectGitConfigNames(['nodots'])).toEqual({ trusted: false });
  });
});

describe('safeGitPullEnv', () => {
  it('keeps an interactive rebase from opening an editor', () => {
    expect(safeGitPullEnv()).toMatchObject({ GIT_SEQUENCE_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' });
  });
});

const supportsReftable = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-reftable-probe-'));
  try {
    return spawnSync('git', ['init', '-q', '--ref-format=reftable', probe]).status === 0;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

describe('a repository whose .git/config runs programs', () => {
  let dir: string;
  let marker: string;

  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: env() });
  const touchOld = (file = 'f.txt') => fs.utimesSync(path.join(dir, file), new Date('2020-01-01'), new Date('2020-01-01'));

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
    touchOld();
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
    const config = await hardenedGitConfigArgs(dir);
    expect(config.ok).toBe(false);
    const status = await GitStatusService.getStatus(dir);
    const pull = await RemoteGitService.pull(dir);
    expect(fs.existsSync(marker)).toBe(false);
    expect(pull.success).toBe(false);
    // the error says which setting stopped it, so the user can act on it
    expect(pull.error).toMatch(
      /Refusing to pull: the repository configuration could not be verified as safe \(the setting (filter\.clean|core\.sshcommand) is not on the list/
    );
    // A repository nobody looked at must not be reported as clean: the counts stay unset, the branch is still shown.
    expect(status).toMatchObject({ isRepo: true, branch: expect.any(String) });
    expect(status.isClean).toBeUndefined();
    expect(status.ahead).toBeUndefined();
    expect(status.behind).toBeUndefined();
    expect(status.modifiedCount).toBeUndefined();
    expect(status.untrackedCount).toBeUndefined();
  });

  it('refuses a Git LFS repository instead of blanking its filter (a blanked smudge writes pointer files)', async () => {
    git('config', '--remove-section', 'filter.x');
    git('config', '--unset', 'core.sshCommand');
    for (const [k, v] of [
      ['clean', 'git-lfs clean -- %f'],
      ['smudge', 'git-lfs smudge -- %f'],
      ['process', 'git-lfs filter-process'],
      ['required', 'true'],
    ]) {
      git('config', `filter.lfs.${k}`, v);
    }
    const config = await hardenedGitConfigArgs(dir);
    expect(config).toEqual({ ok: false, reason: expect.stringContaining('filter.') });
  });

  it('also covers .git/config.worktree (extensions.worktreeConfig)', async () => {
    // A clean-looking .git/config plus a malicious .git/config.worktree: --local alone would not see the filter.
    git('config', '--unset', 'filter.x.clean');
    git('config', '--unset', 'core.sshCommand');
    git('config', 'core.repositoryformatversion', '1');
    git('config', 'extensions.worktreeConfig', 'true');
    fs.writeFileSync(path.join(dir, '.git', 'config.worktree'), `[filter "x"]\n\tclean = touch '${inConfig(marker)}'; cat\n`);

    // Plain git runs it...
    git('status', '--porcelain');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker, { force: true });
    touchOld();

    // ...we refuse, and run nothing.
    expect((await hardenedGitConfigArgs(dir)).ok).toBe(false);
    await GitStatusService.getStatus(dir);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses a filter whose name contains "=" (which "-c key=" could not have blanked)', async () => {
    git('config', '--unset', 'filter.x.clean');
    git('config', '--unset', 'core.sshCommand');
    fs.writeFileSync(path.join(dir, '.gitattributes'), 'f.txt filter=a=b\n');
    fs.appendFileSync(path.join(dir, '.git', 'config'), `[filter "a=b"]\n\tclean = touch '${inConfig(marker)}'; cat\n`);
    touchOld();

    git('status', '--porcelain');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker, { force: true });
    touchOld();

    expect((await hardenedGitConfigArgs(dir)).ok).toBe(false);
    await GitStatusService.getStatus(dir);
    expect((await RemoteGitService.pull(dir)).success).toBe(false);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('refuses a repository whose config includes another file', async () => {
    git('config', '--unset', 'filter.x.clean');
    git('config', '--unset', 'core.sshCommand');
    git('config', 'include.path', '/etc/hostname');
    expect((await hardenedGitConfigArgs(dir)).ok).toBe(false);
    expect((await RemoteGitService.pull(dir)).success).toBe(false);
  });

  it('refuses a directory that is not a repository (git config --list succeeds there with nothing in it)', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-not-a-repo-'));
    try {
      expect(await hardenedGitConfigArgs(plain)).toEqual({ ok: false, reason: 'the repository configuration could not be read' });
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  describe('repositories made by git itself', () => {
    beforeEach(() => {
      git('config', '--unset', 'filter.x.clean');
      git('config', '--unset', 'core.sshCommand');
      fs.writeFileSync(path.join(dir, '.gitattributes'), '');
    });

    it('still trusts an ordinary clone', async () => {
      const clone = `${dir}-clone`;
      try {
        execFileSync('git', ['clone', '-q', dir, clone], { env: { ...env(), GIT_ALLOW_PROTOCOL: 'file' } });
        expect((await hardenedGitConfigArgs(clone)).ok).toBe(true);
        const status = await GitStatusService.getStatus(clone);
        expect(status).toMatchObject({ isRepo: true, isClean: true, ahead: 0, behind: 0, modifiedCount: 0, untrackedCount: 0 });
      } finally {
        fs.rmSync(clone, { recursive: true, force: true });
      }
    });

    it('trusts a partial (blobless) clone', async () => {
      const clone = `${dir}-blobless`;
      try {
        // the upstream has to allow filters; a file:// URL is needed, a plain path ignores --filter
        git('config', 'uploadpack.allowFilter', 'true');
        git('config', 'uploadpack.allowAnySHA1InWant', 'true');
        execFileSync('git', ['-c', 'protocol.file.allow=always', 'clone', '-q', '--filter=blob:none', `file://${dir}`, clone], {
          env: { ...env(), GIT_ALLOW_PROTOCOL: 'file' },
        });
        const names = execFileSync('git', ['config', '--local', '--list', '--name-only'], { cwd: clone, env: env() }).toString();
        expect(names).toContain('remote.origin.promisor');
        const config = await hardenedGitConfigArgs(clone);
        expect(config.ok).toBe(true);
        expect((await GitStatusService.getStatus(clone)).isClean).toBe(true);
      } finally {
        fs.rmSync(clone, { recursive: true, force: true });
      }
    });

    it('trusts extensions.worktreeConfig when there is no config.worktree file', async () => {
      git('config', 'core.repositoryformatversion', '1');
      git('config', 'extensions.worktreeConfig', 'true');
      expect(fs.existsSync(path.join(dir, '.git', 'config.worktree'))).toBe(false);
      expect((await hardenedGitConfigArgs(dir)).ok).toBe(true);
    });

    it('trusts a sparse checkout (its settings live in config.worktree)', async () => {
      git('sparse-checkout', 'init', '--cone');
      expect(fs.existsSync(path.join(dir, '.git', 'config.worktree'))).toBe(true);
      expect((await hardenedGitConfigArgs(dir)).ok).toBe(true);
      expect((await GitStatusService.getStatus(dir)).isRepo).toBe(true);
    });

    it.skipIf(!supportsReftable)('trusts a reftable repository', async () => {
      const rt = `${dir}-reftable`;
      try {
        execFileSync('git', ['init', '-q', '--ref-format=reftable', rt], { env: env() });
        expect((await hardenedGitConfigArgs(rt)).ok).toBe(true);
      } finally {
        fs.rmSync(rt, { recursive: true, force: true });
      }
    });

    it('trusts a linked worktree', async () => {
      const wt = `${dir}-wt`;
      try {
        git('-c', 'user.email=a@b', '-c', 'user.name=n', 'commit', '-q', '--allow-empty', '-m', 'x');
        git('worktree', 'add', '-q', wt);
        expect((await hardenedGitConfigArgs(wt)).ok).toBe(true);
        expect((await GitStatusService.getStatus(wt)).isRepo).toBe(true);
      } finally {
        fs.rmSync(wt, { recursive: true, force: true });
      }
    });

    it('turns off submodule recursion', async () => {
      const config = await hardenedGitConfigArgs(dir);
      expect(config).toMatchObject({ ok: true });
      expect(config.ok && config.args).toEqual(expect.arrayContaining(['submodule.recurse=false', 'fetch.recurseSubmodules=false']));
    });
  });
});

describe('a repository with a submodule whose own config runs programs', () => {
  const allowFile = { ...env(), GIT_ALLOW_PROTOCOL: 'file' };
  const run = (cwd: string, envs: NodeJS.ProcessEnv, ...args: string[]) => execFileSync('git', args, { cwd, env: envs, stdio: 'pipe' }).toString();
  let sub: string;
  let up: string;
  let dir: string;
  let marker: string;

  beforeEach(() => {
    sub = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-sub-'));
    run(sub, allowFile, 'init', '-q', '-b', 'master', '.');
    run(sub, allowFile, 'config', 'user.email', 'a@b');
    run(sub, allowFile, 'config', 'user.name', 'n');
    fs.writeFileSync(path.join(sub, 'a.txt'), 'hi\n');
    fs.writeFileSync(path.join(sub, '.gitattributes'), 'a.txt filter=x\n');
    run(sub, allowFile, 'add', '-A');
    run(sub, allowFile, 'commit', '-qm', 's');

    up = fs.mkdtempSync(path.join(os.tmpdir(), 'sshs3-up-'));
    run(up, allowFile, 'init', '-q', '-b', 'master', '.');
    run(up, allowFile, 'config', 'user.email', 'a@b');
    run(up, allowFile, 'config', 'user.name', 'n');
    run(up, allowFile, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sub');
    run(up, allowFile, 'commit', '-qm', 'add sub');

    // The victim's copy: made by `git clone --recurse-submodules`, so its top-level config is what git writes.
    dir = `${up}-clone`;
    marker = `${dir}.pwned`;
    execFileSync('git', ['-c', 'protocol.file.allow=always', 'clone', '-q', '--recurse-submodules', up, dir], { env: allowFile });
    // The attack: the submodule's own config (inside .git/modules) holds a clean filter, and a file in it looks changed.
    fs.appendFileSync(path.join(dir, '.git', 'modules', 'sub', 'config'), `[filter "x"]\n\tclean = touch '${inConfig(marker)}'; cat\n`);
    fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), 'ho\n');
    fs.utimesSync(path.join(dir, 'sub', 'a.txt'), new Date('2020-01-01'), new Date('2020-01-01'));
  });

  afterEach(() => {
    for (const d of [sub, up, dir]) fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(marker, { force: true });
  });

  it('is the case we defend against: git status in the superproject runs the submodule filter', () => {
    run(dir, allowFile, 'status', '--porcelain');
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('trusts the top-level config of a recursive clone, and GitStatusService does not run the submodule filter', async () => {
    const config = await hardenedGitConfigArgs(dir);
    expect(config).toMatchObject({ ok: true, hasSubmodules: true });
    const status = await GitStatusService.getStatus(dir);
    expect(status.isRepo).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('does not call a repository with submodules clean when only its submodule changed (status did not look inside it)', async () => {
    const status = await GitStatusService.getStatus(dir);
    // the submodule has a modified file, but --ignore-submodules=all hides it: unknown, not "clean"
    expect(status.isClean).toBeUndefined();
    expect(status.modifiedCount).toBe(0);
  });

  it('still reports changes outside the submodules', async () => {
    fs.writeFileSync(path.join(dir, 'new.txt'), 'x\n');
    const status = await GitStatusService.getStatus(dir);
    expect(status).toMatchObject({ isClean: false, untrackedCount: 1 });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('git pull with the hardened arguments does not run it either', async () => {
    fs.writeFileSync(path.join(up, 'top.txt'), 'new\n');
    run(up, allowFile, 'add', '-A');
    run(up, allowFile, 'commit', '-qm', 'top');
    const config = await hardenedGitConfigArgs(dir);
    if (!config.ok) throw new Error(config.reason);
    // RemoteGitService.pull passes exactly these arguments and this environment, except for the protocol list: the
    // upstream here is a local path, which needs "file".
    execFileSync('git', [...config.args, '-c', 'protocol.file.allow=always', 'pull'], {
      cwd: dir,
      env: { ...safeGitPullEnv(), GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_ALLOW_PROTOCOL: 'file' },
      stdio: 'pipe',
    });
    expect(fs.existsSync(path.join(dir, 'top.txt'))).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
