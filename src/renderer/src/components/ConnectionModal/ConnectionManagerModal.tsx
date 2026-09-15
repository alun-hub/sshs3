import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, Loader2, Pencil, Plus, Server, Trash2, X } from 'lucide-react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { S3Config } from '@shared/types/storage';
import { SSHProfileForm } from './SSHProfileForm';
import { S3ProfileForm } from './S3ProfileForm';

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
      void load();
    }
  }, [open, initialTab, load]);

  if (!open) return null;

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Anslutningshanterare</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100">
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
                'flex items-center gap-1.5 rounded-t px-3 py-1.5 text-sm ' +
                (tab === key ? 'bg-slate-900 text-sky-400' : 'text-slate-400 hover:text-slate-200')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && <div className="mb-3 rounded border border-red-900 bg-red-950/50 px-2 py-1.5 text-xs text-red-300">{error}</div>}

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
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setEditing({ type: tab })}
                  className="flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
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
                <div className="flex flex-col gap-1">
                  {sshProfiles.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Inga SSH-profiler ännu</p>}
                  {sshProfiles.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-900/50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-100">{profile.name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {profile.username}@{profile.host}:{profile.port ?? 22} · {profile.authType}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {onConnectSSH && (
                          <button
                            type="button"
                            onClick={() => onConnectSSH(profile)}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
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

              {!loading && tab === 's3' && (
                <div className="flex flex-col gap-1">
                  {s3Profiles.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Inga S3-profiler ännu</p>}
                  {s3Profiles.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center justify-between gap-2 rounded border border-slate-700 bg-slate-900/50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-slate-100">{profile.name}</div>
                        <div className="truncate text-xs text-slate-500">{profile.endpoint || 'AWS S3'} · {profile.region}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {onConnectS3 && (
                          <button
                            type="button"
                            onClick={() => onConnectS3(profile)}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-500"
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectionManagerModal;
