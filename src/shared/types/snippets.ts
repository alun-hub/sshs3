/** A saved command the user can insert into a terminal from the snippet palette. */
export interface Snippet {
  id: string;
  name: string;
  /** May span several lines and use `{{host}}`, `{{user}}`, `{{date}}` variables. */
  command: string;
  /** Connection the snippet is limited to (same key format as clipboard history); omitted = available everywhere. */
  hostKey?: string;
  /** Human-readable label of that connection. */
  hostLabel?: string;
}

export const SNIPPETS_MAX_COUNT = 500;
export const SNIPPET_MAX_NAME_CHARS = 200;
export const SNIPPET_MAX_COMMAND_CHARS = 20_000;
