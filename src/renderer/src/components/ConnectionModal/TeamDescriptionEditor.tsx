import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { describeIpcError } from '../../lib/format';

interface TeamDescriptionEditorProps {
  vaultId: string;
  description?: string;
  /** Only a team admin may change the description. */
  canEdit: boolean;
  /** Called after a successful save, so the tab row can pick up the new text. */
  onSaved: () => Promise<unknown>;
}

/**
 * A team's description under its tab in the Connection Manager, editable in place by an admin: the same
 * `teamVaultSetDescription` call `TeamVaultDetailPanel` (Settings) makes, just reachable without leaving the
 * Connection Manager. Mount it with `key={vaultId}` so that switching team starts from a closed editor.
 */
export const TeamDescriptionEditor: React.FC<TeamDescriptionEditorProps> = ({ vaultId, description, canEdit, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  // Esc and Save both end the edit with the textarea gone: put focus back on what opened it.
  useEffect(() => {
    if (wasEditing.current && !editing) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.multissh.teamVaultSetDescription(vaultId, draft.trim());
      await onSaved();
      setEditing(false);
    } catch (err) {
      setError(describeIpcError(err, 'Failed to save the description'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1.5">
      {editing ? (
        <div className="flex items-start gap-1.5">
          <textarea
            autoFocus
            aria-label="Team description"
            aria-describedby={error ? errorId : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // The dialog closes on a window-level Escape; without this the whole dialog would go, draft and all.
              e.stopPropagation();
              if (!saving) setEditing(false);
            }}
            maxLength={500}
            rows={2}
            placeholder="What is this team for? (shown to every member here)"
            className="min-w-0 flex-1 rounded border border-border-subtle bg-app-input px-1.5 py-0.5 text-2xs text-txt-primary outline-none focus:border-sky-500"
          />
          <button
            aria-label="Save description"
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
            title="Save"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            aria-label="Cancel"
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="text-txt-muted hover:text-txt-secondary disabled:opacity-50"
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        (description || canEdit) && (
          <div className="flex items-start gap-1.5">
            <p className="max-h-16 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap text-2xs text-txt-muted">
              {description || 'No description yet.'}
            </p>
            {canEdit && (
              <button
                ref={editButtonRef}
                aria-label="Edit description"
                type="button"
                onClick={() => {
                  setDraft(description ?? '');
                  setError(null);
                  setEditing(true);
                }}
                className="shrink-0 text-txt-muted hover:text-txt-secondary"
                title="Edit description"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
        )
      )}
      {editing && error && (
        <p id={errorId} role="alert" className="mt-1 text-2xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
};
