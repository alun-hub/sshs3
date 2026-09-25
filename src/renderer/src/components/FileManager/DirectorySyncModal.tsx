import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckSquare,
  FileDiff,
  FolderSync,
  Loader2,
  Maximize2,
  Minimize2,
  Save,
  Square,
  X,
} from 'lucide-react';
import type { SFTPConfig, S3Config, TransferProgress } from '@shared/types/storage';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import type {
  DirectoryDiffEntry,
  DirectoryDiffResult,
  DirectorySyncApplyResult,
  DirectorySyncProfile,
} from '@shared/types/dirsync';
import { ConnectionManagerModal } from '../ConnectionModal/ConnectionManagerModal';
import { FolderBrowserModal } from './FolderBrowserModal';
import { FileDiffModal } from './FileDiffModal';
import { DirSyncSavedProfilesModal } from './DirSyncSavedProfilesModal';
import { classNames, formatBytes, formatDateTime } from '../../lib/format';
import type { SourceType } from './types';

/** Last path segment, used to preview the nested sync root under the chosen target parent. */
function baseName(path: string): string {
  const normalized = (path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

/**
 * Summarizes what actually differs for a 'changed' entry as one line per
 * side, and flags when the *target* is the newer side — that's the
 * dangerous case, since running the sync (source -> target) would silently
 * overwrite a more recent edit made on the target with the older source
 * version.
 */
function describeChange(
  entry: DirectoryDiffEntry
): { source: string; target: string; targetIsNewer: boolean } | null {
  const src = entry.sourceEntry;
  const tgt = entry.targetEntry;
  if (!src || !tgt) return null;

  const targetIsNewer =
    src.mtimeMs !== undefined && tgt.mtimeMs !== undefined && tgt.mtimeMs > src.mtimeMs;

  const describe = (e: typeof src) => {
    const bits = [formatBytes(e.size)];
    if (e.mtimeMs !== undefined) bits.push(formatDateTime(e.mtimeMs));
    return bits.join(', ');
  };

  return { source: describe(src), target: describe(tgt), targetIsNewer };
}

interface EndpointState {
  providerId: string;
  sourceType: SourceType;
  label: string;
  path: string;
}

export interface DirectorySyncModalSource {
  providerId: string;
  sourceType: SourceType;
  label: string;
  path: string;
}

interface DirectorySyncModalProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled source: the folder that was right-clicked, or resolved from a saved profile. */
  initialSource?: DirectorySyncModalSource | null;
  /** The other pane's connection + path, offered as a one-click target option. */
  otherPane?: DirectorySyncModalSource | null;
  /**
   * When opened by "Run" from the saved-profiles list: resolves source/target
   * from the profile and jumps straight to computing a fresh diff — never
   * straight to applying, so a stale/dangerous profile (e.g. with delete
   * enabled) is always reviewed before it can run.
   */
  runProfile?: DirectorySyncProfile | null;
}

type Step = 'setup' | 'diff' | 'apply';

const STATUS_LABELS: Record<DirectoryDiffEntry['status'], string> = {
  new: 'New',
  changed: 'Changed',
  'only-target': 'Only in target',
};

const STATUS_COLORS: Record<DirectoryDiffEntry['status'], string> = {
  new: 'text-emerald-400',
  changed: 'text-amber-400',
  'only-target': 'text-red-400',
};

/** Connects (or reuses) the storage provider referenced by a providerId, following
 * the app-wide convention: 'local', or 'sftp-<sshProfileId>' / 's3-<s3ProfileId>'. */
async function resolveProviderRef(ref: string): Promise<EndpointState> {
  if (!ref || ref === 'local') {
    await window.multissh.connectStorage({ id: 'local', name: 'Local Disk', type: 'local' });
    return { providerId: 'local', sourceType: 'local', label: 'Local Disk', path: '' };
  }
  if (ref.startsWith('sftp-')) {
    const id = ref.slice('sftp-'.length);
    const profiles = await window.multissh.profilesGet();
    const cfg = profiles.ssh.find((p) => p.id === id);
    if (!cfg) throw new Error(`Saved SSH profile not found (${id})`);
    const sftpConfig: SFTPConfig = {
      id: cfg.id,
      name: cfg.name,
      host: cfg.host,
      port: cfg.port ?? 22,
      username: cfg.username,
      authType: cfg.authType,
      password: cfg.password,
      privateKeyPath: cfg.privateKeyPath,
      passphrase: cfg.passphrase,
      agentPath: cfg.agentPath,
      pkcs11LibPath: cfg.pkcs11LibPath,
      initialPath: cfg.initialPath,
      proxy: cfg.proxy,
    };
    await window.multissh.connectStorage({ id: ref, name: cfg.name, type: 'sftp', sftpConfig });
    return { providerId: ref, sourceType: 'sftp', label: cfg.name, path: cfg.initialPath?.trim() || '/' };
  }
  if (ref.startsWith('s3-')) {
    const id = ref.slice('s3-'.length);
    const profiles = await window.multissh.profilesGet();
    const cfg = profiles.s3.find((p) => p.id === id);
    if (!cfg) throw new Error(`Saved S3 profile not found (${id})`);
    await window.multissh.connectStorage({ id: ref, name: cfg.name, type: 's3', s3Config: cfg });
    return { providerId: ref, sourceType: 's3', label: cfg.name, path: cfg.initialPath?.trim() || '/' };
  }
  throw new Error(`Unknown provider reference: ${ref}`);
}

export const DirectorySyncModal: React.FC<DirectorySyncModalProps> = ({
  open,
  onClose,
  initialSource,
  otherPane,
  runProfile,
}) => {
  const [step, setStep] = useState<Step>('setup');
  const [source, setSource] = useState<EndpointState | null>(null);
  const [target, setTarget] = useState<EndpointState | null>(null);
  const [deleteExtraneous, setDeleteExtraneous] = useState(false);
  const [connectionPickerOpen, setConnectionPickerOpen] = useState(false);
  const [folderBrowserOpen, setFolderBrowserOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string | null>(null);

  const [diff, setDiff] = useState<DirectoryDiffResult | null>(null);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [compareEntry, setCompareEntry] = useState<DirectoryDiffEntry | null>(null);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);

  const [applyProgress, setApplyProgress] = useState<TransferProgress | null>(null);
  const [applyResult, setApplyResult] = useState<DirectorySyncApplyResult | null>(null);

  const [saveProfileName, setSaveProfileName] = useState('');
  const [showSaveProfile, setShowSaveProfile] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (folderBrowserOpen || compareEntry || profilePickerOpen || connectionPickerOpen) {
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [open, folderBrowserOpen, compareEntry, profilePickerOpen, connectionPickerOpen, onClose]);

  // Reset + prefill only on the rising edge of `open` (closed -> open), not
  // on every re-render while already open — otherwise an unrelated prop
  // change (e.g. initialSource going null because a background refresh
  // cleared the file manager's selection) would wipe out an in-progress or
  // just-finished sync.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;
    setStep('setup');
    setError(null);
    setDiff(null);
    setIncluded({});
    setApplyProgress(null);
    setApplyResult(null);
    setShowSaveProfile(false);
    setSaveProfileName('');

    if (runProfile) {
      setDeleteExtraneous(runProfile.deleteExtraneous);
      setBusy(true);
      Promise.all([
        resolveProviderRef(runProfile.source.providerConfigRef),
        resolveProviderRef(runProfile.target.providerConfigRef),
      ])
        .then(([src, tgt]) => {
          const resolvedSource = { ...src, path: runProfile.source.path };
          const resolvedTarget = { ...tgt, path: runProfile.target.path };
          setSource(resolvedSource);
          setTarget(resolvedTarget);
          return runDiff(resolvedSource, resolvedTarget);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
      return;
    }

    if (initialSource) {
      setSource({ ...initialSource });
    } else {
      setSource(null);
    }
    // Default the target to the sibling pane's connection + path when opened
    // from a folder's context menu — it's the most likely intent, but every
    // other way to pick a target (browse, saved connection, manual edit)
    // stays available and overrides this.
    setTarget(otherPane ? { ...otherPane } : null);
    setDeleteExtraneous(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runProfile, initialSource, otherPane]);

  const runDiff = useCallback(async (src: EndpointState, tgt: EndpointState) => {
    setError(null);
    setScanStatus('Scanning source and target...');
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.multissh.onDirSyncScanProgress?.((event) => {
        setScanStatus(
          `Scanning ${event.side === 'source' ? 'source' : 'target'} (${event.filesCount} items)... ${event.currentItem}`
        );
      });
      const result = await window.multissh.dirSyncComputeDiff({
        sourceProviderId: src.providerId,
        sourcePath: src.path,
        targetProviderId: tgt.providerId,
        targetPath: tgt.path,
      });
      setDiff(result);
      const initialIncluded: Record<string, boolean> = {};
      for (const entry of result.entries) {
        initialIncluded[entry.relativePath] = entry.status !== 'only-target';
      }
      setIncluded(initialIncluded);
      setStep('diff');
    } finally {
      unsubscribe?.();
      setScanStatus(null);
    }
  }, []);

  const loadProfile = useCallback(
    async (profile: DirectorySyncProfile) => {
      setError(null);
      setDeleteExtraneous(profile.deleteExtraneous);
      setBusy(true);
      try {
        const [src, tgt] = await Promise.all([
          resolveProviderRef(profile.source.providerConfigRef),
          resolveProviderRef(profile.target.providerConfigRef),
        ]);
        const resolvedSource = { ...src, path: profile.source.path };
        const resolvedTarget = { ...tgt, path: profile.target.path };
        setSource(resolvedSource);
        setTarget(resolvedTarget);
        await runDiff(resolvedSource, resolvedTarget);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [runDiff]
  );

  const handleComputeDiff = async () => {
    if (!source || !target) {
      setError('Specify both a source and a target');
      return;
    }
    setBusy(true);
    try {
      await runDiff(source, target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUseOtherPaneAsTarget = () => {
    if (otherPane) {
      setTarget({ ...otherPane });
    }
  };

  const handlePickConnectionTarget = () => {
    setConnectionPickerOpen(true);
  };

  const handleConnectTargetSSH = async (config: SSHConnectionConfig) => {
    setConnectionPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      const providerId = `sftp-${config.id}`;
      const sftpConfig: SFTPConfig = {
        id: config.id,
        name: config.name,
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
        authType: config.authType,
        password: config.password,
        privateKeyPath: config.privateKeyPath,
        passphrase: config.passphrase,
        agentPath: config.agentPath,
        pkcs11LibPath: config.pkcs11LibPath,
        initialPath: config.initialPath,
        proxy: config.proxy,
      };
      await window.multissh.connectStorage({ id: providerId, name: config.name, type: 'sftp', sftpConfig });
      setTarget({ providerId, sourceType: 'sftp', label: config.name, path: config.initialPath?.trim() || '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the target server');
    } finally {
      setBusy(false);
    }
  };

  const handleConnectTargetS3 = async (config: S3Config) => {
    setConnectionPickerOpen(false);
    setBusy(true);
    setError(null);
    try {
      const providerId = `s3-${config.id}`;
      await window.multissh.connectStorage({ id: providerId, name: config.name, type: 's3', s3Config: config });
      setTarget({ providerId, sourceType: 's3', label: config.name, path: config.initialPath?.trim() || '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to the S3 target');
    } finally {
      setBusy(false);
    }
  };

  const toggleIncluded = (relativePath: string) => {
    setIncluded((prev) => ({ ...prev, [relativePath]: !prev[relativePath] }));
  };

  const setCategoryIncluded = (status: DirectoryDiffEntry['status'], value: boolean) => {
    if (!diff) return;
    setIncluded((prev) => {
      const next = { ...prev };
      for (const entry of diff.entries) {
        if (entry.status === status) {
          next[entry.relativePath] = value;
        }
      }
      return next;
    });
  };

  const grouped = useMemo(() => {
    if (!diff) return { new: [], changed: [], onlyTarget: [] } as Record<string, DirectoryDiffEntry[]>;
    return {
      new: diff.entries.filter((e) => e.status === 'new'),
      changed: diff.entries.filter((e) => e.status === 'changed'),
      onlyTarget: diff.entries.filter((e) => e.status === 'only-target'),
    };
  }, [diff]);

  const handleSaveProfile = async () => {
    if (!source || !target || !saveProfileName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const profile: DirectorySyncProfile = {
        id: runProfile?.id ?? crypto.randomUUID(),
        name: saveProfileName.trim(),
        source: { providerConfigRef: source.providerId, path: source.path },
        target: { providerConfigRef: target.providerId, path: target.path },
        deleteExtraneous,
        createdAt: runProfile?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await window.multissh.dirSyncProfileSave(profile);
      setShowSaveProfile(false);
      setSaveProfileName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the profile');
    } finally {
      setBusy(false);
    }
  };

  const handleRunSync = async () => {
    if (!diff || !source || !target) return;
    const selectedEntries = diff.entries.filter((e) => included[e.relativePath]);
    setStep('apply');
    setBusy(true);
    setError(null);
    setApplyProgress(null);
    setApplyResult(null);

    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.multissh.onDirSyncApplyProgress?.((progress) => {
        setApplyProgress(progress);
      });
      const result = await window.multissh.dirSyncApply({
        entries: selectedEntries,
        sourceProviderId: source.providerId,
        sourcePath: source.path,
        targetProviderId: target.providerId,
        targetPath: target.path,
        deleteExtraneous,
      });
      setApplyResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The sync failed');
    } finally {
      unsubscribe?.();
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div
        className={classNames(
          'flex flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden transition-all duration-150',
          isMaximized ? 'w-[98vw] h-[96vh] max-w-none' : 'w-[94vw] max-w-[1400px] h-[88vh]'
        )}
      >
        <div
          onDoubleClick={() => setIsMaximized((m) => !m)}
          title="Double-click header to maximize / restore"
          className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-4 py-3 select-none cursor-default shrink-0"
        >
          <div className="flex items-center gap-2">
            <FolderSync className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-txt-primary">Sync Directory</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={isMaximized ? 'Restore size' : 'Maximize window'}
              onClick={() => setIsMaximized((m) => !m)}
              className="rounded-lg p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
            >
              {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              title="Close (Esc)"
              onClick={onClose}
              className="rounded-lg p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs text-txt-secondary">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-800/80 bg-red-950/40 p-2.5 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === 'setup' && (
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-txt-primary">Source</span>
                {source ? (
                  <div className="rounded-lg border border-border-subtle bg-app-surface p-2.5">
                    <div className="text-[11px] text-txt-muted">{source.label}</div>
                    <input
                      value={source.path}
                      onChange={(e) => setSource({ ...source, path: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 font-mono text-txt-primary outline-none focus:border-sky-500"
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border-subtle p-3 text-txt-muted">
                    No source selected. Right-click a folder in the file manager and choose &quot;Sync
                    to...&quot;, or load a saved profile below.
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setProfilePickerOpen(true)}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                >
                  Load saved profile...
                </button>
              </div>

              <div className="flex items-center justify-center text-txt-muted">
                <ArrowRight className="h-4 w-4" />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-txt-primary">Target (parent folder)</span>
                {target ? (
                  <div className="rounded-lg border border-border-subtle bg-app-surface p-2.5">
                    <div className="text-[11px] text-txt-muted">{target.label}</div>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        value={target.path}
                        onChange={(e) => setTarget({ ...target, path: e.target.value })}
                        className="flex-1 min-w-0 rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 font-mono text-txt-primary outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={() => setFolderBrowserOpen(true)}
                        className="shrink-0 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                      >
                        Browse...
                      </button>
                    </div>
                    {source?.path && (
                      <div className="mt-1.5 text-[11px] text-txt-muted">
                        Will sync to:{' '}
                        <span className="font-mono text-txt-secondary">
                          {target.path.replace(/\/$/, '')}/{baseName(source.path) || '…'}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border-subtle p-3 text-txt-muted">
                    No target selected.
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {otherPane && (
                    <button
                      type="button"
                      onClick={handleUseOtherPaneAsTarget}
                      className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                    >
                      Use other pane ({otherPane.label})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handlePickConnectionTarget}
                    className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                  >
                    Choose saved connection profile...
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-txt-primary pt-1">
                <input
                  type="checkbox"
                  checked={deleteExtraneous}
                  onChange={(e) => setDeleteExtraneous(e.target.checked)}
                  className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
                />
                <span>Delete files missing from the source</span>
              </label>

              {scanStatus && (
                <div className="flex items-center gap-2 text-txt-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="truncate">{scanStatus}</span>
                </div>
              )}
            </>
          )}

          {step === 'diff' && diff && (
            <>
              {(diff.skippedPaths.source.length > 0 || diff.skippedPaths.target.length > 0) && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300">
                  {diff.skippedPaths.source.length > 0 && (
                    <div>
                      {diff.skippedPaths.source.length} folder(s) in the source could not be read (e.g. permission denied) and were excluded: {diff.skippedPaths.source.slice(0, 5).join(', ')}
                      {diff.skippedPaths.source.length > 5 ? ', …' : ''}
                    </div>
                  )}
                  {diff.skippedPaths.target.length > 0 && (
                    <div>
                      {diff.skippedPaths.target.length} folder(s) in the target could not be read (e.g. permission denied) and were excluded: {diff.skippedPaths.target.slice(0, 5).join(', ')}
                      {diff.skippedPaths.target.length > 5 ? ', …' : ''}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg border border-border-subtle bg-app-surface p-2">
                  <div className="text-base font-semibold text-emerald-400">{diff.counts.new}</div>
                  <div className="text-[11px] text-txt-muted">New</div>
                </div>
                <div className="rounded-lg border border-border-subtle bg-app-surface p-2">
                  <div className="text-base font-semibold text-amber-400">{diff.counts.changed}</div>
                  <div className="text-[11px] text-txt-muted">Changed</div>
                </div>
                <div className="rounded-lg border border-border-subtle bg-app-surface p-2">
                  <div className="text-base font-semibold text-red-400">{diff.counts.onlyTarget}</div>
                  <div className="text-[11px] text-txt-muted">Only in target</div>
                </div>
                <div className="rounded-lg border border-border-subtle bg-app-surface p-2">
                  <div className="text-base font-semibold text-txt-muted">{diff.counts.same}</div>
                  <div className="text-[11px] text-txt-muted">Unchanged</div>
                </div>
              </div>

              {diff.entries.length === 0 ? (
                <div className="rounded-lg border border-border-subtle bg-app-surface p-4 text-center text-txt-muted">
                  No differences found. Source and target are already in sync.
                </div>
              ) : (
                <div className="rounded-lg border border-border-subtle bg-app-surface overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border-subtle text-[11px] text-txt-muted uppercase tracking-wider">
                        <th className="p-2 font-semibold w-8" />
                        <th className="p-2 font-semibold">Path</th>
                        <th className="p-2 font-semibold w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle/50">
                      {(['new', 'changed', 'only-target'] as const).map((status) => {
                        const entries =
                          status === 'new' ? grouped.new : status === 'changed' ? grouped.changed : grouped.onlyTarget;
                        if (entries.length === 0) return null;
                        return (
                          <React.Fragment key={status}>
                            <tr className="bg-app-surface-hover/50">
                              <td colSpan={3} className="px-2 py-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCategoryIncluded(status, !entries.every((e) => included[e.relativePath]))
                                  }
                                  className="flex items-center gap-1.5 text-[11px] font-semibold text-txt-secondary hover:text-txt-primary"
                                >
                                  {entries.every((e) => included[e.relativePath]) ? (
                                    <CheckSquare className="h-3.5 w-3.5" />
                                  ) : (
                                    <Square className="h-3.5 w-3.5" />
                                  )}
                                  {STATUS_LABELS[status]} ({entries.length}) — select all
                                </button>
                              </td>
                            </tr>
                            {entries.map((entry) => {
                              const change = entry.status === 'changed' ? describeChange(entry) : null;
                              return (
                                <tr key={entry.relativePath}>
                                  <td className="px-2 py-1.5 align-top">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(included[entry.relativePath])}
                                      onChange={() => toggleIncluded(entry.relativePath)}
                                      className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5 align-top max-w-0">
                                    <div className="font-mono text-txt-primary truncate">{entry.relativePath}</div>
                                    {change && (
                                      <div className="mt-1 space-y-0.5 text-[11px] leading-snug">
                                        <div className="text-txt-muted">
                                          <span className="text-txt-secondary font-medium">Source:</span>{' '}
                                          {change.source}
                                        </div>
                                        <div className={change.targetIsNewer ? 'text-red-400' : 'text-txt-muted'}>
                                          <span
                                            className={
                                              change.targetIsNewer
                                                ? 'text-red-400 font-medium'
                                                : 'text-txt-secondary font-medium'
                                            }
                                          >
                                            Target:
                                          </span>{' '}
                                          {change.target}
                                          {change.targetIsNewer && (
                                            <span className="font-medium"> — newer, will be overwritten</span>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                  <td className={`px-2 py-1.5 align-top font-medium ${STATUS_COLORS[entry.status]}`}>
                                    <div>{STATUS_LABELS[entry.status]}</div>
                                    {entry.status === 'changed' &&
                                      entry.sourceEntry?.path &&
                                      entry.targetEntry?.path && (
                                        <button
                                          type="button"
                                          onClick={() => setCompareEntry(entry)}
                                          className="mt-1 flex items-center gap-1 rounded border border-border-subtle px-1.5 py-0.5 text-[10px] font-normal text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                                        >
                                          <FileDiff className="h-3 w-3" />
                                          Compare
                                        </button>
                                      )}
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {showSaveProfile && (
                <div className="rounded-lg border border-border-subtle bg-app-surface p-2.5 space-y-2">
                  <span className="text-xs font-medium text-txt-primary">Profile name</span>
                  <div className="flex gap-2">
                    <input
                      value={saveProfileName}
                      onChange={(e) => setSaveProfileName(e.target.value)}
                      placeholder="e.g. Web server → backup"
                      className="flex-1 rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-txt-primary outline-none focus:border-sky-500"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSaveProfile()}
                      disabled={!saveProfileName.trim() || busy}
                      className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'apply' && (
            <div className="space-y-3">
              {!applyResult ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-txt-secondary">
                    <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                    <span>Syncing...</span>
                  </div>
                  {applyProgress && (
                    <div className="space-y-1">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-app-surface">
                        <div
                          className="h-full bg-sky-500 transition-all"
                          style={{ width: `${applyProgress.percentage}%` }}
                        />
                      </div>
                      <div className="truncate text-[11px] text-txt-muted">
                        {applyProgress.statusMessage || applyProgress.fileName}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg border border-border-subtle bg-app-surface p-2">
                      <div className="text-base font-semibold text-emerald-400">{applyResult.copied}</div>
                      <div className="text-[11px] text-txt-muted">Copied</div>
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-app-surface p-2">
                      <div className="text-base font-semibold text-amber-400">{applyResult.deleted}</div>
                      <div className="text-[11px] text-txt-muted">Deleted</div>
                    </div>
                    <div className="rounded-lg border border-border-subtle bg-app-surface p-2">
                      <div className="text-base font-semibold text-red-400">{applyResult.failed}</div>
                      <div className="text-[11px] text-txt-muted">Failed</div>
                    </div>
                  </div>
                  {applyResult.errors.length > 0 && (
                    <div className="rounded-lg border border-red-800/80 bg-red-950/40 p-2.5 space-y-1 max-h-40 overflow-y-auto">
                      {applyResult.errors.map((e, i) => (
                        <div key={i} className="text-[11px] text-red-300">
                          <span className="font-mono">{e.path}</span>: {e.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border-subtle bg-app-surface px-4 py-3">
          <div>
            {step === 'diff' && !showSaveProfile && (
              <button
                type="button"
                onClick={() => setShowSaveProfile(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                Save as profile
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-subtle px-3.5 py-1.5 text-xs text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
            >
              {step === 'apply' && applyResult ? 'Close' : 'Cancel'}
            </button>
            {step === 'setup' && (
              <button
                type="button"
                onClick={() => void handleComputeDiff()}
                disabled={!source || !target || busy}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 shadow-sm transition-colors"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Compute diff
              </button>
            )}
            {step === 'diff' && (
              <button
                type="button"
                onClick={() => void handleRunSync()}
                disabled={diff?.entries.length === 0 || busy}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 shadow-sm transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                Run sync
              </button>
            )}
          </div>
        </div>
      </div>

      <ConnectionManagerModal
        open={connectionPickerOpen}
        onClose={() => setConnectionPickerOpen(false)}
        onConnectSSH={(config) => void handleConnectTargetSSH(config)}
        onConnectS3={(config) => void handleConnectTargetS3(config)}
      />

      {target && (
        <FolderBrowserModal
          open={folderBrowserOpen}
          onClose={() => setFolderBrowserOpen(false)}
          onSelect={(path) => {
            setTarget({ ...target, path });
            setFolderBrowserOpen(false);
          }}
          providerId={target.providerId}
          providerLabel={target.label}
          initialPath={target.path || '/'}
        />
      )}

      {compareEntry && source && target && compareEntry.sourceEntry?.path && compareEntry.targetEntry?.path && (
        <FileDiffModal
          open={Boolean(compareEntry)}
          onClose={() => setCompareEntry(null)}
          relativePath={compareEntry.relativePath}
          sourceProviderId={source.providerId}
          sourcePath={compareEntry.sourceEntry.path}
          targetProviderId={target.providerId}
          targetPath={compareEntry.targetEntry.path}
        />
      )}

      <DirSyncSavedProfilesModal
        open={profilePickerOpen}
        onClose={() => setProfilePickerOpen(false)}
        onRun={(profile) => {
          setProfilePickerOpen(false);
          void loadProfile(profile);
        }}
      />
    </div>
  );
};

export default DirectorySyncModal;
