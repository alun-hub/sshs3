/** What an event source must offer to be listened to through a ListenerSet (Node's EventEmitter does). */
export interface EmitterLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}

interface Attachment {
  owner: object;
  remove: () => void;
}

/**
 * Remembers every listener that was attached, per event source ("owner"), so that detaching them cannot be
 * forgotten: with the listener stored in one place and removed in another, adding a listener and missing its
 * off() left a listener behind that kept calling into a disposed object.
 *
 * Detaching is per owner and in attachment order, because the caller often has to stop one source before the
 * next (listeners off, then the manager is shut down) and must not detach a source it has not got to yet.
 * Everything is idempotent: detaching an owner twice, or one that never had a listener, does nothing.
 *
 * A removal that throws never stops the others (they have already been forgotten, so they would never be
 * removed otherwise): each failure goes to `onError`, or, without one, the first is rethrown once every removal
 * has run.
 */
export class ListenerSet {
  private attached: Attachment[] = [];

  constructor(private readonly onError?: (error: unknown) => void) {}

  /** Subscribes `listener` to `event` on `emitter` and remembers it. */
  on<A extends unknown[]>(emitter: EmitterLike, event: string, listener: (...args: A) => void): void {
    emitter.on(event, listener as (...args: any[]) => void);
    this.attached.push({ owner: emitter, remove: () => void emitter.off(event, listener as (...args: any[]) => void) });
  }

  /** For `const unsubscribe = source.onChange(callback)` style APIs: remembers how to undo it. */
  subscribe(owner: object, unsubscribe: () => void): void {
    this.attached.push({ owner, remove: unsubscribe });
  }

  /** Removes everything attached to `owner`, oldest first. */
  detach(owner: object): void {
    const mine = this.attached.filter((a) => a.owner === owner);
    this.attached = this.attached.filter((a) => a.owner !== owner);
    this.removeAll(mine);
  }

  /** Removes everything still attached, whatever the owner. */
  detachAll(): void {
    const all = this.attached;
    this.attached = [];
    this.removeAll(all);
  }

  /** How many listeners are attached right now. */
  get size(): number {
    return this.attached.length;
  }

  private removeAll(list: Attachment[]): void {
    const errors: unknown[] = [];
    for (const a of list) {
      try {
        a.remove();
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length === 0) return;
    if (this.onError) errors.forEach(this.onError);
    else throw errors[0];
  }
}
