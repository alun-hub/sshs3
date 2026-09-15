import type { FileEntry } from '@shared/types/storage';

export type PaneSide = 'left' | 'right';

export type SourceType = 'local' | 'sftp' | 's3';

export interface PaneSource {
  providerId: string;
  sourceType: SourceType;
  label: string;
}

export interface DragPayload {
  fromPane: PaneSide;
  providerId: string;
  basePath: string;
  entries: FileEntry[];
}

export const DRAG_MIME_TYPE = 'application/x-multissh-file-entries';
