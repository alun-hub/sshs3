import { useEffect, useState } from 'react';
import type { UpdateState } from '@shared/types/update';

/** Subscribes to the main-process update state (null until the first snapshot arrives). */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    const api = window.multissh;
    if (!api?.getUpdateState || !api.onUpdateState) return;
    let cancelled = false;
    void api
      .getUpdateState()
      .then((initial) => {
        if (!cancelled) setState((prev) => prev ?? initial);
      })
      .catch(() => {});
    const unsubscribe = api.onUpdateState((next) => setState(next));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}
