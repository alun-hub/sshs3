import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { FileEntry } from '@shared/types/storage';
import { DRAG_MIME_TYPE, type DragPayload, type PaneSide } from './types';

interface DragDropContextValue {
  activeDrag: DragPayload | null;
  hoveredTarget: string | null;
  beginDrag: (payload: DragPayload, dataTransfer: DataTransfer) => void;
  endDrag: () => void;
  setHoveredTarget: (target: string | null) => void;
  readDropPayload: (dataTransfer: DataTransfer) => DragPayload | null;
  readOsFilePaths: (dataTransfer: DataTransfer) => string[];
}

const DragDropContext = createContext<DragDropContextValue | null>(null);

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

export function useDragDrop(): DragDropContextValue {
  const ctx = useContext(DragDropContext);
  if (!ctx) {
    throw new Error('useDragDrop must be used within a DragDropProvider');
  }
  return ctx;
}

export function buildDragPayload(fromPane: PaneSide, providerId: string, basePath: string, entries: FileEntry[]): DragPayload {
  return { fromPane, providerId, basePath, entries };
}
