import type { FileEntry } from '@shared/types/storage';
import { describeIpcError } from './format';
import { decidePathOpen, type PathClickAction } from './pathOpenDecision';

/** Ctrl+click is a deliberate act, so it may wait longer for the lookup than a hover card does. */
export const OPEN_LOOKUP_TIMEOUT_MS = 3000;

export interface ClickedPath {
  action: PathClickAction;
  /** The storage provider of the terminal's host ('' when it has none). */
  providerId: string;
  /** The path as that provider opens it. */
  storagePath: string;
  isNetworkUnc: boolean;
  localShellRunsSsh: boolean;
  /** The path as printed is relative. */
  relative: boolean;
  cwdReliable: boolean;
}

export interface ClickedPathApi {
  /** Resolves to the entry, `null` when there is none, `'timeout'` when the lookup took too long; rejects on other failures. */
  lookup(providerId: string, path: string, ms: number): Promise<FileEntry | null | 'timeout'>;
  openExternal(providerId: string, path: string): Promise<{ sessionToken: string }>;
}

export type ClickedPathOutcome =
  | { kind: 'opened'; sessionToken: string; name: string; remote: boolean }
  /** The caller shows the path in the file manager; `reason`, when given, is told to the user. */
  | { kind: 'filemanager'; reason?: string };

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p;

/**
 * Carries out Ctrl+click on a path: opens a file with the system app when that is safe and wanted, and otherwise
 * says that the file manager is to show it. Never throws.
 */
export async function openClickedPath(click: ClickedPath, api: ClickedPathApi): Promise<ClickedPathOutcome> {
  if (!click.providerId) return { kind: 'filemanager' }; // no storage to look in or open from
  const name = baseName(click.storagePath);
  // Nothing is looked up for these: a network share would be contacted, and a local shell running ssh shows a
  // path of another machine. (The decision turns both into a quiet file-manager outcome.)
  const skipLookup = click.action !== 'os' || click.isNetworkUnc || click.localShellRunsSsh;
  let entry: FileEntry | 'missing' | 'unknown' = 'unknown';
  if (!skipLookup) {
    try {
      const found = await api.lookup(click.providerId, click.storagePath, OPEN_LOOKUP_TIMEOUT_MS);
      entry = found === 'timeout' ? 'unknown' : (found ?? 'missing');
    } catch {
      entry = 'unknown';
    }
  }

  const decision = decidePathOpen({
    action: click.action,
    isNetworkUnc: click.isNetworkUnc,
    localShellRunsSsh: click.localShellRunsSsh,
    entry,
    relative: click.relative,
    cwdReliable: click.cwdReliable,
  });
  if (decision.kind === 'filemanager') return decision;

  try {
    const { sessionToken } = await api.openExternal(click.providerId, click.storagePath);
    return { kind: 'opened', sessionToken, name, remote: click.providerId !== 'local' };
  } catch (err) {
    return { kind: 'filemanager', reason: `Could not open ${name}: ${describeIpcError(err, 'unknown error')}` };
  }
}
