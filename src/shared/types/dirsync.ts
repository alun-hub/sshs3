import type { FileEntry } from './storage';

export interface DirectoryDiffEntry {
  relativePath: string;
  isDirectory: boolean;
  status: 'new' | 'changed' | 'only-target';
  sourceEntry?: FileEntry;
  targetEntry?: FileEntry;
}

export interface DirectoryDiffResult {
  entries: DirectoryDiffEntry[];
  counts: { new: number; changed: number; onlyTarget: number; same: number };
  scannedAt: string;
  /** Subdirectories that could not be read (e.g. permission denied) and were skipped, per side. */
  skippedPaths: { source: string[]; target: string[] };
}

export interface DirectorySyncProfile {
  id: string;
  name: string;
  source: { providerConfigRef: string; path: string }; // ref to saved SFTP/S3 profile id, or 'local'
  target: { providerConfigRef: string; path: string };
  deleteExtraneous: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface DirectorySyncApplyResult {
  copied: number;
  deleted: number;
  failed: number;
  errors: Array<{ path: string; error: string }>;
}
