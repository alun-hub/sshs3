import type { FileEntry } from '@shared/types/storage';

/** What Ctrl/Cmd+click on a file path in a terminal does (the `terminalPathClickLocal` and `terminalPathClickRemote` settings). */
export type PathClickAction = 'os' | 'filemanager';

/** A bigger file is not downloaded just because it was clicked; the file manager shows it instead. */
export const MAX_OS_OPEN_BYTES = 50 * 1024 * 1024;

export interface PathOpenInput {
  action: PathClickAction;
  /** The path names another machine (UNC): nothing may be looked up or opened, the lookup was never made. */
  isNetworkUnc: boolean;
  /** A local shell that runs ssh prints paths of the remote host, which this machine cannot answer for. */
  localShellRunsSsh: boolean;
  /** The entry found, `'missing'` when there is none, `'unknown'` when the lookup timed out or failed. */
  entry: FileEntry | 'missing' | 'unknown';
  /** The path as printed is relative, so it was resolved against the working directory. */
  relative: boolean;
  /** The working directory is known from the shell itself, not guessed from prompt-like text. */
  cwdReliable: boolean;
}

export type PathOpenDecision =
  | { kind: 'os' }
  /** `reason` is shown to the user; without one the file manager opens quietly (it is the normal outcome). */
  | { kind: 'filemanager'; reason?: string };

const fileManager = (reason?: string): PathOpenDecision => (reason ? { kind: 'filemanager', reason } : { kind: 'filemanager' });

/** An extensionless file with an execute bit: some Linux desktops run such a file instead of opening it. */
function isExecutableWithoutExtension(entry: FileEntry): boolean {
  if (entry.name.lastIndexOf('.') > 0) return false;
  const mode = entry.permissions && /^[0-7]{3,4}$/.test(entry.permissions) ? parseInt(entry.permissions, 8) : 0;
  return (mode & 0o111) !== 0;
}

/**
 * Whether a clicked path is opened with the system app or shown in the file manager. The path comes from terminal
 * output, so anything that is not clearly one ordinary file the user meant falls back to the file manager, which
 * only navigates.
 */
export function decidePathOpen(input: PathOpenInput): PathOpenDecision {
  if (input.action !== 'os' || input.isNetworkUnc || input.localShellRunsSsh) return fileManager();
  const { entry } = input;
  if (entry === 'unknown') return fileManager('Not opened: the file could not be checked.');
  if (entry === 'missing') return fileManager('Not opened: the file does not exist.');
  if (entry.isDirectory) return fileManager();
  if (entry.isSpecial) return fileManager('Not opened: it is not a regular file.');
  // A guessed directory can point at a different file than the one the user sees; starting a program on it is
  // worse than navigating to it.
  if (input.relative && !input.cwdReliable) return fileManager('Not opened: the current directory is not known for sure.');
  if (entry.size > MAX_OS_OPEN_BYTES) return fileManager('Not opened: the file is larger than 50 MB.');
  if (isExecutableWithoutExtension(entry)) return fileManager('Not opened: the file is executable.');
  return { kind: 'os' };
}
