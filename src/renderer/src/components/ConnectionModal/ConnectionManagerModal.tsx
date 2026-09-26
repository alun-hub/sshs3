import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Copy,
  Download,
  Files,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { S3Config } from '@shared/types/storage';
import type { K8sTerminalTarget } from '@shared/types/kubernetes';
import { SSHProfileForm } from './SSHProfileForm';
import { S3ProfileForm } from './S3ProfileForm';
import { K8sConnectionTree } from './K8sConnectionTree';
import { formatDateTime } from '../../lib/format';

export type Tab = 'ssh' | 's3' | 'k8s';

interface ConnectionManagerModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: Tab;
  /** When set, shows a "Connect" action per profile and invokes this instead of only managing profiles. */
  onConnectSSH?: (config: SSHConnectionConfig) => void;
  /** When set, opens SFTP dual-pane file manager for the given SSH profile. */
  onConnectSFTP?: (config: SSHConnectionConfig) => void;
  onConnectS3?: (config: S3Config) => void;
  onConnectK8s?: (target: K8sTerminalTarget) => void;
  /** Opens a new tab following a container's logs. */
  onViewK8sLogs?: (target: K8sTerminalTarget) => void;
  /** Opens file manager targeting the container filesystem. */
  onBrowseK8sFiles?: (target: K8sTerminalTarget) => void;
  /** Master switch from Settings > Files & Storage. Off by default; hides the dotfiles pool field in the SSH form. */
  dotfilesPoolEnabled?: boolean;
  /** Master switch from Settings > Kubernetes & Debug. Off by default; enables OpenShift login and tools. */
  enableOpenShift?: boolean;
}

export const ConnectionManagerModal: React.FC<ConnectionManagerModalProps> = ({
  open,
  onClose,
  initialTab = 'ssh',
  onConnectSSH,
  onConnectSFTP,
  onConnectS3,
  onConnectK8s,
  onViewK8sLogs,
  onBrowseK8sFiles,
  dotfilesPoolEnabled = false,
  enableOpenShift = false,
}) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sshProfiles, setSshProfiles] = useState<SSHConnectionConfig[]>([]);
  const [s3Profiles, setS3Profiles] = useState<S3Config[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ type: Tab; config?: SSHConnectionConfig | S3Config } | null>(null);

  // Folder creation and rename
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');

  // Drag and drop target feedback
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);

  // Import / Export menu and modal
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importCandidates, setImportCandidates] = useState<SSHConnectionConfig[] | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [importTargetFolder, setImportTargetFolder] = useState<string>('Imported');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profiles = await window.multissh.profilesGet();
      setSshProfiles(profiles.ssh || []);
      setS3Profiles(profiles.s3 || []);
      setFolders(profiles.folders || []);
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
      setNewFolderOpen(false);
      setRenamingFolder(null);
      setImportMenuOpen(false);
      setImportCandidates(null);
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

  // Option A: Clone/Duplicate
  const handleCloneSSH = async (profile: SSHConnectionConfig) => {
    const clone: SSHConnectionConfig = {
      ...profile,
      id: crypto.randomUUID(),
      name: `${profile.name} (Copy)`,
    };
    delete clone.lastUsedAt;
    try {
      await window.multissh.profilesSaveSSH(clone);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone profile');
    }
  };

  const handleCloneS3 = async (profile: S3Config) => {
    const clone: S3Config = {
      ...profile,
      id: crypto.randomUUID(),
      name: `${profile.name} (Copy)`,
    };
    delete clone.lastUsedAt;
    try {
      await window.multissh.profilesSaveS3(clone);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clone profile');
    }
  };

  // Folder management
  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    try {
      await window.multissh.profilesSaveFolder(trimmed);
      setNewFolderName('');
      setNewFolderOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder');
    }
  };

  const handleCommitRenameFolder = async (oldName: string) => {
    const trimmed = renameFolderValue.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingFolder(null);
      return;
    }
    try {
      await window.multissh.profilesRenameFolder(oldName, trimmed);
      setRenamingFolder(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename folder');
    }
  };

  const handleDeleteFolder = async (folderName: string) => {
    if (!window.confirm(`Delete folder "${folderName}"? Profiles inside will be moved to Ungrouped.`)) {
      return;
    }
    try {
      await window.multissh.profilesDeleteFolder(folderName, false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete folder');
    }
  };

  // Drag and Drop
  const handleDropOnGroup = async (e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    setDragOverGroup(null);
    try {
      const dataStr = e.dataTransfer.getData('text/plain');
      if (!dataStr) return;
      const data = JSON.parse(dataStr);
      const targetGroup = groupName === 'Ungrouped' ? undefined : groupName;

      if (data.type === 'ssh') {
        const profile = sshProfiles.find((p) => p.id === data.id);
        if (profile && profile.group !== targetGroup) {
          await window.multissh.profilesSaveSSH({ ...profile, group: targetGroup });
          await load();
        }
      } else if (data.type === 's3') {
        const profile = s3Profiles.find((p) => p.id === data.id);
        if (profile && profile.group !== targetGroup) {
          await window.multissh.profilesSaveS3({ ...profile, group: targetGroup });
          await load();
        }
      }
    } catch {
      // Ignore invalid drag-drop data
    }
  };

  // Option D: Import / Export
  const handleImportSshConfig = async () => {
    setImportMenuOpen(false);
    try {
      const result = await window.multissh.profilesImportSshConfig();
      if (!result.profiles || result.profiles.length === 0) {
        window.alert(`No Host entries found in ~/.ssh/config`);
        return;
      }
      setImportCandidates(result.profiles);
      setSelectedCandidateIds(new Set(result.profiles.map((p) => p.id)));
      setImportTargetFolder('Imported');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import ~/.ssh/config');
    }
  };

  const handleConfirmImportCandidates = async () => {
    if (!importCandidates) return;
    const toImport = importCandidates.filter((p) => selectedCandidateIds.has(p.id));
    if (toImport.length === 0) {
      setImportCandidates(null);
      return;
    }

    try {
      const folder = importTargetFolder.trim() || undefined;
      if (folder) {
        await window.multissh.profilesSaveFolder(folder).catch(() => {});
      }
      for (const p of toImport) {
        await window.multissh.profilesSaveSSH({ ...p, group: folder });
      }
      setImportCandidates(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save imported profiles');
    }
  };

  const handleExportJson = async () => {
    setImportMenuOpen(false);
    try {
      const res = await window.multissh.profilesExportJson();
      if (res) {
        window.alert(`Successfully exported ${res.count} profiles to ${res.filePath}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export profiles');
    }
  };

  const handleImportJson = async () => {
    setImportMenuOpen(false);
    try {
      const res = await window.multissh.profilesImportJson();
      if (res && res.count > 0) {
        await load();
        window.alert(`Successfully imported ${res.count} profiles!`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import profiles');
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

  const allFolderNames = useMemo(() => {
    const set = new Set<string>(folders);
    for (const p of sshProfiles) {
      if (p.group?.trim()) set.add(p.group.trim());
    }
    for (const p of s3Profiles) {
      if (p.group?.trim()) set.add(p.group.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [folders, sshProfiles, s3Profiles]);

  const groupedSSH = useMemo(() => {
    const groups: Record<string, SSHConnectionConfig[]> = {};
    const ungroupedKey = 'Ungrouped';

    for (const f of allFolderNames) {
      if (!query || f.toLowerCase().includes(query)) {
        groups[f] = [];
      }
    }
    groups[ungroupedKey] = [];

    for (const p of filteredSSH) {
      const g = p.group?.trim() || ungroupedKey;
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }

    return Object.entries(groups)
      .filter(([name, list]) => {
        if (query) return list.length > 0 || name.toLowerCase().includes(query);
        if (name === ungroupedKey && list.length === 0) return false;
        return true;
      })
      .sort(([a], [b]) => {
        if (a === ungroupedKey) return 1;
        if (b === ungroupedKey) return -1;
        return a.localeCompare(b);
      });
  }, [filteredSSH, allFolderNames, query]);

  const groupedS3 = useMemo(() => {
    const groups: Record<string, S3Config[]> = {};
    const ungroupedKey = 'Ungrouped';

    for (const f of allFolderNames) {
      if (!query || f.toLowerCase().includes(query)) {
        groups[f] = [];
      }
    }
    groups[ungroupedKey] = [];

    for (const p of filteredS3) {
      const g = p.group?.trim() || ungroupedKey;
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }

    return Object.entries(groups)
      .filter(([name, list]) => {
        if (query) return list.length > 0 || name.toLowerCase().includes(query);
        if (name === ungroupedKey && list.length === 0) return false;
        return true;
      })
      .sort(([a], [b]) => {
        if (a === ungroupedKey) return 1;
        if (b === ungroupedKey) return -1;
        return a.localeCompare(b);
      });
  }, [filteredS3, allFolderNames, query]);

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
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden relative">
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
              { key: 'k8s' as Tab, label: 'Kubernetes', icon: Boxes },
            ]
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setEditing(null);
                setImportMenuOpen(false);
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
              {tab !== 'k8s' && (
                <div className="mb-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
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

                    <button
                      type="button"
                      onClick={() => {
                        setNewFolderOpen(true);
                        setNewFolderName('');
                      }}
                      title="Create Folder"
                      className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary shrink-0 transition-colors"
                    >
                      <FolderPlus className="h-3.5 w-3.5 text-amber-400" />
                      Folder
                    </button>

                    {/* Import / Export Menu */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setImportMenuOpen((prev) => !prev)}
                        title="Import and Export Profiles"
                        className="flex items-center gap-1 rounded-lg border border-border-subtle bg-app-surface px-2 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary shrink-0 transition-colors"
                      >
                        <Download className="h-3.5 w-3.5 text-sky-400" />
                        <span className="text-[11px]">Sync</span>
                      </button>

                      {importMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-lg border border-border-subtle bg-app-card py-1 shadow-xl text-xs">
                          {tab === 'ssh' && (
                            <button
                              type="button"
                              onClick={() => void handleImportSshConfig()}
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary"
                            >
                              <Upload className="h-3.5 w-3.5 text-sky-400" />
                              <span>Import ~/.ssh/config</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleExportJson()}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary"
                          >
                            <Download className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Export JSON Backup</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleImportJson()}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary"
                          >
                            <Upload className="h-3.5 w-3.5 text-amber-400" />
                            <span>Import JSON Backup</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline New Folder Input */}
                  {newFolderOpen && (
                    <div className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-950/20 p-2 animate-in fade-in duration-100">
                      <FolderPlus className="h-4 w-4 text-sky-400 shrink-0" />
                      <input
                        type="text"
                        autoFocus
                        placeholder="Folder name..."
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleCreateFolder();
                          if (e.key === 'Escape') setNewFolderOpen(false);
                        }}
                        className="flex-1 rounded border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateFolder()}
                        disabled={!newFolderName.trim()}
                        className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        Create
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNewFolderOpen(false);
                          setNewFolderName('');
                        }}
                        className="rounded p-1 text-txt-muted hover:text-txt-primary"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {tab === 'k8s' && (
                <K8sConnectionTree
                  enableOpenShift={enableOpenShift}
                  onExec={onConnectK8s}
                  onViewLogs={
                    onViewK8sLogs
                      ? (target) => {
                          onViewK8sLogs(target);
                          onClose();
                        }
                      : undefined
                  }
                  onBrowseFiles={
                    onBrowseK8sFiles
                      ? (target) => {
                          onBrowseK8sFiles(target);
                          onClose();
                        }
                      : undefined
                  }
                />
              )}

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
                            onDoubleClick={() => void handleConnectSSH(profile)}
                            title="Double-click to connect"
                            className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 hover:border-border-default transition-colors cursor-pointer"
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
                            <div className="flex shrink-0 items-center gap-1.5">
                              {onConnectSSH && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleConnectSSH(profile);
                                  }}
                                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                >
                                  Connect
                                </button>
                              )}
                              {onConnectSFTP && (
                                <button
                                  type="button"
                                  title="Open SFTP in Dual-Pane File Manager"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onConnectSFTP(profile);
                                  }}
                                  className="flex items-center gap-1 rounded-lg bg-sky-700/80 hover:bg-sky-600 px-2 py-1 text-xs font-medium text-white shadow-sm transition-colors"
                                >
                                  <Files className="h-3 w-3" />
                                  SFTP
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grouped SSH Profiles with Drag & Drop */}
                  {filteredSSH.length === 0 && allFolderNames.length === 0 ? (
                    <p className="py-6 text-center text-sm text-txt-muted">
                      {query ? 'No profiles matched your search' : 'No SSH profiles yet'}
                    </p>
                  ) : (
                    groupedSSH.map(([groupName, profiles]) => {
                      const isCollapsed = Boolean(collapsedGroups[`ssh-${groupName}`]);
                      const isDragOver = dragOverGroup === groupName;
                      return (
                        <div key={`group-${groupName}`} className="space-y-1.5">
                          {/* Folder Header */}
                          <div
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (dragOverGroup !== groupName) setDragOverGroup(groupName);
                            }}
                            onDragLeave={() => {
                              if (dragOverGroup === groupName) setDragOverGroup(null);
                            }}
                            onDrop={(e) => void handleDropOnGroup(e, groupName)}
                            className={`flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${
                              isDragOver
                                ? 'border border-dashed border-sky-400 bg-sky-500/15'
                                : 'hover:bg-app-surface-hover'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleGroup(`ssh-${groupName}`)}
                              className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-txt-secondary"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
                              )}
                              <Folder className="h-3.5 w-3.5 text-amber-400" />
                              {renamingFolder === groupName ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={renameFolderValue}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setRenameFolderValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void handleCommitRenameFolder(groupName);
                                    if (e.key === 'Escape') setRenamingFolder(null);
                                  }}
                                  className="rounded border border-sky-500 bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none"
                                />
                              ) : (
                                <span>{groupName}</span>
                              )}
                              <span className="rounded-full bg-app-surface px-1.5 py-0.2 text-[10px] text-txt-muted">
                                {profiles.length}
                              </span>
                            </button>

                            {groupName !== 'Ungrouped' && (
                              <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                                <button
                                  type="button"
                                  title="Rename folder"
                                  onClick={() => {
                                    setRenamingFolder(groupName);
                                    setRenameFolderValue(groupName);
                                  }}
                                  className="rounded p-1 text-txt-muted hover:text-txt-primary transition-colors"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete folder (ungroup profiles)"
                                  onClick={() => void handleDeleteFolder(groupName)}
                                  className="rounded p-1 text-txt-muted hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Folder Content / Cards */}
                          {!isCollapsed && (
                            <div className="flex flex-col gap-1.5 pl-2">
                              {profiles.length === 0 ? (
                                <div
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    if (dragOverGroup !== groupName) setDragOverGroup(groupName);
                                  }}
                                  onDragLeave={() => {
                                    if (dragOverGroup === groupName) setDragOverGroup(null);
                                  }}
                                  onDrop={(e) => void handleDropOnGroup(e, groupName)}
                                  className={`rounded-lg border border-dashed py-3 text-center text-xs transition-colors ${
                                    isDragOver
                                      ? 'border-sky-400 bg-sky-500/10 text-sky-300'
                                      : 'border-border-subtle/60 text-txt-muted'
                                  }`}
                                >
                                  Folder is empty — drag profiles here
                                </div>
                              ) : (
                                profiles.map((profile) => (
                                  <div
                                    key={profile.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'ssh', id: profile.id }));
                                      e.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDoubleClick={() => void handleConnectSSH(profile)}
                                    title="Double-click to connect (or drag to folder)"
                                    className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-2 cursor-grab active:cursor-grabbing hover:border-border-default transition-all select-none"
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
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      {onConnectSSH && (
                                        <button
                                          type="button"
                                          title="Connect (SSH Terminal)"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleConnectSSH(profile);
                                          }}
                                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                        >
                                          Connect
                                        </button>
                                      )}
                                      {onConnectSFTP && (
                                        <button
                                          type="button"
                                          title="Open SFTP in Dual-Pane File Manager"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onConnectSFTP(profile);
                                          }}
                                          className="flex items-center gap-1 rounded-lg bg-sky-700/80 hover:bg-sky-600 px-2 py-1 text-xs font-medium text-white shadow-sm transition-colors"
                                        >
                                          <Files className="h-3 w-3" />
                                          SFTP
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        title="Duplicate / Clone Profile"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleCloneSSH(profile);
                                        }}
                                        className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Edit Profile"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditing({ type: 'ssh', config: profile });
                                        }}
                                        className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Delete Profile"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleDeleteSSH(profile.id);
                                        }}
                                        className="rounded-lg p-1.5 text-red-400 hover:bg-app-surface-hover transition-colors"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
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
                            onDoubleClick={() => void handleConnectS3(profile)}
                            title="Double-click to connect"
                            className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 hover:border-border-default transition-colors cursor-pointer"
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleConnectS3(profile);
                                  }}
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

                  {/* Grouped S3 Profiles with Drag & Drop */}
                  {filteredS3.length === 0 && allFolderNames.length === 0 ? (
                    <p className="py-6 text-center text-sm text-txt-muted">
                      {query ? 'No profiles matched your search' : 'No S3 profiles yet'}
                    </p>
                  ) : (
                    groupedS3.map(([groupName, profiles]) => {
                      const isCollapsed = Boolean(collapsedGroups[`s3-${groupName}`]);
                      const isDragOver = dragOverGroup === groupName;
                      return (
                        <div key={`group-s3-${groupName}`} className="space-y-1.5">
                          {/* Folder Header */}
                          <div
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              if (dragOverGroup !== groupName) setDragOverGroup(groupName);
                            }}
                            onDragLeave={() => {
                              if (dragOverGroup === groupName) setDragOverGroup(null);
                            }}
                            onDrop={(e) => void handleDropOnGroup(e, groupName)}
                            className={`flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${
                              isDragOver
                                ? 'border border-dashed border-sky-400 bg-sky-500/15'
                                : 'hover:bg-app-surface-hover'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleGroup(`s3-${groupName}`)}
                              className="flex flex-1 items-center gap-1.5 text-xs font-semibold text-txt-secondary"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5 text-txt-muted" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 text-txt-muted" />
                              )}
                              <Folder className="h-3.5 w-3.5 text-amber-400" />
                              {renamingFolder === groupName ? (
                                <input
                                  type="text"
                                  autoFocus
                                  value={renameFolderValue}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => setRenameFolderValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void handleCommitRenameFolder(groupName);
                                    if (e.key === 'Escape') setRenamingFolder(null);
                                  }}
                                  className="rounded border border-sky-500 bg-app-input px-1.5 py-0.5 text-xs text-txt-primary outline-none"
                                />
                              ) : (
                                <span>{groupName}</span>
                              )}
                              <span className="rounded-full bg-app-surface px-1.5 py-0.2 text-[10px] text-txt-muted">
                                {profiles.length}
                              </span>
                            </button>

                            {groupName !== 'Ungrouped' && (
                              <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                                <button
                                  type="button"
                                  title="Rename folder"
                                  onClick={() => {
                                    setRenamingFolder(groupName);
                                    setRenameFolderValue(groupName);
                                  }}
                                  className="rounded p-1 text-txt-muted hover:text-txt-primary transition-colors"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete folder (ungroup profiles)"
                                  onClick={() => void handleDeleteFolder(groupName)}
                                  className="rounded p-1 text-txt-muted hover:text-red-400 transition-colors"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            )}
                          </div>

                          {!isCollapsed && (
                            <div className="flex flex-col gap-1.5 pl-2">
                              {profiles.length === 0 ? (
                                <div
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                    if (dragOverGroup !== groupName) setDragOverGroup(groupName);
                                  }}
                                  onDragLeave={() => {
                                    if (dragOverGroup === groupName) setDragOverGroup(null);
                                  }}
                                  onDrop={(e) => void handleDropOnGroup(e, groupName)}
                                  className={`rounded-lg border border-dashed py-3 text-center text-xs transition-colors ${
                                    isDragOver
                                      ? 'border-sky-400 bg-sky-500/10 text-sky-300'
                                      : 'border-border-subtle/60 text-txt-muted'
                                  }`}
                                >
                                  Folder is empty — drag profiles here
                                </div>
                              ) : (
                                profiles.map((profile) => (
                                  <div
                                    key={profile.id}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 's3', id: profile.id }));
                                      e.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDoubleClick={() => void handleConnectS3(profile)}
                                    title="Double-click to connect (or drag to folder)"
                                    className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-app-surface px-3 py-2 cursor-grab active:cursor-grabbing hover:border-border-default transition-all select-none"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-medium text-txt-primary">{profile.name}</div>
                                      <div className="truncate text-xs text-txt-muted">
                                        {profile.endpoint || 'AWS S3'} · {profile.region}
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      {onConnectS3 && (
                                        <button
                                          type="button"
                                          title="Connect / Browse S3"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleConnectS3(profile);
                                          }}
                                          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 shadow-sm transition-colors"
                                        >
                                          Connect
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        title="Duplicate / Clone Profile"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleCloneS3(profile);
                                        }}
                                        className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Edit Profile"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditing({ type: 's3', config: profile });
                                        }}
                                        className="rounded-lg p-1.5 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Delete Profile"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleDeleteS3(profile.id);
                                        }}
                                        className="rounded-lg p-1.5 text-red-400 hover:bg-app-surface-hover transition-colors"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
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

        {/* SSH Config Import Candidates Preview Modal */}
        {importCandidates && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4 animate-in fade-in duration-100">
            <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border-subtle bg-app-surface p-4 shadow-2xl space-y-3">
              <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                <div className="flex items-center gap-2 text-sky-400 font-semibold text-sm">
                  <Upload className="h-4 w-4" />
                  <span>Import Hosts from ~/.ssh/config</span>
                </div>
                <button
                  type="button"
                  onClick={() => setImportCandidates(null)}
                  className="rounded p-1 text-txt-muted hover:text-txt-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-txt-muted">Target Folder:</span>
                  <input
                    type="text"
                    value={importTargetFolder}
                    onChange={(e) => setImportTargetFolder(e.target.value)}
                    placeholder="e.g. Imported"
                    className="rounded border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 w-32"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCandidateIds(new Set(importCandidates.map((c) => c.id)))}
                    className="text-xs text-sky-400 hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-txt-muted">|</span>
                  <button
                    type="button"
                    onClick={() => setSelectedCandidateIds(new Set())}
                    className="text-xs text-txt-muted hover:underline"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1.5 rounded-lg border border-border-subtle bg-app-card p-2">
                {importCandidates.map((candidate) => {
                  const isChecked = selectedCandidateIds.has(candidate.id);
                  return (
                    <label
                      key={candidate.id}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-app-surface-hover cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const next = new Set(selectedCandidateIds);
                          if (e.target.checked) next.add(candidate.id);
                          else next.delete(candidate.id);
                          setSelectedCandidateIds(next);
                        }}
                        className="rounded border-border-subtle text-sky-500 focus:ring-0"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-txt-primary">{candidate.name}</span>
                        <span className="ml-2 text-txt-muted">
                          {candidate.username ? `${candidate.username}@` : ''}
                          {candidate.host}:{candidate.port ?? 22}
                        </span>
                      </div>
                      <span className="rounded bg-app-surface-subtle px-1.5 py-0.5 text-[10px] text-txt-muted">
                        {candidate.authType}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setImportCandidates(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmImportCandidates()}
                  disabled={selectedCandidateIds.size === 0}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  Import {selectedCandidateIds.size} Profile{selectedCandidateIds.size !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionManagerModal;
