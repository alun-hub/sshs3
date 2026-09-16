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
}

export const ConnectionManagerModal: React.FC<ConnectionManagerModalProps> = ({
  open,
  onClose,
  initialTab = 'ssh',
  onConnectSSH,
  onConnectS3,
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
      setError(err instanceof Error ? err.message : 'Kunde inte läsa profiler');
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
      setError(err instanceof Error ? err.message : 'Kunde inte spara profilen');
    }
  };

  const handleSaveS3 = async (config: S3Config) => {
    try {
      await window.multissh.profilesSaveS3(config);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte spara profilen');
    }
  };

  const handleDeleteSSH = async (id: string) => {
    if (!window.confirm('Ta bort profilen?')) return;
    try {
      await window.multissh.profilesDeleteSSH(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ta bort profilen');
    }
  };

  const handleDeleteS3 = async (id: string) => {
    if (!window.confirm('Ta bort profilen?')) return;
    try {
      await window.multissh.profilesDeleteS3(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ta bort profilen');
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
        (p.group || '').toLowerCase().includes(query)
    );
  }, [sshProfiles, query]);

  const recentSSH = useMemo(() => {
    return [...sshProfiles]
      .filter((p) => Boolean(p.lastUsedAt))
      .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
      .slice(0, 3);
  }, [sshProfiles]);

  const groupedSSH = useMemo(() => {
    const map = new Map<string, SSHConnectionConfig[]>();
    for (const p of filteredSSH) {
      const g = p.group?.trim() || 'Ogrupperade';
      const list = map.get(g) || [];
      list.push(p);
      map.set(g, list);
    }
    return Array.from(map.entries());
  }, [filteredSSH]);

  const filteredS3 = useMemo(() => {
    if (!query) return s3Profiles;
    return s3Profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.endpoint || 'AWS S3').toLowerCase().includes(query) ||
        p.region.toLowerCase().includes(query) ||
        (p.group || '').toLowerCase().includes(query)
    );
  }, [s3Profiles, query]);

  const recentS3 = useMemo(() => {
    return [...s3Profiles]
      .filter((p) => Boolean(p.lastUsedAt))
      .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
      .slice(0, 3);
  }, [s3Profiles]);

  const groupedS3 = useMemo(() => {
    const map = new Map<string, S3Config[]>();
    for (const p of filteredS3) {
      const g = p.group?.trim() || 'Ogrupperade';
      const list = map.get(g) || [];
      list.push(p);
      map.set(g, list);
    }
    return Array.from(map.entries());
  }, [filteredS3]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-slate-700 bg-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Anslutningshanterare</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex border-b border-slate-700 px-2 pt-2">
          {(
            [
              { key: 'ssh' as Tab, label: 'SSH / SFTP', icon: Server },
              { key: 's3' as Tab, label: 'S3', icon: Cloud },
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
                'flex items-center gap-1.5 rounded-t px-3 py-1.5 text-sm font-medium ' +
                (tab === key ? 'bg-slate-900 text-sky-400 border-t-2 border-sky-400' : 'text-slate-400 hover:text-slate-200')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded border border-red-900 bg-red-950/50 px-2.5 py-1.5 text-xs text-red-300">
              {error}
            </div>
          )}

          {editing ? (
            editing.type === 'ssh' ? (
              <SSHProfileForm
                initial={editing.config as SSHConnectionConfig | undefined}
                onSave={handleSaveSSH}
                onCancel={() => setEditing(null)}
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
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Sök profiler eller mappar..."
                    className="w-full rounded border border-slate-700 bg-slate-900/80 py-1.5 pl-8 pr-3 text-xs text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setEditing({ type: tab })}
                  className="flex items-center gap-1 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ny profil
                </button>
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Läser in...
                </div>
              )}

              {!loading && tab === 'ssh' && (
                <div className="space-y-4">
                  {/* Recently Used SSH Profiles */}
                  {!query && recentSSH.length > 0 && (
                    <div className="rounded border border-slate-700/60 bg-slate-900/30 p-2.5">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Senast använda</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {recentSSH.map((profile) => (
                          <div
                            key={`recent-${profile.id}`}
                            className="flex items-center justify-between gap-2 rounded border border-slate-700/80 bg-slate-900/60 px-3 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium text-slate-100">{profile.name}</span>
                                {profile.group && (
                                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                                    {profile.group}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-slate-500">
                                {profile.username}@{profile.host}:{profile.port ?? 22} · Senast ansluten:{' '}
                                {profile.lastUsedAt}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {onConnectSSH && (
                                <button
                                  type="button"
                                  onClick={() => void handleConnectSSH(profile)}
                                  className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                                >
                                  Anslut
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
                    <p className="py-6 text-center text-sm text-slate-500">
                      {query ? 'Inga profiler matchade sökningen' : 'Inga SSH-profiler ännu'}
                    </p>
                  ) : (
                    groupedSSH.map(([groupName, profiles]) => {
                      const isCollapsed = Boolean(collapsedGroups[`ssh-${groupName}`]);
                      return (
                        <div key={`group-${groupName}`} className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(`ssh-${groupName}`)}
                            className="flex w-full items-center justify-between rounded px-1.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700/40"
                          >
                            <div className="flex items-center gap-1.5">
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                              )}
                              <Folder className="h-3.5 w-3.5 text-amber-400" />
                              <span>{groupName}</span>
                              <span className="rounded-full bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-400">
                                {profiles.length}
                              </span>
                            </div>
                          </button>

                          {!isCollapsed && (
                            <div className="flex flex-col gap-1.5 pl-2">
                              {profiles.map((profile) => (
                                <div
                                  key={profile.id}
                                  className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-900/50 px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate text-sm text-slate-100 font-medium">
                                        {profile.name}
                                      </span>
                                      {profile.proxyJump && (
                                        <span className="rounded bg-sky-950/60 border border-sky-800 px-1.5 py-0.2 text-[10px] text-sky-300">
                                          Jump
                                        </span>
                                      )}
                                      {profile.tunnels && profile.tunnels.length > 0 && (
                                        <span className="rounded bg-indigo-950/60 border border-indigo-800 px-1.5 py-0.2 text-[10px] text-indigo-300">
                                          {profile.tunnels.length} tunnel
                                        </span>
                                      )}
                                    </div>
                                    <div className="truncate text-xs text-slate-500">
                                      {profile.username}@{profile.host}:{profile.port ?? 22} · {profile.authType}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    {onConnectSSH && (
                                      <button
                                        type="button"
                                        onClick={() => void handleConnectSSH(profile)}
                                        className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                                      >
                                        Anslut
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      title="Redigera"
                                      onClick={() => setEditing({ type: 'ssh', config: profile })}
                                      className="rounded p-1.5 text-slate-300 hover:bg-slate-700"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Ta bort"
                                      onClick={() => void handleDeleteSSH(profile.id)}
                                      className="rounded p-1.5 text-red-400 hover:bg-slate-700"
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
                    <div className="rounded border border-slate-700/60 bg-slate-900/30 p-2.5">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Senast använda</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {recentS3.map((profile) => (
                          <div
                            key={`recent-s3-${profile.id}`}
                            className="flex items-center justify-between gap-2 rounded border border-slate-700/80 bg-slate-900/60 px-3 py-1.5"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium text-slate-100">{profile.name}</span>
                                {profile.group && (
                                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                                    {profile.group}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-slate-500">
                                {profile.endpoint || 'AWS S3'} · {profile.region} · Senast ansluten:{' '}
                                {profile.lastUsedAt}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {onConnectS3 && (
                                <button
                                  type="button"
                                  onClick={() => void handleConnectS3(profile)}
                                  className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                                >
                                  Anslut
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
                    <p className="py-6 text-center text-sm text-slate-500">
                      {query ? 'Inga profiler matchade sökningen' : 'Inga S3-profiler ännu'}
                    </p>
                  ) : (
                    groupedS3.map(([groupName, profiles]) => {
                      const isCollapsed = Boolean(collapsedGroups[`s3-${groupName}`]);
                      return (
                        <div key={`group-s3-${groupName}`} className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(`s3-${groupName}`)}
                            className="flex w-full items-center justify-between rounded px-1.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700/40"
                          >
                            <div className="flex items-center gap-1.5">
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                              )}
                              <Folder className="h-3.5 w-3.5 text-amber-400" />
                              <span>{groupName}</span>
                              <span className="rounded-full bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-400">
                                {profiles.length}
                              </span>
                            </div>
                          </button>

                          {!isCollapsed && (
                            <div className="flex flex-col gap-1.5 pl-2">
                              {profiles.map((profile) => (
                                <div
                                  key={profile.id}
                                  className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-900/50 px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-slate-100">{profile.name}</div>
                                    <div className="truncate text-xs text-slate-500">
                                      {profile.endpoint || 'AWS S3'} · {profile.region}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1">
                                    {onConnectS3 && (
                                      <button
                                        type="button"
                                        onClick={() => void handleConnectS3(profile)}
                                        className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                                      >
                                        Anslut
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      title="Redigera"
                                      onClick={() => setEditing({ type: 's3', config: profile })}
                                      className="rounded p-1.5 text-slate-300 hover:bg-slate-700"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Ta bort"
                                      onClick={() => void handleDeleteS3(profile.id)}
                                      className="rounded p-1.5 text-red-400 hover:bg-slate-700"
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
