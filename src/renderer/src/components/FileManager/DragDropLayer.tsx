import React, { useCallback, useMemo, useState } from 'react';
import { DRAG_MIME_TYPE, type DragPayload } from './types';
import { DragDropContext, type DragDropContextValue } from './DragDropContext';

export const DragDropProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeDrag, setActiveDrag] = useState<DragPayload | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);

  const beginDrag = useCallback((payload: DragPayload, dataTransfer: DataTransfer) => {
    setActiveDrag(payload);
    try {
      dataTransfer.effectAllowed = 'copy';
      dataTransfer.setData(DRAG_MIME_TYPE, JSON.stringify(payload));
      dataTransfer.setData('text/plain', payload.entries.map((e) => e.name).join('\n'));
    } catch {
      // Some browsers restrict custom MIME types during dragstart; payload is still
      // available in-memory via activeDrag for same-window drags.
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
      const withPath = file as File & { path?: string };
      if (withPath.path) {
        paths.push(withPath.path);
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
