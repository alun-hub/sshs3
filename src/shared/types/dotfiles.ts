export type DotfilesSyncPolicy = 'ask' | 'always';

export interface DotfilePoolFile {
  id: string;
  /** Remote path to write, e.g. "~/.bashrc" or "~/.config/nvim/init.vim". */
  remotePath: string;
  content: string;
  /** Octal permission string, e.g. "600". Left unset = don't chmod after upload. */
  mode?: string;
  /** Name of the physical master file on disk */
  masterFileName?: string;
  /** Absolute path to the physical master file on local disk */
  masterFilePath?: string;
  /**
   * Absolute path of the local file this entry was copied from. Device-specific:
   * never synced between machines (see ProfileSyncService). Used to detect
   * "source changed" and to refresh the stored copy.
   */
  sourcePath?: string;
  /** Timestamp formatted as yyyy-mm-dd HH:mm */
  updatedAt?: string;
  /** Timestamp formatted as yyyy-mm-dd HH:mm, set instead of removing the file, so sync can propagate the deletion. */
  deletedAt?: string;
}

export interface DotfilePool {
  id: string;
  name: string;
  files: DotfilePoolFile[];
  /** Absolute path to the directory where master files for this pool are saved */
  masterDirectory?: string;
  /** Timestamp formatted as yyyy-mm-dd HH:mm */
  updatedAt?: string;
  /** Timestamp formatted as yyyy-mm-dd HH:mm, set instead of removing the pool, so sync can propagate the deletion. */
  deletedAt?: string;
}

export interface DotfileImportedFile {
  name: string;
  path: string;
  content: string;
  mode?: string;
  size: number;
  /** Suggested remotePath, e.g. "~/.kube/config" for a file under the local home directory. */
  suggestedRemotePath: string;
}

export interface DotfileDiffEntry {
  fileId: string;
  remotePath: string;
  /** Missing = file doesn't exist on the remote yet. Different = content mismatch. */
  reason: 'missing' | 'different';
}

export interface DotfilesSyncPromptEvent {
  id: string;
  sessionId: string;
  poolName: string;
  hostLabel: string;
  entries: DotfileDiffEntry[];
}

export type DotfilesSyncResolution = 'update' | 'ignore' | 'always';

export interface DotfilesSyncStatusEvent {
  sessionId: string;
  status: 'updated' | 'error';
  updatedCount?: number;
  error?: string;
}
