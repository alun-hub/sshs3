/**
 * Runs async operations one at a time, in the order they were queued, and lets a caller cancel everything
 * that is queued or running (used by logout: a sign-in that is still pending must not log the user back in).
 */
export class OperationQueue {
  /** Tail of the queue; it never rejects, so one failed operation does not stop the next. */
  private tail: Promise<void> = Promise.resolve();
  /** Bumped by cancelAll(): operations queued before it are dropped when their turn comes. */
  private epoch = 0;
  private running: AbortController | null = null;
  /** Whether the running operation was queued with runReplacing(). */
  private runningReplaceable = false;
  /** Token of the newest runReplacing() operation; older replaceable ones are dropped or aborted. */
  private replaceToken = 0;

  constructor(private readonly cancelMessage = 'Operation was cancelled') {}

  /**
   * Queues `task`. Its signal is aborted by cancelAll() or by `external`; an operation cancelled before it
   * started never runs and rejects with the cancel message.
   */
  public run<T>(task: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    return this.enqueue(task, external, undefined);
  }

  /**
   * Like run(), but supersedes earlier runReplacing() operations: a still-queued one is dropped and a running
   * one is aborted, so a retry never waits behind a stalled interactive sign-in. Other operations (logout,
   * silent renewal) are left alone.
   */
  public runReplacing<T>(task: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    const token = ++this.replaceToken;
    if (this.runningReplaceable) this.running?.abort();
    return this.enqueue(task, external, token);
  }

  private enqueue<T>(task: (signal: AbortSignal) => Promise<T>, external: AbortSignal | undefined, token: number | undefined): Promise<T> {
    const epoch = this.epoch;
    const result = this.tail.then(async () => {
      if (epoch !== this.epoch || external?.aborted || (token !== undefined && token !== this.replaceToken)) {
        throw new Error(this.cancelMessage);
      }
      const controller = new AbortController();
      const onExternalAbort = () => controller.abort();
      external?.addEventListener('abort', onExternalAbort, { once: true });
      this.running = controller;
      this.runningReplaceable = token !== undefined;
      try {
        return await task(controller.signal);
      } finally {
        external?.removeEventListener('abort', onExternalAbort);
        if (this.running === controller) {
          this.running = null;
          this.runningReplaceable = false;
        }
      }
    });
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Aborts the running operation and drops everything queued so far; operations queued afterwards run normally. */
  public cancelAll(): void {
    this.epoch++;
    this.running?.abort();
  }
}
