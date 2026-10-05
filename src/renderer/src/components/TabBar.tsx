import React, { useState, useRef, useEffect } from 'react';
import { pkcs11LibDisplayName, looksLikeLibraryPath } from '../lib/smartcard';
import {
  Terminal,
  Folder,
  X,
  Plus,
  Server,
  Settings,
  Unlock,
  Lock,
  KeyRound,
  Loader2,
  CreditCard,
  FolderSync,
  ChevronRight,
  ChevronDown,
  Boxes,
  Cable,
} from 'lucide-react';
import type { CachedSmartcardAgent, SSHActiveTunnel } from '@shared/types/ssh';
import { Kbd } from './ui/Kbd';

export type TabType = 'terminal' | 'filemanager';

export interface TabItem {
  id: string;
  type: TabType;
  title: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string;
  tabBarFocused?: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: (type: TabType) => void;
  /** Opens the Connection Manager directly on the Kubernetes tab, for picking a pod/container to exec into or follow logs from. */
  onNewK8sSession?: () => void;
  onOpenProfiles?: () => void;
  onOpenSettings?: () => void;
  onOpenDirSyncProfiles?: () => void;
  onOpenTunnels?: () => void;
  /** Shown only when Settings > Security > Smartcard PIN Caching is set to 'Global (App Lifetime)'. */
  showLockSmartcardButton?: boolean;
  onLockSmartcard?: () => Promise<{ locked: number }>;
  /** Unlocks the cards/keys that aren't cached yet (prompts for the PIN); resolves once detection has decided whether anything was started. */
  onUnlockSmartcard?: () => Promise<{ started: boolean }>;
  onListCachedSmartcards?: () => Promise<CachedSmartcardAgent[]>;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  tabBarFocused = false,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onNewK8sSession,
  onOpenProfiles,
  onOpenSettings,
  onOpenDirSyncProfiles,
  onOpenTunnels,
  showLockSmartcardButton,
  onLockSmartcard,
  onUnlockSmartcard,
  onListCachedSmartcards,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [lockingSmartcard, setLockingSmartcard] = useState(false);
  const [unlockingSmartcard, setUnlockingSmartcard] = useState(false);
  const [lockFeedback, setLockFeedback] = useState<string | null>(null);

  const [isSmartcardMenuOpen, setIsSmartcardMenuOpen] = useState(false);
  const smartcardMenuRef = useRef<HTMLDivElement>(null);
  const smartcardButtonRef = useRef<HTMLButtonElement>(null);
  const [cachedAgents, setCachedAgents] = useState<CachedSmartcardAgent[] | null>(null);
  const [loadingCachedAgents, setLoadingCachedAgents] = useState(false);
  const [expandedFingerprints, setExpandedFingerprints] = useState<Set<string>>(new Set());
  const [activeTunnels, setActiveTunnels] = useState<SSHActiveTunnel[]>([]);

  useEffect(() => {
    // Optional chaining (LOW finding pattern already used elsewhere in this file, see the
    // comment above <TabBar> in App.tsx): degrade to "no tunnel indicator" instead of
    // crashing the whole tab bar if the preload bridge is somehow missing or incomplete
    // (e.g. an older/mocked window.multissh in tests).
    window.multissh
      ?.sshTunnelList?.()
      ?.then(setActiveTunnels)
      ?.catch(() => {});
    const unsubscribe = window.multissh?.onSshTunnelEvent?.(setActiveTunnels);
    return () => unsubscribe?.();
  }, []);

  const liveTunnelCount = activeTunnels.filter((t) => t.status === 'active').length;
  const erroredTunnelCount = activeTunnels.filter((t) => t.status === 'error').length;

  const formatCertDate = (isoLike: string): string => {
    const d = new Date(isoLike);
    return Number.isNaN(d.getTime()) ? isoLike : d.toLocaleDateString();
  };

  const certSubjectCN = (subject: string): string => {
    const line = subject.split('\n').find((l) => l.startsWith('CN='));
    return line ? line.slice(3) : subject;
  };

  const smartcardLibFriendlyName = pkcs11LibDisplayName;

  // On Windows ssh-add labels a PKCS#11 key with the module's file path, which is noise in this list: for
  // those (and only those) lead with the certificate's name when we have one, otherwise the driver's friendly
  // name. A real label (what Linux shows) is left exactly as it was.
  const identityLabel = (id: { comment: string; certificate?: { subject: string } | null }): string => {
    if (!looksLikeLibraryPath(id.comment)) return id.comment;
    return id.certificate ? certSubjectCN(id.certificate.subject) : pkcs11LibDisplayName(id.comment);
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMenuOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsMenuOpen(false);
          menuButtonRef.current?.focus();
        } else if (isSmartcardMenuOpen) {
          e.preventDefault();
          e.stopPropagation();
          setIsSmartcardMenuOpen(false);
          smartcardButtonRef.current?.focus();
        }
      }
    };
    if (isMenuOpen || isSmartcardMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen, isSmartcardMenuOpen]);

  return (
    <>
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex h-full w-full items-end bg-app-surface px-2 select-none"
    >
      <div className="flex min-w-0 flex-1 items-end gap-1 self-stretch overflow-x-auto no-scrollbar">
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
              className={`group relative flex max-w-[220px] min-w-[120px] cursor-pointer items-center justify-between rounded-t-lg px-3 text-xs transition-colors ${
                isActive
                  ? `z-10 h-[34px] bg-app-card text-txt-primary font-medium border-t-2 border-sky-500 shadow-sm ${
                      tabBarFocused ? 'ring-2 ring-sky-400 ring-inset shadow-md font-semibold' : ''
                    }`
                  : 'h-[30px] bg-app-surface text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary'
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
      <div className="relative flex shrink-0 items-center self-center" ref={menuRef}>
        <button
          ref={menuButtonRef}
          type="button"
          data-testid="add-tab-btn"
          title="Open new tab"
          aria-label="Open new tab"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          onClick={() => setIsMenuOpen((prev) => !prev)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>

        {isMenuOpen && (
          <div role="menu" className="absolute top-8 right-0 z-50 min-w-[210px] whitespace-nowrap rounded-xl border border-border-subtle bg-app-card p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-100">
            <button
              role="menuitem"
              type="button"
              data-testid="new-terminal-btn"
              onClick={() => {
                setIsMenuOpen(false);
                onNewTab('terminal');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs text-txt-primary hover:bg-app-surface-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-sky-400" />
                <span>New Terminal</span>
              </div>
              <Kbd>Ctrl+Shift+T</Kbd>
            </button>
            <button
              role="menuitem"
              type="button"
              data-testid="new-filemanager-btn"
              onClick={() => {
                setIsMenuOpen(false);
                onNewTab('filemanager');
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs text-txt-primary hover:bg-app-surface-hover transition-colors"
            >
              <div className="flex items-center gap-2">
                <Folder className="h-3.5 w-3.5 text-amber-400" />
                <span>New File Manager</span>
              </div>
              <Kbd>Ctrl+Shift+F</Kbd>
            </button>
            {onNewK8sSession && (
              <button
                role="menuitem"
                type="button"
                data-testid="new-k8s-btn"
                onClick={() => {
                  setIsMenuOpen(false);
                  onNewK8sSession();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-txt-primary hover:bg-app-surface-hover transition-colors"
              >
                <Boxes className="h-3.5 w-3.5 text-emerald-400" />
                <span>New Kubernetes Session</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick links: Smartcard lock, Connections & Settings */}
      <div className="flex items-center gap-1 self-center border-l border-divider pl-2">
        {showLockSmartcardButton && (
          <div className="relative flex items-center" ref={smartcardMenuRef}>
            <button
              ref={smartcardButtonRef}
              type="button"
              data-testid="quick-lock-smartcard-btn"
              title="Cached smartcard identities"
              aria-label="Cached smartcard identities"
              aria-haspopup="menu"
              aria-expanded={isSmartcardMenuOpen}
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
              className="flex h-6 w-6 items-center justify-center rounded-md text-amber-400 hover:bg-amber-500/15 hover:text-amber-300 transition-colors"
            >
              <CreditCard className="h-4 w-4" />
            </button>

            {isSmartcardMenuOpen && (
              <div role="menu" className="absolute top-8 right-0 z-50 w-72 rounded-xl border border-border-subtle bg-app-card p-2.5 shadow-2xl">
                <div className="mb-1.5 text-xs font-semibold text-txt-primary">Cached smartcard identities</div>

                {loadingCachedAgents ? (
                  <div className="flex items-center gap-1.5 py-2 text-xs text-txt-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading...
                  </div>
                ) : !cachedAgents || cachedAgents.length === 0 ? (
                  <p className="py-1 text-xs text-txt-muted">Nothing cached — no PIN unlocked right now.</p>
                ) : (
                  <ul className="space-y-2">
                    {cachedAgents.map((agent) => (
                      <li key={agent.pkcs11LibPath}>
                        {/* UX audit finding #13: this used to show the raw PKCS#11 library
                            path (e.g. "/usr/lib64/p11-kit-proxy.so") as the primary label —
                            meaningful to someone debugging a smartcard driver, opaque to
                            everyone else. The friendly name leads; the path is one hover away. */}
                        <div
                          className="truncate text-xs font-medium text-txt-primary"
                          title={agent.pkcs11LibPath || undefined}
                        >
                          {smartcardLibFriendlyName(agent.pkcs11LibPath)}
                        </div>
                        {agent.identities.length === 0 ? (
                          <div className="text-xs text-txt-muted">(no identities reported)</div>
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
                                    className="flex w-full items-center gap-1 text-left text-xs text-txt-primary disabled:cursor-default"
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
                                    <span className="truncate" title={id.comment}>
                                      {identityLabel(id)}
                                    </span>
                                    <span className="shrink-0 font-mono text-2xs text-txt-muted">
                                      ({id.keyType})
                                    </span>
                                  </button>
                                  {!id.certificate && (
                                    <div className="ml-4 text-2xs text-txt-muted/70">
                                      No certificate details found on the card
                                    </div>
                                  )}
                                  {isExpanded && id.certificate && (
                                    <dl className="ml-1 mt-0.5 space-y-0.5 border-l border-divider pl-2 text-2xs text-txt-muted">
                                      <div className="flex gap-1">
                                        <dt className="shrink-0 text-txt-muted/70">Subject:</dt>
                                        <dd className="truncate select-text text-txt-primary" title={id.certificate.subject}>
                                          {certSubjectCN(id.certificate.subject)}
                                        </dd>
                                      </div>
                                      {id.certificate.upn && (
                                        <div className="flex gap-1">
                                          <dt className="shrink-0 text-txt-muted/70">UPN:</dt>
                                          <dd className="truncate select-text text-txt-primary">{id.certificate.upn}</dd>
                                        </div>
                                      )}
                                      <div className="flex gap-1">
                                        <dt className="shrink-0 text-txt-muted/70">Valid:</dt>
                                        <dd className="truncate select-text text-txt-primary">
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

                {/* One toggle: Lock while something is unlocked, Unlock when nothing is. */}
                {cachedAgents && cachedAgents.length === 0 && onUnlockSmartcard && (
                  <button
                    type="button"
                    data-testid="smartcard-unlock-now-btn"
                    disabled={unlockingSmartcard}
                    onClick={() => {
                      setUnlockingSmartcard(true);
                      setLockFeedback(null);
                      void onUnlockSmartcard()
                        .then(({ started }) => {
                          setLockFeedback(
                            started
                              ? 'Unlocking — enter your PIN when asked'
                              : 'Nothing to unlock: no smartcard or security key detected, or already unlocked'
                          );
                          setIsSmartcardMenuOpen(false);
                        })
                        .catch(() => setLockFeedback('Could not start the unlock'))
                        .finally(() => {
                          setUnlockingSmartcard(false);
                          setTimeout(() => setLockFeedback(null), 4000);
                        });
                    }}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors disabled:opacity-40"
                  >
                    {unlockingSmartcard ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                    Unlock Now
                  </button>
                )}

                {cachedAgents && cachedAgents.length > 0 && (
                  <button
                    type="button"
                    data-testid="smartcard-lock-all-btn"
                    disabled={lockingSmartcard}
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
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                  >
                    {lockingSmartcard ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Lock className="h-3.5 w-3.5" />
                    )}
                    Lock All Now
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          data-testid="quick-profiles-btn"
          title="Connections & Profiles (Ctrl+Shift+O)"
          aria-label="Connections & Profiles"
          onClick={onOpenProfiles}
          className="flex h-6 w-6 items-center justify-center rounded-md text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <Server className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="quick-tunnels-btn"
          title={
            liveTunnelCount > 0
              ? `SSH Tunnels (${liveTunnelCount} active)`
              : erroredTunnelCount > 0
                ? `SSH Tunnels (${erroredTunnelCount} failed)`
                : 'SSH Tunnels'
          }
          aria-label="SSH Tunnels"
          onClick={onOpenTunnels}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-app-surface-hover ${
            erroredTunnelCount > 0
              ? 'text-rose-400 hover:text-rose-300'
              : liveTunnelCount > 0
                ? 'text-emerald-400 hover:text-emerald-300'
                : 'text-txt-muted hover:text-txt-primary'
          }`}
        >
          <Cable className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="quick-dirsync-profiles-btn"
          title="Directory Sync: Saved Profiles"
          aria-label="Directory Sync: Saved Profiles"
          onClick={onOpenDirSyncProfiles}
          className="flex h-6 w-6 items-center justify-center rounded-md text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <FolderSync className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-testid="quick-settings-btn"
          title="Settings (Ctrl+,)"
          aria-label="Settings"
          onClick={onOpenSettings}
          className="flex h-6 w-6 items-center justify-center rounded-md text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </div>

    {lockFeedback && (
      <div
        data-testid="lock-smartcard-toast"
        role="status"
        className="fixed top-12 right-3 z-[60] flex w-full max-w-xs items-center gap-1.5 rounded-lg border border-amber-500/30 bg-app-card px-3 py-2 text-xs text-amber-300 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150"
      >
        <Unlock className="h-3.5 w-3.5 shrink-0" />
        {lockFeedback}
      </div>
    )}
    </>
  );
};

export default TabBar;
