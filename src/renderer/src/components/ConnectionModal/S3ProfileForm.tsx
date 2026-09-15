import React, { useState } from 'react';
import { FolderOpen } from 'lucide-react';
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
  const selfSigned = config.rejectUnauthorized === false;

  const update = <K extends keyof S3Config>(key: K, value: S3Config[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
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

      <div className="mt-2 flex justify-end gap-2">
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
    </form>
  );
};

export default S3ProfileForm;
