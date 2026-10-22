/** Default cap per session, in UTF-16 code units (about 1 MB of ASCII output). */
export const DEFAULT_SCROLLBACK_LIMIT = 1_000_000;

/**
 * Keeps the most recent output of each terminal session in the main process, so a terminal that is
 * moved to another window can be redrawn there (a new xterm instance starts empty). Raw bytes are
 * kept as received; replaying them into a fresh terminal reproduces the screen.
 */
export class ScrollbackBuffer {
  private readonly chunks = new Map<string, string[]>();
  private readonly sizes = new Map<string, number>();

  constructor(private readonly limit: number = DEFAULT_SCROLLBACK_LIMIT) {}

  append(sessionId: string, data: string): void {
    if (!sessionId || !data) return;
    let list = this.chunks.get(sessionId);
    if (!list) {
      list = [];
      this.chunks.set(sessionId, list);
    }
    list.push(data);
    let size = (this.sizes.get(sessionId) ?? 0) + data.length;
    // Drop whole old chunks first; only the oldest remaining chunk is ever cut.
    while (size > this.limit && list.length > 1) {
      size -= list.shift()!.length;
    }
    if (size > this.limit && list.length === 1) {
      list[0] = trimToLimit(list[0], this.limit);
      size = list[0].length;
    }
    this.sizes.set(sessionId, size);
  }

  get(sessionId: string): string {
    return (this.chunks.get(sessionId) ?? []).join('');
  }

  delete(sessionId: string): void {
    this.chunks.delete(sessionId);
    this.sizes.delete(sessionId);
  }

  clear(): void {
    this.chunks.clear();
    this.sizes.clear();
  }
}

/** Cuts from the front to `limit`, starting at a line boundary when one is close so no line is half-replayed. */
function trimToLimit(text: string, limit: number): string {
  const cut = text.slice(text.length - limit);
  const newline = cut.indexOf('\n');
  return newline >= 0 && newline < 4096 ? cut.slice(newline + 1) : cut;
}
