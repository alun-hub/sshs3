import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DRAG_MIME_TYPE, type DragPayload, type PaneSide } from './types';
import { DragDropContext, type DragDropContextValue, type FileClipboard } from './DragDropContext';

export const DragDropProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);

  const copyFiles = useCallback((sourcePane: PaneSide, providerId: string, sourcePaths: string[]) => {
    setClipboard({ mode: 'copy', sourcePane, providerId, sourcePaths });
  }, []);

  const cutFiles = useCallback((sourcePane: PaneSide, providerId: string, sourcePaths: string[]) => {
    setClipboard({ mode: 'cut', sourcePane, providerId, sourcePaths });
  }, []);

  const clearClipboard = useCallback(() => {
    setClipboard(null);
  }, []);

  const endDrag = useCallback(() => {
    setActiveDrag(null);
    setHoveredTarget(null);
  }, []);

  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        endDrag();
      }
    };

    window.addEventListener('dragover', handleWindowDragOver, true);
    window.addEventListener('dragenter', handleWindowDragOver, true);
    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('keydown', handleWindowKeyDown, true);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver, true);
      window.removeEventListener('dragenter', handleWindowDragOver, true);
      window.removeEventListener('drop', handleWindowDrop);
      window.removeEventListener('keydown', handleWindowKeyDown, true);
    };
  }, [endDrag]);

  const beginDrag = useCallback((payload: DragPayload, dataTransfer: DataTransfer) => {
    setActiveDrag(payload);
    try {
      dataTransfer.effectAllowed = 'copy';
      dataTransfer.setData(DRAG_MIME_TYPE, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, []);

  const readDropPayload = useCallback(
    (dataTransfer: DataTransfer): DragPayload | null => {
      try {
        const raw = dataTransfer.getData(DRAG_MIME_TYPE);
        if (raw) {
          return JSON.parse(raw) as DragPayload;
        }
      } catch {
        // Fall through to in-memory payload below.
      }
      return activeDrag;
    },
    [activeDrag]
  );

  const readOsFilePaths = useCallback((dataTransfer: DataTransfer): string[] => {
    const paths: string[] = [];
    for (const file of Array.from(dataTransfer.files ?? [])) {
      const p =
        (typeof window !== 'undefined' && window.multissh?.getPathForFile
          ? window.multissh.getPathForFile(file)
          : null) || (file as File & { path?: string }).path;
      if (p) {
        paths.push(p);
      }
    }
    return paths;
  }, []);

  const value = useMemo<DragDropContextValue>(
    () => ({
      activeDrag,
      hoveredTarget,
      beginDrag,
      endDrag,
      setHoveredTarget,
      readDropPayload,
      readOsFilePaths,
      clipboard,
      copyFiles,
      cutFiles,
      clearClipboard,
    }),
    [
      activeDrag,
      hoveredTarget,
      beginDrag,
      endDrag,
      readDropPayload,
      readOsFilePaths,
      clipboard,
      copyFiles,
      cutFiles,
      clearClipboard,
    ]
  );

  return <DragDropContext.Provider value={value}>{children}</DragDropContext.Provider>;
};
