import React, { useEffect, useState } from 'react';
import { FileJson, X, Loader2 } from 'lucide-react';

interface BucketPolicyModalProps {
  open: boolean;
  providerId: string;
  bucketPath: string;
  bucketName: string;
  onClose: () => void;
  onSaved?: () => void;
}

type Tab = 'policy' | 'cors';

const DEFAULT_CORS = `[
  {
    "AllowedMethods": ["GET"],
    "AllowedOrigins": ["*"],
    "AllowedHeaders": ["*"]
  }
]`;

export const BucketPolicyModal: React.FC<BucketPolicyModalProps> = ({
  open,
  providerId,
  bucketPath,
  bucketName,
  onClose,
  onSaved,
}) => {
  const [tab, setTab] = useState<Tab>('policy');
  const [policyText, setPolicyText] = useState('');
  const [corsText, setCorsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTab('policy');
    setLoading(true);
    Promise.all([
      window.multissh.storageGetBucketPolicy(providerId, bucketPath),
      window.multissh.storageGetBucketCors(providerId, bucketPath),
    ])
      .then(([policy, cors]) => {
        setPolicyText(policy ?? '');
        setCorsText(cors ?? '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Kunde inte hämta bucket-inställningar'))
      .finally(() => setLoading(false));
  }, [open, providerId, bucketPath]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (tab === 'policy') {
        if (policyText.trim()) {
          JSON.parse(policyText);
        }
        await window.multissh.storageSetBucketPolicy(providerId, bucketPath, policyText.trim() || null);
      } else {
        await window.multissh.storageSetBucketCors(providerId, bucketPath, corsText.trim() || null);
      }
      onSaved?.();
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'Ogiltig JSON'
          : err instanceof Error
            ? err.message
            : 'Kunde inte spara'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const label = tab === 'policy' ? 'bucket-policyn' : 'CORS-konfigurationen';
    if (!window.confirm(`Ta bort ${label}?`)) return;
    setSaving(true);
    setError(null);
    try {
      if (tab === 'policy') {
        await window.multissh.storageSetBucketPolicy(providerId, bucketPath, null);
        setPolicyText('');
      } else {
        await window.multissh.storageSetBucketCors(providerId, bucketPath, null);
        setCorsText('');
      }
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kunde inte ta bort');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Bucket-policy &amp; CORS — {bucketName}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex border-b border-slate-800 bg-slate-900 px-2">
          {(['policy', 'cors'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                'px-3 py-2 text-xs font-medium ' +
                (tab === t
                  ? 'border-b-2 border-sky-500 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200')
              }
            >
              {t === 'policy' ? 'Bucket-policy' : 'CORS-regler'}
            </button>
          ))}
        </div>

        <div className="p-4 text-xs text-slate-300">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Läser in...
            </div>
          )}
          {error && (
            <div className="mb-3 rounded border border-red-800/80 bg-red-950/60 p-2 text-red-300">{error}</div>
          )}
          {!loading && tab === 'policy' && (
            <textarea
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              placeholder='{"Version": "2012-10-17", "Statement": []}'
              spellCheck={false}
              className="h-72 w-full resize-none rounded border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
            />
          )}
          {!loading && tab === 'cors' && (
            <textarea
              value={corsText}
              onChange={(e) => setCorsText(e.target.value)}
              placeholder={DEFAULT_CORS}
              spellCheck={false}
              className="h-72 w-full resize-none rounded border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs text-slate-100 outline-none focus:border-sky-500"
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-800 bg-slate-800/50 px-4 py-3">
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={saving || loading}
            className="rounded border border-red-800/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/50 disabled:opacity-50"
          >
            Ta bort {tab === 'policy' ? 'policy' : 'CORS'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
            >
              Stäng
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
              className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Spara
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BucketPolicyModal;
