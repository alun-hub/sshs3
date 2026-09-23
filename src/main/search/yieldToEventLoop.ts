/**
 * Cooperative yield point for long synchronous work (e.g. scanning every line of a file
 * that matches on most of them). Node is single-threaded, so a tight loop that never
 * awaits anything — even one that checks a cancellation flag every iteration — starves
 * every other pending callback on the same event loop, including the IPC handler that
 * would otherwise set that very flag. `setImmediate` runs after I/O callbacks, which is
 * the standard way to hand control back without an arbitrary timer delay.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
