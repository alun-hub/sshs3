import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2 } from 'lucide-react';
import type { S3Config } from '@shared/types/storage';

interface S3ProfileFormProps {
  initial?: S3Config;
  onSave: (config: S3Config) => void;
  onCancel: () => void;
}

function emptyConfig(): S3Config {
  return {
    id: crypto.randomUUID(),
    name: '',
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: false,
    ssl: true,
    rejectUnauthorized: true,
  };
}

export const S3ProfileForm: React.FC<S3ProfileFormProps> = ({ initial, onSave, onCancel }) => {
  const [config, setConfig] = useState<S3Config>(initial ?? emptyConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const selfSigned = config.rejectUnauthorized === false;

  const update = <K extends keyof S3Config>(key: K, value: S3Config[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    if (testResult) setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.multissh.testS3Connection(config);
      if (res.success) {
        setTestResult({ success: true, message: 'Anslutningen till S3 lyckades!' });
      } else {
        setTestResult({ success: false, message: res.error || 'Anslutningen misslyckades' });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Kunde inte testa anslutningen',
      });
    } finally {
      setTesting(false);
    }
  };

  const browseForCa = async () => {
    const path = await window.multissh.dialogOpenFile({ title: 'Välj CA-certifikat' });
    if (path) update('customCaPath', path);
  };

  const isValid = config.name.trim() && config.region.trim() && config.accessKeyId.trim() && config.secretAccessKey.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isValid) onSave(config);
      }}
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Profilnamn
          <input
            required
            value={config.name}
            onChange={(e) => update('name', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            placeholder="t.ex. Backup-bucket"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Region
          <input
            required
            value={config.region}
            onChange={(e) => update('region', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            placeholder="us-east-1"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Endpoint (lämna tomt för AWS S3)
        <input
          value={config.endpoint ?? ''}
          onChange={(e) => update('endpoint', e.target.value)}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          placeholder="t.ex. https://minio.internal:9000 eller NetApp StorageGRID-URL"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Startsökväg (valfritt)
        <input
          value={config.initialPath ?? ''}
          onChange={(e) => update('initialPath', e.target.value)}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          placeholder="t.ex. bucket-namn eller bucket-namn/mapp (standard: /)"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Access Key ID
          <input
            required
            value={config.accessKeyId}
            onChange={(e) => update('accessKeyId', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Secret Access Key
          <input
            required
            type="password"
            value={config.secretAccessKey}
            onChange={(e) => update('secretAccessKey', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Session Token (valfritt, för tillfälliga IAM-credentials)
        <input
          value={config.sessionToken ?? ''}
          onChange={(e) => update('sessionToken', e.target.value)}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
      </label>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={config.forcePathStyle ?? false}
            onChange={(e) => update('forcePathStyle', e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
          />
          Path-style adressering (krävs ofta för MinIO / NetApp)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={config.ssl ?? true}
            onChange={(e) => update('ssl', e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
          />
          Använd SSL/TLS
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={selfSigned}
            onChange={(e) => update('rejectUnauthorized', !e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900"
          />
          Tillåt självsignerat certifikat
        </label>
        {selfSigned && (
          <label className="ml-6 flex flex-col gap-1 text-xs text-slate-400">
            Anpassad CA (valfritt)
            <div className="flex gap-1">
              <input
                value={config.customCaPath ?? ''}
                onChange={(e) => update('customCaPath', e.target.value)}
                className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                placeholder="Sökväg till CA-certifikat (.pem)"
              />
              <button
                type="button"
                onClick={() => void browseForCa()}
                className="rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-700"
                title="Bläddra"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </label>
        )}
      </div>

      {testResult && (
        <div
          className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs ${
            testResult.success
              ? 'border border-emerald-800 bg-emerald-950/60 text-emerald-300'
              : 'border border-red-800 bg-red-950/60 text-red-300'
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          )}
          <span className="truncate">{testResult.message}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          disabled={!config.region.trim() || !config.accessKeyId.trim() || !config.secretAccessKey.trim() || testing}
          onClick={() => void handleTestConnection()}
          className="flex items-center gap-1.5 rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {testing ? 'Testar...' : 'Testa anslutning'}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
          >
            Avbryt
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          >
            Spara profil
          </button>
        </div>
      </div>
    </form>
  );
};

export default S3ProfileForm;
