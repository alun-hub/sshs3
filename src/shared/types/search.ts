export type SearchSourceType = 'sftp' | 's3' | 'local';
export type SearchMode = 'literal' | 'regex';
/**
 * 's3-select' is reserved for a possible future accelerator; Amazon S3 Select is no
 * longer available to new AWS accounts and is inconsistently supported by S3-compatible
 * providers (MinIO, NetApp), so v1 always searches S3 objects the same way as SFTP files —
 * download (or a ranged GET) plus an in-memory line scan.
 */
export type SearchMatchSource = 'sftp-grep' | 's3-select' | 's3-download' | 'local-fs';

export interface SearchStartOptions {
  providerId: string;
  sourceType: SearchSourceType;
  /** Starting directory (SFTP) or bucket/prefix (S3) to search under. */
  rootPath: string;
  query: string;
  mode: SearchMode;
  caseSensitive: boolean;
  /** Filename glob patterns a file must match at least one of, e.g. ["*.log", "*.csv"]. */
  includeGlobs?: string[];
  /** Filename glob patterns that exclude a file, e.g. ["*.min.js"]. */
  excludeGlobs?: string[];
  /** SFTP and local only (S3 has no directory concept to bound). Undefined means unlimited depth. */
  maxDepth?: number;
  /** Objects/files larger than this are skipped (default 10 MB for S3, unbounded for SFTP). */
  maxFileSizeBytes?: number;
  /** Hard cap on the number of matches returned. Default 500. */
  maxResults?: number;
}

export interface SearchMatch {
  id: string;
  path: string;
  /** Path relative to the search's rootPath, for compact display. */
  displayPath: string;
  /** SFTP grep line number, or a JSON Lines record index. Undefined for other S3 Select results. */
  lineNumber?: number;
  /** S3 Select only: identifies the matching record within its object (e.g. row index). */
  recordLocator?: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
  source: SearchMatchSource;
}

export interface SearchResultEvent {
  searchId: string;
  matches: SearchMatch[];
}

export interface SearchProgressEvent {
  searchId: string;
  scannedCount: number;
  totalEstimate?: number;
  matchCount: number;
  currentPath?: string;
}

export interface SearchErrorEvent {
  searchId: string;
  path?: string;
  message: string;
  fatal: boolean;
}

export interface SearchDoneEvent {
  searchId: string;
  matchCount: number;
  scannedCount: number;
  cancelled: boolean;
  truncated: boolean;
}

export interface SearchStartResult {
  searchId: string;
}

export interface SearchPreviewResult {
  content: string;
  /** 1-based line number of the first line in `content`. */
  startLine: number;
}
