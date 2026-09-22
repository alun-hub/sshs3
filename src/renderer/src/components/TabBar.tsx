import React, { useState, useRef, useEffect } from 'react';
import {
  Terminal,
  Folder,
  X,
  Plus,
  Server,
  Settings,
  Unlock,
  Loader2,
  CreditCard,
  FolderSync,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import type { CachedSmartcardAgent } from '@shared/types/ssh';

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
  onOpenDirSyncProfiles?: () => void;
  /** Shown only when Settings > Security > Smartcard PIN Caching is set to 'Global (App Lifetime)'. */
  showLockSmartcardButton?: boolean;
  onLockSmartcard?: () => Promise<{ locked: number }>;
  onListCachedSmartcards?: () => Promise<CachedSmartcardAgent[]>;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onOpenProfiles,
  onOpenSettings,
  onOpenDirSyncProfiles,
  showLockSmartcardButton,
  onLockSmartcard,
  onListCachedSmartcards,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [lockingSmartcard, setLockingSmartcard] = useState(false);
  const [lockFeedback, setLockFeedback] = useState<string | null>(null);

  const [isSmartcardMenuOpen, setIsSmartcardMenuOpen] = useState(false);
  const smartcardMenuRef = useRef<HTMLDivElement>(null);
  const [cachedAgents, setCachedAgents] = useState<CachedSmartcardAgent[] | null>(null);
  const [loadingCachedAgents, setLoadingCachedAgents] = useState(false);
  const [expandedFingerprints, setExpandedFingerprints] = useState<Set<string>>(new Set());

  const formatCertDate = (isoLike: string): string => {
    const d = new Date(isoLike);
    return Number.isNaN(d.getTime()) ? isoLike : d.toLocaleDateString();
  };

  const certSubjectCN = (subject: string): string => {
    const line = subject.split('\n').find((l) => l.startsWith('CN='));
    return line ? line.slice(3) : subject;
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
      if (smartcardMenuRef.current && !smartcardMenuRef.current.contains(e.target as Node)) {
        setIsSmartcardMenuOpen(false);
      }
    };
    if (isMenuOpen || isSmartcardMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen, isSmartcardMenuOpen]);

  return (
    <>
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

      {/* Quick links: Smartcard lock, Connections & Settings */}
      <div className="flex items-center gap-1 border-l border-border-subtle pl-2">
        {showLockSmartcardButton && (
          <div className="relative flex items-center" ref={smartcardMenuRef}>
            <button
              type="button"
              data-testid="quick-lock-smartcard-btn"
              title="Cached smartcard identities"
              onClick={() => {
                const next = !isSmartcardMenuOpen;
                setIsSmartcardMenuOpen(next);
                if (next) {
                  setLoadingCachedAgents(true);
                  void onListCachedSmartcards?.()
                    .then((agents) => setCachedAgents(agents))
                    .catch(() => setCachedAgents([]))
                    .finally(() => setLoadingCachedAgents(false));
                }
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-amber-400 hover:bg-amber-500/15 hover:text-amber-300 transition-colors"
            >
              <CreditCard className="h-4 w-4" />
            </button>

            {isSmartcardMenuOpen && (
              <div className="absolute top-8 right-0 z-50 w-72 rounded-xl border border-border-subtle bg-app-card p-2.5 shadow-2xl">
                <div className="mb-1.5 text-[11px] font-semibold text-txt-primary">Cached smartcard identities</div>

                {loadingCachedAgents ? (
                  <div className="flex items-center gap-1.5 py-2 text-[11px] text-txt-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading...
                  </div>
                ) : !cachedAgents || cachedAgents.length === 0 ? (
                  <p className="py-1 text-[11px] text-txt-muted">Nothing cached — no PIN unlocked right now.</p>
                ) : (
                  <ul className="space-y-2">
                    {cachedAgents.map((agent) => (
                      <li key={agent.pkcs11LibPath}>
                        <div className="truncate font-mono text-[10px] text-txt-muted" title={agent.pkcs11LibPath}>
                          {agent.pkcs11LibPath}
                        </div>
                        {agent.identities.length === 0 ? (
                          <div className="text-[11px] text-txt-muted">(no identities reported)</div>
                        ) : (
                          <ul className="mt-0.5 space-y-0.5">
                            {agent.identities.map((id) => {
                              const isExpanded = expandedFingerprints.has(id.fingerprint);
                              return (
                                <li key={id.fingerprint}>
                                  <button
                                    type="button"
                                    disabled={!id.certificate}
                                    onClick={() =>
                                      setExpandedFingerprints((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(id.fingerprint)) next.delete(id.fingerprint);
                                        else next.add(id.fingerprint);
                                        return next;
                                      })
                                    }
                                    className="flex w-full items-center gap-1 text-left text-[11px] text-txt-primary disabled:cursor-default"
                                    title={
                                      id.certificate
                                        ? 'Show certificate details'
                                        : 'No certificate details available for this identity'
                                    }
                                  >
                                    {id.certificate ? (
                                      isExpanded ? (
                                        <ChevronDown className="h-3 w-3 shrink-0 text-txt-muted" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3 shrink-0 text-txt-muted" />
                                      )
                                    ) : (
                                      <span className="w-3 shrink-0" />
                                    )}
                                    <span className="truncate">{id.comment}</span>
                                    <span className="shrink-0 font-mono text-[10px] text-txt-muted">
                                      ({id.keyType})
                                    </span>
                                  </button>
                                  {!id.certificate && (
                                    <div className="ml-4 text-[10px] text-txt-muted/70">
                                      No certificate details found on the card
                                    </div>
                                  )}
                                  {isExpanded && id.certificate && (
                                    <dl className="ml-1 mt-0.5 space-y-0.5 border-l border-border-subtle pl-2 text-[10px] text-txt-muted">
                                      <div className="flex gap-1">
                                        <dt className="shrink-0 text-txt-muted/70">Subject:</dt>
                                        <dd className="truncate text-txt-primary" title={id.certificate.subject}>
                                          {certSubjectCN(id.certificate.subject)}
                                        </dd>
                                      </div>
                                      {id.certificate.upn && (
                                        <div className="flex gap-1">
                                          <dt className="shrink-0 text-txt-muted/70">UPN:</dt>
                                          <dd className="truncate text-txt-primary">{id.certificate.upn}</dd>
                                        </div>
                                      )}
                                      <div className="flex gap-1">
                                        <dt className="shrink-0 text-txt-muted/70">Valid:</dt>
                                        <dd className="truncate text-txt-primary">
                                          {formatCertDate(id.certificate.validFrom)} – {formatCertDate(id.certificate.validTo)}
                                        </dd>
                                      </div>
                                    </dl>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  disabled={lockingSmartcard || !cachedAgents || cachedAgents.length === 0}
                  onClick={() => {
                    setLockingSmartcard(true);
                    setLockFeedback(null);
                    void onLockSmartcard?.()
                      .then(({ locked }) => {
                        setLockFeedback(
                          locked > 0
                            ? `Smartcard cache cleared — ${locked} cached agent${locked === 1 ? '' : 's'} locked`
                            : 'No cached smartcard agents to clear'
                        );
                        setCachedAgents([]);
                        setIsSmartcardMenuOpen(false);
                      })
                      .finally(() => {
                        setLockingSmartcard(false);
                        setTimeout(() => setLockFeedback(null), 4000);
                      });
                  }}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                >
                  {lockingSmartcard ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5" />
                  )}
                  Lock All Now
                </button>
              </div>
            )}
          </div>
        )}
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
          data-testid="quick-dirsync-profiles-btn"
          title="Katalogsynkronisering: sparade profiler"
          onClick={onOpenDirSyncProfiles}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <FolderSync className="h-4 w-4" />
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

    {lockFeedback && (
      <div
        data-testid="lock-smartcard-toast"
        role="status"
        className="fixed top-12 right-3 z-50 flex w-full max-w-xs items-center gap-1.5 rounded-lg border border-amber-500/30 bg-app-card px-3 py-2 text-[11px] text-amber-300 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150"
      >
        <Unlock className="h-3.5 w-3.5 shrink-0" />
        {lockFeedback}
      </div>
    )}
    </>
  );
};

export default TabBar;
