import { useState, useRef, useCallback, useEffect } from 'react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { K8sTerminalTarget } from '@shared/types/kubernetes';
import { isValidDragPayload, DRAG_MIME_TYPE } from '../components/FileManager/types';
import { terminalProviderId, terminalStorageConnectConfig } from './terminalStorage';
import { isWindowsPath } from './terminalPathPreview';
import { windowsToWslPath } from './wslPaths';

export interface UseTerminalDropUploadOptions {
  isRemote: boolean;
  /** A local WSL shell: dropped Windows paths are pasted as `/mnt/c/...` paths. */
  wsl?: boolean;
  config?: SSHConnectionConfig;
  /** Kubernetes terminals upload into the container through the k8s storage provider. */
  k8sTarget?: K8sTerminalTarget;
  targetFolder: string;
  onPaste: (text: string) => void;
  onNotice: (message: string) => void;
}

export function shellQuote(path: string): string {
  // Local Windows paths go to PowerShell or cmd.exe, which both take double quotes (cmd has no
  // single-quote quoting, and PowerShell escapes `'` as `''`, not the POSIX `'\''`).
  if (isWindowsPath(path)) return `"${path}"`;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export function getFilePath(file: File): string {
  try {
    if (typeof window !== 'undefined' && window.multissh?.getPathForFile) {
      const p = window.multissh.getPathForFile(file);
      if (p) return p;
    }
  } catch {
    // ignore
  }
  return (file as File & { path?: string }).path || '';
}

/** True for a plain file name that cannot escape the destination directory. */
export function isSafeEntryName(name: string): boolean {
  return Boolean(name) && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
}

/** Joins a destination directory and a file name using POSIX separators. */
export function joinRemotePath(dir: string, name: string): string {
  const clean = (dir || '/tmp').replace(/\/+$/, '');
  return `${clean}/${name}`;
}

interface TransferItem {
  sourceProviderId: string;
  sourcePath: string;
  name: string;
}

export function useTerminalDropUpload({
  isRemote,
  wsl = false,
  config,
  k8sTarget,
  targetFolder,
  onPaste,
  onNotice,
}: UseTerminalDropUploadOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // A drag that ends without a drop or dragleave on the terminal (e.g. a native drag started from the path hover
  // card and released elsewhere) would leave the overlay up. Chromium sends no mouse events during a drag, so any
  // dragend/drop, pointer movement, click or key press means the drag is over.
  useEffect(() => {
    if (!isDragging) return;
    const clear = () => {
      dragCounterRef.current = 0;
      setIsDragging(false);
    };
    const events = ['dragend', 'drop', 'pointermove', 'pointerdown', 'mousemove', 'keydown'] as const;
    for (const name of events) window.addEventListener(name, clear, true);
    return () => {
      for (const name of events) window.removeEventListener(name, clear, true);
    };
  }, [isDragging]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes(DRAG_MIME_TYPE)) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const storageTarget = { config: isRemote ? config : undefined, k8sTarget };
      const targetProviderId = terminalProviderId(storageTarget);
      const targetConnect = terminalStorageConnectConfig(storageTarget);
      const canUpload = Boolean(targetProviderId && targetConnect);
      const quoteLocal = (p: string): string => shellQuote(wsl ? windowsToWslPath(p) : p);

      /** Copies the items into the terminal's current directory and pastes the resulting paths. */
      const uploadAndPaste = async (items: TransferItem[]) => {
        if (!targetConnect) return;
        if (!targetFolder) {
          onNotice('The current directory is not known yet. Press Enter in the terminal and drop again.');
          return;
        }
        const pasted: string[] = [];
        const uploaded: string[] = [];
        let skipped = 0;
        try {
          await window.multissh?.connectStorage?.({ id: 'local', name: 'Local Disk', type: 'local' });
          await window.multissh?.connectStorage?.(targetConnect);
          for (const item of items) {
            const remotePath = joinRemotePath(targetFolder, item.name);
            const res = await window.multissh?.transferAdd?.({
              sourceProviderId: item.sourceProviderId,
              sourcePath: item.sourcePath,
              targetProviderId,
              targetPath: remotePath,
            });
            if (res?.skipped) {
              skipped++;
              continue;
            }
            // The transfer may have written elsewhere (e.g. "keep both" renames the file)
            pasted.push(shellQuote(res?.targetPath || remotePath));
            uploaded.push(item.name);
          }
          if (uploaded.length > 0) {
            onNotice(uploaded.length === 1 ? `Uploading ${uploaded[0]}...` : `Uploading ${uploaded.length} files...`);
          } else if (skipped > 0) {
            onNotice(skipped === 1 ? 'Upload skipped' : `${skipped} uploads skipped`);
          }
        } catch (err: any) {
          onNotice(`Upload failed: ${err?.message || String(err)}`);
        }
        if (pasted.length > 0) onPaste(pasted.join(' '));
      };

      // Internal drag from the sshs3 file manager
      const internalData =
        typeof e.dataTransfer?.getData === 'function' ? e.dataTransfer.getData(DRAG_MIME_TYPE) : '';
      if (internalData) {
        let payload: unknown = null;
        try {
          payload = JSON.parse(internalData);
        } catch {
          // not ours; fall through to the standard file/text handling below
        }
        if (isValidDragPayload(payload) && payload.entries.length > 0) {
          const { entries, providerId: sourceProviderId } = payload;
          if (!entries.every((entry) => isSafeEntryName(entry.name))) {
            onNotice('Cannot drop files with unsupported names');
            return;
          }
          if (!canUpload || sourceProviderId === targetProviderId) {
            if (sourceProviderId === 'local' || sourceProviderId === targetProviderId) {
              onPaste(entries.map((entry) => quoteLocal(entry.path)).join(' '));
            } else {
              onNotice('Cannot paste remote files into this terminal; copy them to the local disk first');
            }
            return;
          }
          await uploadAndPaste(entries.map((entry) => ({ sourceProviderId, sourcePath: entry.path, name: entry.name })));
          return;
        }
      }

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) {
        // Text drop fallback
        const text = typeof e.dataTransfer?.getData === 'function' ? e.dataTransfer.getData('text/plain') : '';
        if (text) {
          onPaste(text);
        }
        return;
      }

      // Local session: paste local path(s) directly
      if (!canUpload) {
        const paths = files
          .map((f) => getFilePath(f) || f.name)
          .filter(Boolean)
          .map(quoteLocal);
        if (paths.length > 0) {
          onPaste(paths.join(' '));
        }
        return;
      }

      // Remote session: upload to the current directory and paste the remote path(s)
      const items: TransferItem[] = [];
      const unresolved: string[] = [];
      for (const file of files) {
        const localPath = getFilePath(file);
        if (localPath && isSafeEntryName(file.name)) {
          items.push({ sourceProviderId: 'local', sourcePath: localPath, name: file.name });
        } else {
          unresolved.push(file.name);
          onNotice(`Could not resolve local path for ${file.name}`);
        }
      }
      if (unresolved.length > 0) onPaste(unresolved.map(shellQuote).join(' '));
      if (items.length > 0) await uploadAndPaste(items);
    },
    [isRemote, wsl, config, k8sTarget, targetFolder, onPaste, onNotice]
  );

  return {
    isDragging,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
