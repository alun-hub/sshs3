/**
 * jsdom has no canvas, so `HTMLCanvasElement.getContext()` returns null. xterm's overview ruler
 * (switched on by `overviewRuler.width`, which also sets the scrollbar width) throws
 * "Ctx cannot be null" in that case, so tests that render a real xterm Terminal would crash.
 *
 * This gives every canvas a context whose methods do nothing. It only matters in jsdom tests; in
 * the node environment `HTMLCanvasElement` does not exist and nothing happens.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  const noop = (): void => {};
  const context = new Proxy(
    {},
    {
      get: (_target, property) => (property === 'canvas' ? undefined : noop),
      set: () => true,
    }
  );
  HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
}
