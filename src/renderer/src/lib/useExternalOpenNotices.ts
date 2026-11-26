import { useCallback, useEffect, useRef } from 'react';

/**
 * Tells the user what became of files opened with the system app from the terminal: a remote file is edited in a
 * temporary copy that the main process uploads again on every save, and nothing else shows whether that worked.
 * `track` registers a session; events of sessions started elsewhere (the editor dialog shows its own) are ignored.
 */
export function useExternalOpenNotices(notify: (message: string, durationMs?: number) => void) {
  const namesRef = useRef(new Map<string, string>());
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    return window.multissh?.onExternalFileStatus?.((event) => {
      const name = namesRef.current.get(event.sessionToken);
      if (!name) return;
      if (event.status === 'error') {
        notifyRef.current(`Upload of ${name} failed: ${event.error || 'unknown error'}`, 6000);
      } else {
        notifyRef.current(`Uploaded ${name}`, 2000);
      }
    });
  }, []);

  return useCallback((sessionToken: string, name: string) => {
    namesRef.current.set(sessionToken, name);
  }, []);
}
