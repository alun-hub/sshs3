import { useCallback, useEffect, useState } from 'react';
import type { AwsSsmTools } from '@shared/types/ssm';
import { shouldPollSsmTools, ssmToolsReadiness, type SsmToolsReadiness } from './ssmToolsState';

const POLL_MS = 3000;

/**
 * Detects the `aws` CLI and Session Manager plugin and notices when they get installed: re-checks on
 * mount, window focus and visibility change, and every few seconds while something is missing and
 * the page is visible. `enabled=false` does nothing at all.
 */
export function useAwsSsmTools(enabled: boolean): { tools: AwsSsmTools | null; readiness: SsmToolsReadiness; refresh: () => void } {
  const [tools, setTools] = useState<AwsSsmTools | null>(null);

  const refresh = useCallback(() => {
    window.multissh
      .awsSsmCheckTools()
      .then(setTools)
      .catch(() => {
        /* keep the previous state */
      });
  }, []);

  const readiness = ssmToolsReadiness(tools);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const onWake = () => {
      if (document.visibilityState !== 'hidden') refresh();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !shouldPollSsmTools(readiness, true)) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, readiness, refresh]);

  return { tools, readiness, refresh };
}
