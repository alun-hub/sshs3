import React from 'react';
import { Boxes, Cloud, Server } from 'lucide-react';
import { nextTabIndex } from '../../lib/rovingNavigation';
import type { Tab } from './types';
import { protocolPanelId, protocolTabId } from './connectionTabIds';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'ssh', label: 'SSH / SFTP', icon: Server },
  { key: 's3', label: 'S3 Object Storage', icon: Cloud },
  { key: 'k8s', label: 'Kubernetes', icon: Boxes },
];

interface ConnectionTabsProps {
  tab: Tab;
  /** Prefix of the DOM ids that link each tab to the panel below it (see `connectionTabIds`). */
  idPrefix: string;
  /** Called when a tab is chosen (click, Enter or Space); moving focus with the arrow keys does not choose. */
  onSelect: (tab: Tab) => void;
}

/**
 * The connection type tabs of the Connection Manager (SSH / SFTP, S3, Kubernetes) as an ARIA tablist: the chosen
 * tab is exposed with `aria-selected`, and only it is in the Tab order. The arrow keys, Home and End move focus
 * between the tabs without choosing one. Choosing a tab discards a profile form that is being edited, so an arrow
 * key pressed in passing must not do it; Enter, Space or a click chooses.
 */
export const ConnectionTabs: React.FC<ConnectionTabsProps> = ({ tab, idPrefix, onSelect }) => (
  <div
    role="tablist"
    aria-label="Connection type"
    onKeyDown={(e) => {
      // Ctrl+Shift+Arrow is the app's spatial navigation and belongs to it.
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
      const current = tabs.indexOf(e.target as HTMLElement);
      if (current < 0) return;
      const next = nextTabIndex(tabs.length, current, e.key);
      if (next === null) return;
      e.preventDefault();
      tabs[next].focus();
    }}
    className="flex border-b border-divider bg-app-surface px-2 pt-2"
  >
    {TABS.map(({ key, label, icon: Icon }) => (
      <button
        key={key}
        type="button"
        role="tab"
        id={protocolTabId(idPrefix, key)}
        aria-selected={tab === key}
        aria-controls={protocolPanelId(idPrefix)}
        tabIndex={tab === key ? 0 : -1}
        onClick={() => onSelect(key)}
        className={
          'flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-medium transition-colors ' +
          (tab === key
            ? 'bg-app-card text-sky-400 border-t-2 border-sky-500 font-semibold'
            : 'text-txt-muted hover:text-txt-primary hover:bg-app-surface-hover')
        }
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
    ))}
  </div>
);
