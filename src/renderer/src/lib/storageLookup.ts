import type { FileEntry } from '@shared/types/storage';

/**
 * Stats a path that may well not exist. A plain `storageStat` of a missing path rejects, and Electron
 * prints every rejected IPC handler as an error in the main process log; checking `storageExists` first
 * keeps an ordinary miss quiet. Resolves to null when the path is missing or cannot be read.
 */
export async function statIfExists(providerId: string, path: string): Promise<FileEntry | null> {
  const api = window.multissh;
  if (!api?.storageStat) return null;
  if (api.storageExists) {
    try {
      if (!(await api.storageExists(providerId, path))) return null;
    } catch {
      // Could not tell (provider not connected): let the stat decide.
    }
  }
  try {
    return await api.storageStat(providerId, path);
  } catch {
    return null;
  }
}
