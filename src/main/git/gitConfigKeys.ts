/**
 * Allowlist of repository config keys that cannot make git run a program, read a file we did not choose or change which
 * repository is used. A repository whose own config holds any other key is not run through git at all (see
 * `inspectGitConfigNames`), so a key we have not thought about, or one a future git adds, fails safe instead of running.
 *
 * Keyed by section; the value is the variables that are fine in that section. The subsection (remote name, branch name,
 * submodule name) is free text and is not checked. Section and variable names are case-insensitive in git, so they are
 * compared lower-cased.
 */
const PLAIN_VARIABLES: Record<string, ReadonlySet<string>> = {
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
    // `git sparse-checkout init` writes these into .git/config.worktree.
    'sparsecheckout',
    'sparsecheckoutcone',
  ]),
  // Only the object format, the ref storage and the per-worktree config switch (the latter makes us read
  // `config.worktree` as well).
  extensions: new Set(['worktreeconfig', 'objectformat', 'refstorage']),
  user: new Set(['name', 'email']),
  pull: new Set(['rebase', 'ff']),
  fetch: new Set(['prune']),
  push: new Set(['default']),
  // `git submodule init` / `clone --recurse-submodules` write `submodule.active`; `submodule.recurse` is a user setting.
  submodule: new Set(['active', 'recurse']),
};

/** Keys with a subsection (`section.<name>.variable`): remote, branch and submodule names are free text. */
const SUBSECTION_VARIABLES: Record<string, ReadonlySet<string>> = {
  // promisor / partialclonefilter: `git clone --filter=blob:none`. status does not fetch missing objects, and a pull
  // contacts the remote anyway.
  remote: new Set(['url', 'fetch', 'pushurl', 'tagopt', 'promisor', 'partialclonefilter']),
  branch: new Set(['remote', 'merge', 'rebase', 'description']),
  // `submodule.<n>.update` (can be `!command`) deliberately is not here.
  submodule: new Set(['url', 'active']),
};

// Deliberately absent: every `filter.*` key, Git LFS's included. Its filter commands cannot be run (the name is
// repository-controlled) and cannot be blanked either (a blanked smudge filter makes a checkout write LFS pointer files
// over the real content), so a repository that uses them is not run through git.
//
// This only vets the repository's own config. A submodule has a config of its own, which git reads when it runs
// `git status` inside it: callers must not let git do that (`--ignore-submodules=all`, see GitStatusService).

/** True when `key` (`section[.subsection].variable`, as `git config --name-only` prints it) is on the allowlist. */
export function isKnownHarmlessConfigKey(key: string): boolean {
  const first = key.indexOf('.');
  const last = key.lastIndexOf('.');
  if (first < 1 || last === key.length - 1) return false;
  const section = key.slice(0, first).toLowerCase();
  const variable = key.slice(last + 1).toLowerCase();
  const table = last > first ? SUBSECTION_VARIABLES : PLAIN_VARIABLES;

  // Own properties only: a key such as `constructor.x` must not find Object.prototype's members.
  const allowed = Object.hasOwn(table, section) ? table[section] : undefined;
  return allowed?.has(variable) === true;
}
