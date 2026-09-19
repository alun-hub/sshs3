import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Folder,
  Loader2,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { S3Config } from '@shared/types/storage';
import { SSHProfileForm } from './SSHProfileForm';
import { S3ProfileForm } from './S3ProfileForm';
import { formatDateTime } from '../../lib/format';

type Tab = 'ssh' | 's3';

interface ConnectionManagerModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  /** When set, shows a "Connect" action per profile and invokes this instead of only managing profiles. */
  onConnectSSH?: (config: SSHConnectionConfig) => void;
  onConnectS3?: (config: S3Config) => void;
  /** Master switch from Settings > Files & Storage. Off by default; hides the dotfiles pool field in the SSH form. */
  dotfilesPoolEnabled?: boolean;
}

export const ConnectionManagerModal: React.FC<ConnectionManagerModalProps> = ({
  open,
  onClose,
  initialTab = 'ssh',
  onConnectSSH,
  onConnectS3,
  dotfilesPoolEnabled = false,
}) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sshProfiles, setSshProfiles] = useState<SSHConnectionConfig[]>([]);
  const [s3Profiles, setS3Profiles] = useState<S3Config[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ type: Tab; config?: SSHConnectionConfig | S3Config } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profiles = await window.multissh.profilesGet();
      setSshProfiles(profiles.ssh);
      setS3Profiles(profiles.s3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setEditing(null);
      setSearchQuery('');
      void load();
    }
  }, [open, initialTab, load]);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const handleConnectSSH = async (profile: SSHConnectionConfig) => {
    const updated = { ...profile, lastUsedAt: formatDateTime(new Date()) };
    try {
      await window.multissh.profilesSaveSSH(updated);
    } catch {
      // Safe to proceed even if touch fails
    }
    onConnectSSH?.(updated);
  };

  const handleConnectS3 = async (profile: S3Config) => {
    const updated = { ...profile, lastUsedAt: formatDateTime(new Date()) };
    try {
      await window.multissh.profilesSaveS3(updated);
    } catch {
      // Safe to proceed even if touch fails
    }
    onConnectS3?.(updated);
  };

  const handleSaveSSH = async (config: SSHConnectionConfig) => {
    try {
      await window.multissh.profilesSaveSSH(config);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    }
  };

  const handleSaveS3 = async (config: S3Config) => {
    try {
      await window.multissh.profilesSaveS3(config);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    }
  };

  const handleDeleteSSH = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this profile?')) return;
    try {
      await window.multissh.profilesDeleteSSH(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };

  const handleDeleteS3 = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this profile?')) return;
    try {
      await window.multissh.profilesDeleteS3(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete profile');
    }
  };

  const query = searchQuery.trim().toLowerCase();

  const filteredSSH = useMemo(() => {
    if (!query) return sshProfiles;
    return sshProfiles.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.host.toLowerCase().includes(query) ||
        p.username.toLowerCase().includes(query) ||
        (p.group && p.group.toLowerCase().includes(query))
    );
  }, [sshProfiles, query]);

  const filteredS3 = useMemo(() => {
    if (!query) return s3Profiles;
    return s3Profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.endpoint && p.endpoint.toLowerCase().includes(query)) ||
        (p.region && p.region.toLowerCase().includes(query)) ||
        (p.initialPath && p.initialPath.toLowerCase().includes(query)) ||
        (p.group && p.group.toLowerCase().includes(query))
    );
  }, [s3Profiles, query]);

  // Grouped profiles: group name -> profiles
  const groupedSSH = useMemo(() => {
    const groups: Record<string, SSHConnectionConfig[]> = {};
    const ungroupedKey = 'Ungrouped';
    for (const p of filteredSSH) {
      const g = p.group?.trim() || ungroupedKey;
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === ungroupedKey) return 1;
      if (b === ungroupedKey) return -1;
      return a.localeCompare(b);
    });
  }, [filteredSSH]);

  const groupedS3 = useMemo(() => {
    const groups: Record<string, S3Config[]> = {};
    const ungroupedKey = 'Ungrouped';
    for (const p of filteredS3) {
      const g = p.group?.trim() || ungroupedKey;
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === ungroupedKey) return 1;
      if (b === ungroupedKey) return -1;
      return a.localeCompare(b);
    });
  }, [filteredS3]);

  // Top 3 recently used
  const recentSSH = useMemo(() => {
    return [...sshProfiles]
      .filter((p) => Boolean(p.lastUsedAt))
      .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
      .slice(0, 3);
  }, [sshProfiles]);

  const recentS3 = useMemo(() => {
    return [...s3Profiles]
      .filter((p) => Boolean(p.lastUsedAt))
      .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
      .slice(0, 3);
  }, [s3Profiles]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-txt-primary">Connection Manager</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-border-subtle bg-app-surface px-2 pt-2">
          {(
            [
              { key: 'ssh' as Tab, label: 'SSH / SFTP', icon: Server },
              { key: 's3' as Tab, label: 'S3 Object Storage', icon: Cloud },
            ]
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setEditing(null);
              }}
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

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {editing ? (
            editing.type === 'ssh' ? (
              <SSHProfileForm
                initial={editing.config as SSHConnectionConfig | undefined}
                onSave={handleSaveSSH}
                onCancel={() => setEditing(null)}
                dotfilesPoolEnabled={dotfilesPoolEnabled}
              />
            ) : (
              <S3ProfileForm
                initial={editing.config as S3Config | undefined}
                onSave={handleSaveS3}
                onCancel={() => setEditing(null)}
              />
            )
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-txt-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search profiles or folders..."
                    className="w-full rounded-lg border border-border-subtle bg-app-input py-1.5 pl-8 pr-3 text-xs text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setEditing({ type: tab })}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shrink-0 shadow-sm transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Profile
                </button>
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-txt-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading profiles...
                </div>
              )}

              {!loading && tab === 'ssh' && (
                <div className="space-y-4">
                  {/* Recently Used SSH Profiles */}
                  {!query && recentSSH.length > 0 && (
                    <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Recently Used</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {recentSSH.map((profile) => (
                          <div
                            key={`recent-${profile.id}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium text-txt-primary">{profile.name}</span>
                                {profile.forwardAgent && (
                                  <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[10px] text-amber-400">
                                    Agent Fwd
                                  </span>
                                )}
                                {profile.group && (
                                  <span className="rounded bg-app-surface-subtle border border-border-subtle px-1.5 py-0.5 text-[10px] text-txt-muted">
                                    {profile.group}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-txt-muted">
                                {profile.username}@{profile.host}:{profile.port ?? 22} · Last connected:{' '}
                                {profile.lastUsedAt}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {onConnectSSH && (
                                <button
                                  type="button"
                                  onClick={() => void handleConnectSSH(profile)}
                                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                >
                                  Connect
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grouped SSH Profiles */}
                  {filteredSSH.length === 0 ? (
                    <p className="py-6 text-center text-sm text-txt-muted">
                      {query ? 'No profiles matched your search' : 'No SSH profiles yet'}
                    </p>
                  ) : (
                    groupedSSH.map(([groupName, profiles]) => {
                      const isCollapsed = Boolean(collapsedGroups[`ssh-${groupName}`]);
                      return (
                        <div key={`group-${groupName}`} className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(`ssh-${groupName}`)}
                            className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs font-semibold text-txt-secondary hover:bg-app-surface-hover transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
                              )}
                              <Folder className="h-3.5 w-3.5 text-amber-400" />
                              <span>{groupName}</span>
                              <span className="rounded-full bg-app-surface px-1.5 py-0.2 text-[10px] text-txt-muted">
                                {profiles.length}
                              </span>
                            </div>
                          </button>

                          {!isCollapsed && (
                            <div className="flex flex-col gap-1.5 pl-2">
                              {profiles.map((profile) => (
                                <div
                                  key={profile.id}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate text-sm text-txt-primary font-medium">
                                        {profile.name}
                                      </span>
                                      {profile.proxyJump && (
                                        <span className="rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.2 text-[10px] text-sky-400">
                                          Jump
                                        </span>
                                      )}
                                      {profile.forwardAgent && (
                                        <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 text-[10px] text-amber-400">
                                          Agent Fwd
                                        </span>
                                      )}
                                      {profile.tunnels && profile.tunnels.length > 0 && (
                                        <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.2 text-[10px] text-indigo-400">
                                          {profile.tunnels.length} tunnel{profile.tunnels.length > 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                    <div className="truncate text-xs text-txt-muted">
                                      {profile.username}@{profile.host}:{profile.port ?? 22} · {profile.authType}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    {onConnectSSH && (
                                      <button
                                        type="button"
                                        onClick={() => void handleConnectSSH(profile)}
                                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                      >
                                        Connect
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      title="Edit"
                                      onClick={() => setEditing({ type: 'ssh', config: profile })}
                                      className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Delete"
                                      onClick={() => void handleDeleteSSH(profile.id)}
                                      className="rounded-lg p-1.5 text-red-400 hover:bg-app-surface-hover transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {!loading && tab === 's3' && (
                <div className="space-y-4">
                  {/* Recently Used S3 Profiles */}
                  {!query && recentS3.length > 0 && (
                    <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Recently Used</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {recentS3.map((profile) => (
                          <div
                            key={`recent-s3-${profile.id}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium text-txt-primary">{profile.name}</span>
                                {profile.group && (
                                  <span className="rounded bg-app-surface-subtle border border-border-subtle px-1.5 py-0.5 text-[10px] text-txt-muted">
                                    {profile.group}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-txt-muted">
                                {profile.endpoint || 'AWS S3'} · {profile.region} · Last connected:{' '}
                                {profile.lastUsedAt}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {onConnectS3 && (
                                <button
                                  type="button"
                                  onClick={() => void handleConnectS3(profile)}
                                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                >
                                  Connect
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grouped S3 Profiles */}
                  {filteredS3.length === 0 ? (
                    <p className="py-6 text-center text-sm text-txt-muted">
                      {query ? 'No profiles matched your search' : 'No S3 profiles yet'}
                    </p>
                  ) : (
                    groupedS3.map(([groupName, profiles]) => {
                      const isCollapsed = Boolean(collapsedGroups[`s3-${groupName}`]);
                      return (
                        <div key={`group-s3-${groupName}`} className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(`s3-${groupName}`)}
                            className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs font-semibold text-txt-secondary hover:bg-app-surface-hover transition-colors"
                          >
                            <div className="flex items-center gap-1.5">
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
                              )}
                              <Folder className="h-3.5 w-3.5 text-amber-400" />
                              <span>{groupName}</span>
                              <span className="rounded-full bg-app-surface px-1.5 py-0.2 text-[10px] text-txt-muted">
                                {profiles.length}
                              </span>
                            </div>
                          </button>

                          {!isCollapsed && (
                            <div className="flex flex-col gap-1.5 pl-2">
                              {profiles.map((profile) => (
                                <div
                                  key={profile.id}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-txt-primary">{profile.name}</div>
                                    <div className="truncate text-xs text-txt-muted">
                                      {profile.endpoint || 'AWS S3'} · {profile.region}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    {onConnectS3 && (
                                      <button
                                        type="button"
                                        onClick={() => void handleConnectS3(profile)}
                                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                      >
                                        Connect
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      title="Edit"
                                      onClick={() => setEditing({ type: 's3', config: profile })}
                                      className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Delete"
                                      onClick={() => void handleDeleteS3(profile.id)}
                                      className="rounded-lg p-1.5 text-red-400 hover:bg-app-surface-hover transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectionManagerModal;
