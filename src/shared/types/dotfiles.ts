export type DotfilesSyncPolicy = 'ask' | 'always';

export interface DotfilePoolFile {
  id: string;
  /** Remote path to write, e.g. "~/.bashrc" or "~/.config/nvim/init.vim". */
  remotePath: string;
  content: string;
  /** Octal permission string, e.g. "600". Left unset = don't chmod after upload. */
  mode?: string;
}

export interface DotfilePool {
  id: string;
  name: string;
  files: DotfilePoolFile[];
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
