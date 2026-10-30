import React from 'react';
import { Search } from 'lucide-react';
import { getShortcutKeys } from '../lib/shortcuts';
import { Shortcut } from './ui/Shortcut';

interface GlobalSearchButtonProps {
  onOpen: () => void;
  shortcuts: Record<string, string> | undefined;
}

/**
 * The top bar's search entry. Wide windows show icon, "Search" and the shortcut, medium ones icon and
 * shortcut, narrow ones only the icon, so the tabs keep the room. The label goes before the shortcut
 * because the shortcut is what teaches the key; the tooltip always says what is searched.
 */
export const GlobalSearchButton: React.FC<GlobalSearchButtonProps> = ({ onOpen, shortcuts }) => (
  <button
    type="button"
    data-testid="global-search-btn"
    aria-label="Search profiles, tabs and hosts"
    title={`Search profiles, tabs and hosts (${getShortcutKeys('globalSearch', shortcuts)})`}
    onClick={onOpen}
    className="flex h-6 shrink-0 items-center gap-1.5 self-center rounded-md border border-border-subtle bg-app-input px-1.5 text-txt-muted transition-colors hover:border-sky-500 hover:text-txt-primary xl:w-48"
  >
    <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span className="hidden flex-1 truncate text-left text-xs xl:inline" aria-hidden="true">
      Search
    </span>
    <Shortcut id="globalSearch" shortcuts={shortcuts} className="hidden lg:inline-block" />
  </button>
);
