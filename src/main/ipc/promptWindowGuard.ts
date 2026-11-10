import type { WebContents } from 'electron';

export type WatchableWebContents = Partial<Pick<WebContents, 'once' | 'removeListener' | 'isDestroyed' | 'isCrashed'>>;

/**
 * Calls `onLost` (once) if the window that is showing a prompt goes away before the user has answered:
 * its renderer process crashes or the window is destroyed. Without it the promise behind the prompt
 * never settles — for the quit confirmation that means the app can no longer be closed — and the work
 * waiting on it hangs for good. Returns a function that stops watching; call it when the prompt is
 * answered. A window object that cannot be watched (a test stand-in) is simply not watched.
 */
export function watchPromptWindow(webContents: WatchableWebContents, onLost: () => void): () => void {
  if (typeof webContents.once !== 'function' || typeof webContents.removeListener !== 'function') {
    return () => {};
  }
  let watching = true;
  const lost = (): void => {
    if (!watching) return;
    stop();
    onLost();
  };
  const stop = (): void => {
    watching = false;
    webContents.removeListener?.('render-process-gone', lost);
    webContents.removeListener?.('destroyed', lost);
  };
  webContents.once('render-process-gone', lost);
  webContents.once('destroyed', lost);
  return stop;
}

/**
 * Registers a pending prompt that settles itself when its window goes away: `answer` is called with the
 * user's answer (and stops the watching), `answerWhenLost` if the window is lost first. Exactly one of
 * the two happens, and the entry leaves `pending` either way. Returns false when the window was already
 * gone and the prompt has been answered on the spot: the caller must then not send the prompt to it.
 * `extra` is stored next to the callback, for prompts whose pending entry carries more than the callback
 * (an askpass prompt remembers which session asked, so that session ending can cancel it).
 */
export function addGuardedPrompt<A extends unknown[], E extends object = object>(
  pending: Map<string, { callback: (...args: A) => void } & E>,
  id: string,
  webContents: WatchableWebContents,
  answerWhenLost: () => void,
  answer: (...args: A) => void,
  extra?: E
): boolean {
  // Its events have already been and gone: nobody is left to answer.
  if (webContents.isDestroyed?.() || webContents.isCrashed?.()) {
    answerWhenLost();
    return false;
  }
  const stopWatching = watchPromptWindow(webContents, () => {
    if (pending.delete(id)) answerWhenLost();
  });
  pending.set(id, {
    ...(extra as E),
    callback: (...args: A) => {
      stopWatching();
      answer(...args);
    },
  });
  return true;
}
