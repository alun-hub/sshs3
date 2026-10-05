import React, { useEffect, useRef } from 'react';
import { Clock, Cloud, Folder, Plus, Server, Terminal } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { SftpButton } from './SftpButton';
import { Kbd } from './ui/Kbd';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { TabType } from './TabBar';
import { FOCUSABLE_OVERLAY_SELECTOR, isElementVisible, navigateInOverlay, type NavigationDirection } from '../lib/spatialNavigation';

export interface LandingViewProps {
  recentSSH: SSHConnectionConfig[];
  onConnectRecentSSH: (profile: SSHConnectionConfig) => void;
  onConnectSFTP: (profile: SSHConnectionConfig) => void;
  onQuickStartTerminal: () => void;
  onNewTab: (type: TabType) => void;
  onOpenProfiles: () => void;
  onNewProfile: () => void;
  onOpenSyncBootstrap: () => void;
  onNavigateToTabBar: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({
  recentSSH,
  onConnectRecentSSH,
  onConnectSFTP,
  onQuickStartTerminal,
  onNewTab,
  onOpenProfiles,
  onNewProfile,
  onOpenSyncBootstrap,
  onNavigateToTabBar,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-focus the first actionable element on mount so keyboard navigation is immediately active
  useEffect(() => {
    const timer = setTimeout(() => {
      const firstBtn = containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_OVERLAY_SELECTOR);
      firstBtn?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir: NavigationDirection =
        e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowLeft' ? 'left' : 'right';

      if (dir === 'up' && containerRef.current) {
        const candidates = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_OVERLAY_SELECTOR)
        ).filter(isElementVisible);
        const active = document.activeElement as HTMLElement | null;

        // If the topmost element is already focused, jumping up moves to TabBar
        if (active && candidates.length > 0 && onNavigateToTabBar) {
          if (candidates[0] === active) {
            onNavigateToTabBar();
            return;
          }
          if (candidates[1] === active && candidates[0]?.closest?.('.recent-card') === candidates[1]?.closest?.('.recent-card')) {
            onNavigateToTabBar();
            return;
          }
        }
      }

      if (containerRef.current) {
        navigateInOverlay(containerRef.current, dir);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onNavigateToTabBar();
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="landing-view"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="flex flex-1 flex-col items-center justify-center p-6 text-txt-secondary animate-in fade-in duration-200 outline-none"
    >
      <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center space-y-3">
          <BrandLogo className={recentSSH.length > 0 ? 'h-20 w-auto' : 'h-32 w-auto'} />
          <h1
            className={
              recentSSH.length > 0
                ? 'text-base font-bold tracking-tight'
                : 'text-3xl font-extrabold tracking-tight'
            }
          >
            <span className="text-txt-primary">ssh</span>
            <span className="text-brand-s3">S3</span>
          </h1>
          {recentSSH.length === 0 && (
            <p className="text-xs text-txt-muted max-w-md">
              Multi-session SSH & SFTP client with dual-pane file management, Kubernetes support and cloud sync.
            </p>
          )}
        </div>

        {/* Recent Connections */}
        {recentSSH.length > 0 && (
          <div className="w-full rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5 text-left">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-400">
              <Clock className="h-3.5 w-3.5" />
              <span>Recent Connections</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {recentSSH.map((profile) => (
                <div
                  key={profile.id}
                  className="recent-card flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-card px-3 py-1.5 hover:border-border-strong transition-colors"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-txt-primary">{profile.name}</div>
                    <div className="truncate text-xs text-txt-muted">
                      {profile.username}@{profile.host}:{profile.port ?? 22}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`recent-connect-${profile.id}`}
                      onClick={() => onConnectRecentSSH(profile)}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                    >
                      Connect
                    </button>
                    <SftpButton authType={profile.authType} onOpen={() => onConnectSFTP(profile)} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Cards */}
        {recentSSH.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(122px,1fr))] gap-2 w-full text-left">
            <button
              type="button"
              data-testid="landing-new-terminal-btn"
              onClick={onQuickStartTerminal}
              className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2 py-2 hover:border-sky-500/40 hover:bg-app-surface-hover transition-all"
            >
              <Terminal className="h-4 w-4 text-sky-400 shrink-0" />
              <span className="truncate text-xs font-medium text-txt-primary">New Terminal</span>
            </button>
            <button
              type="button"
              data-testid="landing-file-manager-btn"
              onClick={() => onNewTab('filemanager')}
              className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2 py-2 hover:border-amber-500/40 hover:bg-app-surface-hover transition-all"
            >
              <Folder className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="truncate text-xs font-medium text-txt-primary">File Manager</span>
            </button>
            <button
              type="button"
              data-testid="landing-connections-btn"
              onClick={onOpenProfiles}
              className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2 py-2 hover:border-emerald-500/40 hover:bg-app-surface-hover transition-all"
            >
              <Server className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="truncate text-xs font-medium text-txt-primary">Connections</span>
            </button>
            <button
              type="button"
              data-testid="landing-cloud-sync-btn"
              onClick={onOpenSyncBootstrap}
              className="flex items-center gap-2 rounded-lg border border-border-subtle bg-app-card px-2 py-2 hover:border-purple-500/40 hover:bg-app-surface-hover transition-all"
            >
              <Cloud className="h-4 w-4 text-purple-400 shrink-0" />
              <span className="truncate text-xs font-medium text-txt-primary">Cloud Sync</span>
            </button>
            <button
              type="button"
              data-testid="landing-new-profile-btn"
              onClick={onNewProfile}
              className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-2 hover:bg-sky-500/20 transition-all"
            >
              <Plus className="h-4 w-4 text-sky-400 shrink-0" />
              <span className="truncate text-xs font-medium text-txt-primary">New Profile</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
            <button
              type="button"
              data-testid="landing-new-terminal-btn"
              onClick={onQuickStartTerminal}
              className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-sky-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
            >
              <div className="flex items-start justify-between w-full">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 group-hover:bg-sky-500/25 group-hover:scale-105 transition-all">
                  <Terminal className="h-5 w-5" />
                </div>
                <Kbd>Ctrl+Shift+T</Kbd>
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold text-txt-primary group-hover:text-sky-400 transition-colors">
                  Open New Terminal
                </div>
                <div className="text-xs text-txt-muted mt-0.5">
                  Launch a local shell — pick a saved connection or type user@host for SSH
                </div>
              </div>
            </button>

            <button
              type="button"
              data-testid="landing-file-manager-btn"
              onClick={() => onNewTab('filemanager')}
              className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-amber-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
            >
              <div className="flex items-start justify-between w-full">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 group-hover:bg-amber-500/25 group-hover:scale-105 transition-all">
                  <Folder className="h-5 w-5" />
                </div>
                <Kbd>Ctrl+Shift+F</Kbd>
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold text-txt-primary group-hover:text-amber-400 transition-colors">
                  New File Manager
                </div>
                <div className="text-xs text-txt-muted mt-0.5">
                  Dual-pane explorer for SFTP, S3 and local drives
                </div>
              </div>
            </button>

            <button
              type="button"
              data-testid="landing-connections-btn"
              onClick={onOpenProfiles}
              className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-emerald-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
            >
              <div className="flex items-start justify-between w-full">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 group-hover:bg-emerald-500/25 group-hover:scale-105 transition-all">
                  <Server className="h-5 w-5" />
                </div>
                <Kbd>Ctrl+Shift+P</Kbd>
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold text-txt-primary group-hover:text-emerald-400 transition-colors">
                  Saved Connections
                </div>
                <div className="text-xs text-txt-muted mt-0.5">
                  Manage profiles, SSH keys and credentials
                </div>
              </div>
            </button>

            <button
              type="button"
              data-testid="landing-cloud-sync-btn"
              onClick={onOpenSyncBootstrap}
              className="group flex flex-col justify-between rounded-xl border border-border-subtle bg-app-card p-4 hover:border-purple-500/40 hover:bg-app-surface-hover transition-all shadow-sm"
            >
              <div className="flex items-start justify-between w-full">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/15 text-purple-400 group-hover:bg-purple-500/25 group-hover:scale-105 transition-all">
                  <Cloud className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold text-txt-primary group-hover:text-purple-400 transition-colors">
                  Encrypted Cloud Sync
                </div>
                <div className="text-xs text-txt-muted mt-0.5">
                  Sync connection profiles and dotfiles across your devices
                </div>
              </div>
            </button>

            <button
              type="button"
              data-testid="landing-new-profile-btn"
              onClick={onNewProfile}
              className="sm:col-span-2 flex items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-xs font-semibold text-txt-primary hover:bg-sky-500/20 transition-all"
            >
              <Plus className="h-4 w-4 text-sky-400" />
              New Profile
            </button>
          </div>
        )}

        {/* Keyboard hints footer */}
        <div className="pt-4 text-2xs text-txt-muted flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <span><Kbd variant="plain">Ctrl+Tab</Kbd> Cycle tabs</span>
          <span><Kbd variant="plain">Ctrl+W</Kbd> Close tab</span>
          <span><Kbd variant="plain">Ctrl+,</Kbd> Settings</span>
        </div>
      </div>
    </div>
  );
};
