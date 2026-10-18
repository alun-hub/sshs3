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
    if (e.dataTransfer?.types?.includes('Files')) {
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

      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) {
        // Text drop fallback
        const text = e.dataTransfer?.getData('text/plain');
        if (text) {
          onPaste(text);
        }
        return;
      }

      // 1. Local session: paste local path(s) directly
      if (!isRemote || !config) {
        const paths = files
          .map((f) => (f as any).path || f.name)
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
        // Ensure storage is connected
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
          const localPath = (file as any).path;
          if (!localPath) {
            // In case Electron path is not accessible, fallback to name
            uploadedPaths.push(shellQuote(file.name));
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
          onNotice(`Uploaded ${file.name}`);
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
