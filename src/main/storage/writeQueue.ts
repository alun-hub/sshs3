/**
 * Runs async mutations strictly one after another, so a store's read-modify-write
 * cycles never interleave. A failed mutation rejects only its own caller; the queue
 * keeps accepting work afterwards.
 */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutation, mutation);
    this.tail = result.then(
      () => {},
      () => {}
    );
    return result;
  }

  /** Resolves once everything queued so far has finished. Never rejects. */
  idle(): Promise<void> {
    return this.tail;
  }
}
