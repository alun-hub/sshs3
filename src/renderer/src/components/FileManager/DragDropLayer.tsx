import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DRAG_MIME_TYPE, type DragPayload } from './types';
import { DragDropContext, type DragDropContextValue } from './DragDropContext';

export const DragDropProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);

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

    window.addEventListener('dragover', handleWindowDragOver, true);
    window.addEventListener('dragenter', handleWindowDragOver, true);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver, true);
      window.removeEventListener('dragenter', handleWindowDragOver, true);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  const beginDrag = useCallback((payload: DragPayload, dataTransfer: DataTransfer) => {
    setActiveDrag(payload);
    try {
      dataTransfer.effectAllowed = 'copy';
      dataTransfer.setData(DRAG_MIME_TYPE, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, []);

  const endDrag = useCallback(() => {
    setActiveDrag(null);
    setHoveredTarget(null);
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
    () => ({ activeDrag, hoveredTarget, beginDrag, endDrag, setHoveredTarget, readDropPayload, readOsFilePaths }),
    [activeDrag, hoveredTarget, beginDrag, endDrag, readDropPayload, readOsFilePaths]
  );

  return <DragDropContext.Provider value={value}>{children}</DragDropContext.Provider>;
};
