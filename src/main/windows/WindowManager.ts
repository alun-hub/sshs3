/** The slice of Electron's WebContents the manager needs (structural, so tests can fake it). */
export interface ManagedWebContents {
  readonly id: number;
  readonly mainFrame: unknown;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

export interface ManagedWindow {
  readonly webContents: ManagedWebContents;
  isDestroyed(): boolean;
}

/** What IpcBridge needs from the window layer to route events (WindowManager implements it). */
export interface WindowRouter {
  sendToSession(sessionId: string, channel: string, ...args: unknown[]): boolean;
  broadcast(channel: string, ...args: unknown[]): void;
  assign(sessionId: string, windowId: number): void;
  windowIdOfSender(sender: { id: number } | null | undefined): number | undefined;
}

/**
 * Registry of the app's renderer windows, and the single place that decides which window an IPC
 * event goes to: session events go to the window that owns the session, prompts go to the window
 * the user is looking at, and broadcasts reach all of them.
 */
export class WindowManager<W extends ManagedWindow = ManagedWindow> implements WindowRouter {
  private readonly windows = new Map<number, W>();
  private readonly sessionOwner = new Map<string, number>();
  private focusedId: number | null = null;

  /** Adds a window; the first one (or the last focused) is what prompts fall back to. Returns its id. */
  register(win: W): number {
    const id = win.webContents.id;
    this.windows.set(id, win);
    this.focusedId = id;
    return id;
  }

  /** Forgets a window and every session it owned (their renderer is gone). Returns the released session ids. */
  unregister(windowId: number): string[] {
    this.windows.delete(windowId);
    if (this.focusedId === windowId) {
      const remaining = this.live();
      this.focusedId = remaining.length > 0 ? remaining[remaining.length - 1].webContents.id : null;
    }
    return this.releaseWindow(windowId);
  }

  setFocused(windowId: number): void {
    if (this.windows.has(windowId)) this.focusedId = windowId;
  }

  get(windowId: number): W | undefined {
    return this.windows.get(windowId);
  }

  list(): W[] {
    return this.live();
  }

  get size(): number {
    return this.windows.size;
  }

  /** The window prompts and global dialogs are shown in: the focused one, else any live window. */
  focused(): W | undefined {
    const focused = this.focusedId !== null ? this.windows.get(this.focusedId) : undefined;
    if (focused && !focused.isDestroyed()) return focused;
    const live = this.live();
    return live[live.length - 1];
  }

  focusedWebContents(): ManagedWebContents | undefined {
    return this.focused()?.webContents;
  }

  /** Window id for the sender of an IPC call, or undefined when it is not one of our windows. */
  windowIdOfSender(sender: { id: number } | null | undefined): number | undefined {
    return sender && this.windows.has(sender.id) ? sender.id : undefined;
  }

  /** True only for the top-level frame of a registered window; anything else is untrusted. */
  isTrustedFrame(frame: unknown): boolean {
    if (!frame) return false;
    for (const win of this.live()) {
      if (win.webContents.mainFrame === frame) return true;
    }
    return false;
  }

  assign(sessionId: string, windowId: number): void {
    if (this.windows.has(windowId)) this.sessionOwner.set(sessionId, windowId);
  }

  release(sessionId: string): void {
    this.sessionOwner.delete(sessionId);
  }

  ownerOf(sessionId: string): number | undefined {
    return this.sessionOwner.get(sessionId);
  }

  sessionsOf(windowId: number): string[] {
    const ids: string[] = [];
    for (const [sessionId, owner] of this.sessionOwner) {
      if (owner === windowId) ids.push(sessionId);
    }
    return ids;
  }

  /** Hands every listed session to another window (tab moved between windows). */
  transfer(sessionIds: string[], toWindowId: number): void {
    for (const sessionId of sessionIds) this.assign(sessionId, toWindowId);
  }

  /**
   * Sends a session-bound event to the owning window. A session that has no (live) owner falls back
   * to the focused window, so output is never silently dropped while ownership is being set up.
   */
  sendToSession(sessionId: string, channel: string, ...args: unknown[]): boolean {
    const ownerId = this.sessionOwner.get(sessionId);
    const owner = ownerId !== undefined ? this.windows.get(ownerId) : undefined;
    const target = owner && !owner.isDestroyed() ? owner.webContents : this.focusedWebContents();
    if (!target || target.isDestroyed()) return false;
    target.send(channel, ...args);
    return true;
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const win of this.live()) win.webContents.send(channel, ...args);
  }

  private releaseWindow(windowId: number): string[] {
    const released = this.sessionsOf(windowId);
    for (const sessionId of released) this.sessionOwner.delete(sessionId);
    return released;
  }

  private live(): W[] {
    return [...this.windows.values()].filter((w) => !w.isDestroyed());
  }
}
