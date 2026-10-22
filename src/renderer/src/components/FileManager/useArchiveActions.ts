import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { FileEntry } from '@shared/types/storage';
import { describeIpcError, joinPath } from '../../lib/format';
import type { SourceType } from './types';

/** Archives are packed and unpacked by tar/zip on the machine that holds the files, so only local and SFTP panes offer them. */
export function supportsArchives(sourceType: SourceType): boolean {
  return sourceType === 'local' || sourceType === 'sftp';
}

interface UseArchiveActionsParams {
  providerId: string;
  currentPath: string;
  selectedEntries: FileEntry[];
  load: (force?: boolean) => Promise<void> | void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
}

/** Compress / extract for the selection of a file pane; the new archive or folder is selected afterwards. */
export function useArchiveActions({
  providerId,
  currentPath,
  selectedEntries,
  load,
  setLoading,
  setError,
  setSelectedPaths,
}: UseArchiveActionsParams) {
  const run = useCallback(
    async (op: () => Promise<string>, failure: string) => {
      setLoading(true);
      setError(null);
      try {
        const createdName = await op();
        await load(true);
        setSelectedPaths(new Set([joinPath(currentPath, createdName)]));
      } catch (err) {
        setError(describeIpcError(err, failure));
      } finally {
        setLoading(false);
      }
    },
    [currentPath, load, setLoading, setError, setSelectedPaths]
  );

  const handleCompress = useCallback(
    (format: 'tar.gz' | 'zip') => {
      // Entries are named relative to the pane's folder; recursive-filter hits (names with a path) are not direct children.
      const names = selectedEntries.map((e) => e.name);
      if (names.length === 0 || names.some((n) => n.includes('/'))) return Promise.resolve();
      return run(() => window.multissh.archiveCompress(providerId, currentPath, names, format), 'Failed to create archive');
    },
    [providerId, currentPath, selectedEntries, run]
  );

  const handleExtract = useCallback(() => {
    if (selectedEntries.length !== 1) return Promise.resolve();
    const archivePath = selectedEntries[0].path;
    return run(() => window.multissh.archiveExtract(providerId, archivePath), 'Failed to extract archive');
  }, [providerId, selectedEntries, run]);

  return { handleCompress, handleExtract };
}
