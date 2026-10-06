import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { normalizeTab, sanitizeTabForSession, type AppTab } from './tabs';

/**
 * Restores the saved tabs on mount and saves them (credentials stripped) whenever tabs or the
 * active tab change. Saving waits for the restore to finish so a fresh render never overwrites
 * the stored session with an empty one.
 */
export function useSessionPersistence(
  tabs: AppTab[],
  activeTabId: string,
  setTabs: Dispatch<SetStateAction<AppTab[]>>,
  setActiveTabId: Dispatch<SetStateAction<string>>
): boolean {
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Load saved session on mount
  useEffect(() => {
    void window.multissh.sessionGet?.().then((session) => {
      if (session?.tabs && session.tabs.length > 0) {
        setTabs(session.tabs.map(normalizeTab));
        if (session.activeTabId && session.tabs.some((t) => t.id === session.activeTabId)) {
          setActiveTabId(session.activeTabId);
        } else {
          setActiveTabId(session.tabs[0].id);
        }
      }
      setSessionLoaded(true);
    });
  }, [setTabs, setActiveTabId]);

  // Persist session whenever tabs or active tab change
  useEffect(() => {
    if (!sessionLoaded) return;
    void window.multissh.sessionGet?.().then((current) => {
      void window.multissh.sessionSave?.({
        tabs: tabs.map(sanitizeTabForSession),
        activeTabId,
        lastPaths: current?.lastPaths || {},
        panes: current?.panes,
      });
    });
  }, [tabs, activeTabId, sessionLoaded]);

  return sessionLoaded;
}
