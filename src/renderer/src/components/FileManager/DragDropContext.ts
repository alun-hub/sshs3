import { createContext, useContext } from 'react';
import type { DragPayload, PaneSide } from './types';

export interface FileClipboard {
  mode: 'copy' | 'cut';
  sourcePane: PaneSide;
  providerId: string;
  sourcePaths: string[];
}

export interface DragDropContextValue {
  activeDrag: DragPayload | null;
  hoveredTarget: string | null;
  beginDrag: (payload: DragPayload, dataTransfer: DataTransfer) => void;
  endDrag: () => void;
  setHoveredTarget: (target: string | null) => void;
  readDropPayload: (dataTransfer: DataTransfer) => DragPayload | null;
  readOsFilePaths: (dataTransfer: DataTransfer) => string[];
  clipboard: FileClipboard | null;
  copyFiles: (sourcePane: PaneSide, providerId: string, sourcePaths: string[]) => void;
  cutFiles: (sourcePane: PaneSide, providerId: string, sourcePaths: string[]) => void;
  clearClipboard: () => void;
}

export const DragDropContext = createContext<DragDropContextValue | null>(null);

export function useDragDrop(): DragDropContextValue {
  const ctx = useContext(DragDropContext);
  if (!ctx) {
    throw new Error('useDragDrop must be used within a DragDropProvider');
  }
  return ctx;
}
