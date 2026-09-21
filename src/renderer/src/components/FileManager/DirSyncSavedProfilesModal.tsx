import React, { useEffect, useState } from 'react';
import { FolderSync, Loader2, Play, Trash2, X } from 'lucide-react';
import type { DirectorySyncProfile } from '@shared/types/dirsync';

interface DirSyncSavedProfilesModalProps {
  open: boolean;
  onClose: () => void;
  onRun: (profile: DirectorySyncProfile) => void;
}

function describeRef(ref: string): string {
  if (!ref || ref === 'local') return 'Local Disk';
  if (ref.startsWith('sftp-')) return `SFTP: ${ref.slice('sftp-'.length)}`;
  if (ref.startsWith('s3-')) return `S3: ${ref.slice('s3-'.length)}`;
  return ref;
}

export const DirSyncSavedProfilesModal: React.FC<DirSyncSavedProfilesModalProps> = ({ open, onClose, onRun }) => {
  const [profiles, setProfiles] = useState<DirectorySyncProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    window.multissh
      .dirSyncProfileList()
      .then(setProfiles)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this sync profile?')) return;
    try {
      await window.multissh.dirSyncProfileDelete(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the profile');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl border border-border-subtle bg-app-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-subtle bg-app-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderSync className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-txt-primary">Saved Sync Profiles</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-txt-muted hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 text-xs text-txt-secondary">
          {error && (
            <div className="rounded-lg border border-red-800/80 bg-red-950/40 p-2.5 text-red-300">{error}</div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-6 text-txt-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : profiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center text-txt-muted">
              No saved profiles yet. Compute a diff in the directory sync dialog and choose &quot;Save as
              profile&quot;.
            </div>
          ) : (
            profiles.map((profile) => (
              <div
                key={profile.id}
                className="rounded-lg border border-border-subtle bg-app-surface p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-txt-primary truncate">{profile.name}</div>
                  <div className="text-[11px] text-txt-muted truncate">
                    {describeRef(profile.source.providerConfigRef)}:{profile.source.path} →{' '}
                    {describeRef(profile.target.providerConfigRef)}:{profile.target.path}
                  </div>
                  {profile.deleteExtraneous && (
                    <div className="text-[11px] text-amber-400">Deletes files missing from the source</div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onRun(profile)}
                    title="Compute a fresh diff and run"
                    className="flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-500 transition-colors"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(profile.id)}
                    title="Delete profile"
                    className="rounded-lg p-1.5 text-txt-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default DirSyncSavedProfilesModal;
