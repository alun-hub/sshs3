import type { FileEntry } from '@shared/types/storage';

export type PaneSide = 'left' | 'right';

export type SourceType = 'local' | 'sftp' | 's3' | 'k8s';

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

/**
 * Runtime shape check for a DragPayload parsed from `dataTransfer.getData()`
 * (M6, code review). Unlike our own in-memory `activeDrag` fallback (which
 * we built ourselves via buildDragPayload), this data can come from any drag
 * source in the OS/browser that happens to write the same MIME type, so
 * `providerId` and every `entries[].path` — which flow straight into a
 * privileged transfer IPC call — must not be trusted without a shape check.
 */
export function isValidDragPayload(value: unknown): value is DragPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.fromPane !== 'left' && v.fromPane !== 'right') return false;
  if (typeof v.providerId !== 'string' || !v.providerId) return false;
  if (typeof v.basePath !== 'string') return false;
  if (!Array.isArray(v.entries)) return false;
  return v.entries.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e.path === 'string' &&
      e.path.length > 0 &&
      typeof e.name === 'string' &&
      typeof e.size === 'number' &&
      typeof e.isDirectory === 'boolean'
    );
  });
}

export function buildDragPayload(
  fromPane: PaneSide,
  providerId: string,
  basePath: string,
  entries: FileEntry[]
): DragPayload {
  return { fromPane, providerId, basePath, entries };
}
