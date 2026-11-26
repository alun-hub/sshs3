/**
 * Allowlist of repository config keys that cannot make git run a program, read a file we did not choose or change which
 * repository is used. A repository whose own config holds any other key is not run through git at all (see
 * `inspectGitConfigNames`), so a key we have not thought about, or one a future git adds, fails safe instead of running.
 *
 * Keyed by section; the value is the variables that are fine in that section. The subsection (remote name, branch name,
 * submodule name) is free text and is not checked, except for `filter` (see below). Section and variable names are
 * case-insensitive in git, so they are compared lower-cased.
 */
const HARMLESS_VARIABLES: Record<string, ReadonlySet<string>> = {
  core: new Set([
    'repositoryformatversion',
    'filemode',
    'bare',
    'logallrefupdates',
    'ignorecase',
    'precomposeunicode',
    'symlinks',
    'autocrlf',
    'eol',
    'safecrlf',
    'longpaths',
  ]),
  // Only the object format and the per-worktree config switch (the latter makes us read `config.worktree` as well).
  extensions: new Set(['worktreeconfig', 'objectformat']),
  remote: new Set(['url', 'fetch', 'pushurl', 'tagopt']),
  branch: new Set(['remote', 'merge', 'rebase', 'description']),
  user: new Set(['name', 'email']),
  pull: new Set(['rebase', 'ff']),
  fetch: new Set(['prune']),
  push: new Set(['default']),
  // An initialised submodule has these; `submodule.<n>.update` (can be `!command`) deliberately is not here.
  submodule: new Set(['url', 'active', 'recurse']),
  // Git LFS records its repository format and server URL here.
  lfs: new Set(['repositoryformatversion', 'url']),
};

/** Git LFS installs its filter as `filter.lfs.*`. Its commands are blanked by `inspectGitConfigNames`, not run. */
const LFS_FILTER_VARIABLES: ReadonlySet<string> = new Set(['clean', 'smudge', 'process', 'required']);

/** True when `key` (`section[.subsection].variable`, as `git config --name-only` prints it) is on the allowlist. */
export function isKnownHarmlessConfigKey(key: string): boolean {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first < 1 || last === key.length - 1) return false;
  const section = key.slice(0, first).toLowerCase();
  const variable = key.slice(last + 1).toLowerCase();
  const subsection = last > first ? key.slice(first + 1, last) : undefined;

  if (section === 'filter') return subsection === 'lfs' && LFS_FILTER_VARIABLES.has(variable);
  // lfs.* has no subsection; lfs.customtransfer.<n>.path would run a program.
  if (section === 'lfs' && subsection !== undefined) return false;
  const allowed = HARMLESS_VARIABLES[section];
  if (!allowed) return false;
  // Sections without subsections must not be given one (core.x.filemode is not core.filemode).
  const takesSubsection = section === 'remote' || section === 'branch' || section === 'submodule';
  if (takesSubsection !== (subsection !== undefined)) return false;
  return allowed.has(variable);
}
