/** One terminal selection remembered by the clipboard history. */
export interface ClipboardHistoryEntry {
  id: string;
  text: string;
  /** ISO timestamp of the (latest) time this text was copied. */
  copiedAt: string;
  /** Terminal connection the text was copied from (e.g. `ssh:<id>:<host>:22:<user>`). */
  hostKey: string;
  /** Human-readable host label shown in the history modal. */
  hostLabel: string;
}

export type ClipboardHistoryScope = 'global' | 'host';

export const CLIPBOARD_HISTORY_MAX_ENTRIES = 200;
export const CLIPBOARD_HISTORY_MAX_ENTRY_CHARS = 100_000;
