import { useCallback, useEffect, useState } from 'react';
import type { AwsSignIn } from '@shared/types/aws';
import type { AwsSsoStatusInfo } from '@shared/types/awsScan';

/**
 * Sign-in state (valid / expired / missing, plus expiry) for a list of saved sign-ins, keyed by sign-in id. Read from
 * the main process' token cache on mount, when the window gets focus and on `refresh`; never polled on a timer.
 */
export function useAwsSignInStatuses(signIns: readonly AwsSignIn[], enabled = true): { statuses: Record<string, AwsSsoStatusInfo>; refresh: () => void } {
  const [statuses, setStatuses] = useState<Record<string, AwsSsoStatusInfo>>({});
  const key = signIns.map((s) => `${s.id}|${s.startUrl}`).join('\n');

  const refresh = useCallback(() => {
    if (!enabled) return;
    for (const s of signIns) {
      window.multissh
        ?.awsSsoStatus?.(s.startUrl)
        .then((info) => setStatuses((prev) => ({ ...prev, [s.id]: info })))
        .catch(() => setStatuses((prev) => ({ ...prev, [s.id]: { status: 'missing' } })));
    }
    // `key` stands for the list contents; the array itself is a new reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return { statuses, refresh };
}
