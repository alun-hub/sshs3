import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Folder, X, Plus, Server, Settings } from 'lucide-react';

export type TabType = 'terminal' | 'filemanager';

export interface TabItem {
  id: string;
  type: TabType;
  title: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (type: TabType) => void;
  onOpenProfiles?: () => void;
  onOpenSettings?: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onOpenProfiles,
  onOpenSettings,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex h-10 w-full items-center border-b border-border-subtle bg-app-surface px-2 select-none"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              data-testid={`tab-${tab.id}`}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
              className={`group relative flex h-8 max-w-[220px] min-w-[120px] cursor-pointer items-center justify-between rounded-t-lg px-3 text-xs transition-colors ${
                isActive
                  ? 'bg-app-card text-txt-primary font-medium border-t-2 border-sky-500 shadow-sm'
                  : 'bg-app-surface text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                {tab.type === 'terminal' ? (
                  <Terminal
                    className={`h-3.5 w-3.5 flex-shrink-0 ${
                      isActive ? 'text-sky-400' : 'text-txt-muted group-hover:text-txt-secondary'
                    }`}
                    data-testid={`tab-icon-${tab.id}`}
                  />
                ) : (
                  <Folder
                    className={`h-3.5 w-3.5 flex-shrink-0 ${
                      isActive ? 'text-amber-400' : 'text-txt-muted group-hover:text-txt-secondary'
                    }`}
                    data-testid={`tab-icon-${tab.id}`}
                  />
                )}
                <span className="truncate">{tab.title}</span>
              </div>

              <button
                type="button"
                aria-label={`Close tab ${tab.title}`}
                data-testid={`close-tab-${tab.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id);
                }}
                className="ml-2 rounded p-0.5 text-txt-muted opacity-60 hover:bg-app-surface-hover hover:text-txt-primary hover:opacity-100 transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* New Tab Button & Dropdown */}
      <div className="relative flex shrink-0 items-center" ref={menuRef}>
        <button
          type="button"
          data-testid="add-tab-btn"
          title="Open new tab"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>

        {isMenuOpen && (
          <div className="absolute top-8 right-0 z-50 min-w-[160px] whitespace-nowrap rounded-xl border border-border-subtle bg-app-card p-1 shadow-2xl">
            <button
              type="button"
              data-testid="new-terminal-btn"
              onClick={() => {
                setIsMenuOpen(false);
                onNewTab('terminal');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-txt-primary hover:bg-app-surface-hover transition-colors"
            >
              <Terminal className="h-3.5 w-3.5 text-sky-400" />
              <span>New Terminal</span>
            </button>
            <button
              type="button"
              data-testid="new-filemanager-btn"
              onClick={() => {
                setIsMenuOpen(false);
                onNewTab('filemanager');
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-txt-primary hover:bg-app-surface-hover transition-colors"
            >
              <Folder className="h-3.5 w-3.5 text-amber-400" />
              <span>New File Manager</span>
            </button>
          </div>
        )}
      </div>

      {/* Quick links: Connections & Settings */}
      <div className="flex items-center gap-1 border-l border-border-subtle pl-2">
        <button
          type="button"
          data-testid="quick-profiles-btn"
          title="Connections & Profiles (Ctrl+Shift+O)"
          onClick={onOpenProfiles}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <Server className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="quick-settings-btn"
          title="Settings (Ctrl+,)"
          onClick={onOpenSettings}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TabBar;
