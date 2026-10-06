import { useCallback, useEffect, useRef, useState } from 'react';

/** Back/forward history of the pane's folder; a provider switch starts a fresh history. */
export function useNavHistory(currentPath: string, providerId: string, onPathChange: (path: string) => void) {
  // Navigation history
  const [navHistory, setNavHistory] = useState<{ paths: string[]; index: number }>({
    paths: [currentPath],
    index: 0,
  });
  const isNavigatingHistoryRef = useRef(false);

  useEffect(() => {
    if (isNavigatingHistoryRef.current) {
      isNavigatingHistoryRef.current = false;
      return;
    }
    setNavHistory((prev) => {
      if (prev.paths[prev.index] === currentPath) return prev;
      const nextPaths = prev.paths.slice(0, prev.index + 1);
      nextPaths.push(currentPath);
      return {
        paths: nextPaths,
        index: nextPaths.length - 1,
      };
    });
  }, [currentPath]);

  const prevProviderRef = useRef(providerId);
  useEffect(() => {
    if (prevProviderRef.current !== providerId) {
      prevProviderRef.current = providerId;
      setNavHistory({ paths: [currentPath], index: 0 });
    }
  }, [providerId, currentPath]);

  const canGoBack = navHistory.index > 0;
  const canGoForward = navHistory.index < navHistory.paths.length - 1;

  const handleGoBack = useCallback(() => {
    if (navHistory.index > 0) {
      const target = navHistory.paths[navHistory.index - 1];
      isNavigatingHistoryRef.current = true;
      setNavHistory((prev) => ({ ...prev, index: prev.index - 1 }));
      onPathChange(target);
    }
  }, [navHistory, onPathChange]);

  const handleGoForward = useCallback(() => {
    if (navHistory.index < navHistory.paths.length - 1) {
      const target = navHistory.paths[navHistory.index + 1];
      isNavigatingHistoryRef.current = true;
      setNavHistory((prev) => ({ ...prev, index: prev.index + 1 }));
      onPathChange(target);
    }
  }, [navHistory, onPathChange]);

  return { canGoBack, canGoForward, handleGoBack, handleGoForward };
}
