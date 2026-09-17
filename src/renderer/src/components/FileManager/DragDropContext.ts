import { createContext, useContext } from 'react';
import type { DragPayload } from './types';

export interface DragDropContextValue {
  activeDrag: DragPayload | null;
  hoveredTarget: string | null;
  beginDrag: (payload: DragPayload, dataTransfer: DataTransfer) => void;
  endDrag: () => void;
  setHoveredTarget: (target: string | null) => void;
  readDropPayload: (dataTransfer: DataTransfer) => DragPayload | null;
  readOsFilePaths: (dataTransfer: DataTransfer) => string[];
}

export const DragDropContext = createContext<DragDropContextValue | null>(null);

export function useDragDrop(): DragDropContextValue {
  const ctx = useContext(DragDropContext);
  if (!ctx) {
    throw new Error('useDragDrop must be used within a DragDropProvider');
  }
  return ctx;
}
