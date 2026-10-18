import { useState, useRef, useCallback } from 'react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { SFTPConfig } from '@shared/types/storage';

export interface UseTerminalDropUploadOptions {
  isRemote: boolean;
  config?: SSHConnectionConfig;
  targetFolder: string;
  onPaste: (text: string) => void;
  onNotice: (message: string) => void;
}

export function shellQuote(path: string): string {
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

const DRAG_MIME_TYPE = 'application/x-multissh-file-entries';

export function useTerminalDropUpload({
  isRemote,
  config,
  targetFolder,
  onPaste,
  onNotice,
}: UseTerminalDropUploadOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingState, setUploadingState] = useState<{ fileName: string; progress?: number } | null>(null);
  const dragCounterRef = useRef(0);

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

      // Support internal drag from sshs3 file manager
      const internalData =
        typeof e.dataTransfer?.getData === 'function' ? e.dataTransfer.getData(DRAG_MIME_TYPE) : '';
      if (internalData) {
        try {
          const parsed = JSON.parse(internalData);
          if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
            const entries: Array<{ name: string; path: string }> = parsed.entries;
            const sourceProviderId: string = parsed.providerId || 'local';

            if (!isRemote || !config) {
              if (sourceProviderId === 'local') {
                const paths = entries.map((entry) => shellQuote(entry.path));
                onPaste(paths.join(' '));
                return;
              }
            } else {
              const targetProviderId = `sftp-${config.id || config.host}`;
              const destinationDir = targetFolder || '/tmp';
              const cleanDestination = destinationDir.replace(/\/+$/, '') || '/';

              if (sourceProviderId === targetProviderId) {
                const paths = entries.map((entry) => shellQuote(entry.path));
                onPaste(paths.join(' '));
                return;
              }

              await window.multissh?.connectStorage?.({
                id: 'local',
                name: 'Local Disk',
                type: 'local',
              });

              const sftpConfig: SFTPConfig = {
                ...config,
                id: config.id || config.host,
                name: config.name || config.host,
                port: config.port ?? 22,
              };

              await window.multissh?.connectStorage?.({
                id: targetProviderId,
                name: config.name || config.host,
                type: 'sftp',
                sftpConfig,
              });

              const transferredPaths: string[] = [];
              for (const entry of entries) {
                const remotePath = cleanDestination === '/' ? `/${entry.name}` : `${cleanDestination}/${entry.name}`;
                if (window.multissh?.transferAdd) {
                  await window.multissh.transferAdd({
                    sourceProviderId,
                    sourcePath: entry.path,
                    targetProviderId,
                    targetPath: remotePath,
                  });
                }
                transferredPaths.push(shellQuote(remotePath));
              }

              if (entries.length === 1) {
                onNotice(`Uploading ${entries[0].name}...`);
              } else {
                onNotice(`Uploading ${entries.length} files...`);
              }

              if (transferredPaths.length > 0) {
                onPaste(transferredPaths.join(' '));
              }
              return;
            }
          }
        } catch {
          // fallback to standard files below
        }
      }

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) {
        // Text drop fallback
        const text =
          typeof e.dataTransfer?.getData === 'function' ? e.dataTransfer.getData('text/plain') : '';
        if (text) {
          onPaste(text);
        }
        return;
      }

      // 1. Local session: paste local path(s) directly
      if (!isRemote || !config) {
        const paths = files
          .map((f) => getFilePath(f) || f.name)
          .filter(Boolean)
          .map(shellQuote);

        if (paths.length > 0) {
          onPaste(paths.join(' '));
        }
        return;
      }

      // 2. Remote SSH session: upload to targetFolder via SFTP and paste remote path(s)
      const targetProviderId = `sftp-${config.id || config.host}`;
      const destinationDir = targetFolder || '/tmp';
      const cleanDestination = destinationDir.replace(/\/+$/, '') || '/';

      try {
        // Ensure local storage is connected for source
        await window.multissh?.connectStorage?.({
          id: 'local',
          name: 'Local Disk',
          type: 'local',
        });

        // Ensure target storage is connected
        const sftpConfig: SFTPConfig = {
          ...config,
          id: config.id || config.host,
          name: config.name || config.host,
          port: config.port ?? 22,
        };

        await window.multissh?.connectStorage?.({
          id: targetProviderId,
          name: config.name || config.host,
          type: 'sftp',
          sftpConfig,
        });

        const uploadedPaths: string[] = [];

        for (const file of files) {
          const localPath = getFilePath(file);
          if (!localPath) {
            uploadedPaths.push(shellQuote(file.name));
            onNotice(`Could not resolve local path for ${file.name}`);
            continue;
          }

          const remotePath = cleanDestination === '/' ? `/${file.name}` : `${cleanDestination}/${file.name}`;
          setUploadingState({ fileName: file.name, progress: 0 });

          // Start transfer job
          if (window.multissh?.transferAdd) {
            await window.multissh.transferAdd({
              sourceProviderId: 'local',
              sourcePath: localPath,
              targetProviderId,
              targetPath: remotePath,
            });
          }

          uploadedPaths.push(shellQuote(remotePath));
        }

        if (files.length === 1) {
          onNotice(`Uploading ${files[0].name}...`);
        } else if (files.length > 1) {
          onNotice(`Uploading ${files.length} files...`);
        }

        if (uploadedPaths.length > 0) {
          onPaste(uploadedPaths.join(' '));
        }
      } catch (err: any) {
        onNotice(`Upload failed: ${err?.message || String(err)}`);
      } finally {
        setUploadingState(null);
      }
    },
    [isRemote, config, targetFolder, onPaste, onNotice]
  );

  return {
    isDragging,
    uploadingState,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
