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
        setTestResult({ success: true, message: 'Connection to S3 succeeded!' });
      } else {
        setTestResult({ success: false, message: res.error || 'Connection failed' });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to test connection',
      });
    } finally {
      setTesting(false);
    }
  };

  const browseForCa = async () => {
    const path = await window.multissh.dialogOpenFile({ title: 'Choose CA Certificate' });
    if (path) update('customCaPath', path);
  };

  const isValid = config.name.trim() && config.region.trim() && config.accessKeyId.trim() && config.secretAccessKey.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isValid) onSave(config);
      }}
      className="flex flex-col gap-3.5 text-xs text-txt-secondary"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-txt-secondary">
          Profile Name
          <input
            required
            value={config.name}
            onChange={(e) => update('name', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="e.g. Backup Bucket"
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          Group / Folder (optional)
          <input
            value={config.group ?? ''}
            onChange={(e) => update('group', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="e.g. Production or MinIO"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-txt-secondary">
          Region
          <input
            required
            value={config.region}
            onChange={(e) => update('region', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="us-east-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          Endpoint URL (leave blank for AWS S3)
          <input
            value={config.endpoint ?? ''}
            onChange={(e) => update('endpoint', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="e.g. https://minio.internal:9000"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-txt-secondary">
        Initial Path (optional)
        <input
          value={config.initialPath ?? ''}
          onChange={(e) => update('initialPath', e.target.value)}
          className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
          placeholder="e.g. bucket-name or bucket-name/folder (default: /)"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-txt-secondary">
          Access Key ID
          <input
            required
            value={config.accessKeyId}
            onChange={(e) => update('accessKeyId', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          Secret Access Key
          <input
            required
            type="password"
            value={config.secretAccessKey}
            onChange={(e) => update('secretAccessKey', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 font-mono"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-txt-secondary">
        Session Token (optional, for temporary IAM credentials)
        <input
          value={config.sessionToken ?? ''}
          onChange={(e) => update('sessionToken', e.target.value)}
          className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 font-mono"
        />
      </label>

      <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-app-surface-subtle p-3">
        <label className="flex items-center gap-2 text-xs text-txt-primary cursor-pointer">
          <input
            type="checkbox"
            checked={config.forcePathStyle ?? false}
            onChange={(e) => update('forcePathStyle', e.target.checked)}
            className="h-4 w-4 rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
          />
          <span>Path-style addressing (commonly required for MinIO / NetApp)</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-txt-primary cursor-pointer">
          <input
            type="checkbox"
            checked={config.ssl ?? true}
            onChange={(e) => update('ssl', e.target.checked)}
            className="h-4 w-4 rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
          />
          <span>Use SSL/TLS</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-txt-primary cursor-pointer">
          <input
            type="checkbox"
            checked={selfSigned}
            onChange={(e) => update('rejectUnauthorized', !e.target.checked)}
            className="h-4 w-4 rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
          />
          <span>Allow self-signed certificates</span>
        </label>
        {selfSigned && (
          <label className="ml-6 flex flex-col gap-1 text-xs text-txt-secondary">
            Custom CA (optional)
            <div className="flex gap-1.5">
              <input
                value={config.customCaPath ?? ''}
                onChange={(e) => update('customCaPath', e.target.value)}
                className="flex-1 rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                placeholder="Path to CA certificate (.pem)"
              />
              <button
                type="button"
                onClick={() => void browseForCa()}
                className="rounded-lg border border-border-subtle px-2.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                title="Browse"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </label>
        )}
      </div>

      {/* Outgoing Proxy */}
      <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5">
        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-txt-primary">
          <input
            type="checkbox"
            checked={Boolean(config.proxy?.enabled)}
            onChange={(e) => {
              const enabled = e.target.checked;
              setConfig((prev) => ({
                ...prev,
                proxy: {
                  enabled,
                  type: prev.proxy?.type ?? 'http',
                  host: prev.proxy?.host ?? '',
                  port: prev.proxy?.port ?? 8080,
                  username: prev.proxy?.username ?? '',
                  password: prev.proxy?.password ?? '',
                },
              }));
            }}
            className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
          />
          <span>Outgoing Proxy (HTTP / SOCKS)</span>
        </label>

        {config.proxy?.enabled && (
          <div className="mt-2.5 space-y-2 text-xs pt-2 border-t border-border-subtle">
            <div className="grid grid-cols-[110px_1fr_90px] gap-2">
              <label className="flex flex-col gap-1 text-txt-secondary">
                Proxy Type
                <select
                  value={config.proxy.type}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: {
                        ...prev.proxy!,
                        type: e.target.value as any,
                        port:
                          prev.proxy?.port === 1080 || prev.proxy?.port === 8080
                            ? e.target.value === 'http'
                              ? 8080
                              : 1080
                            : prev.proxy?.port ?? 8080,
                      },
                    }))
                  }
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
                >
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="socks4">SOCKS4</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-txt-secondary">
                Proxy Host
                <input
                  value={config.proxy.host}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, host: e.target.value },
                    }))
                  }
                  placeholder="proxy.example.com"
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
                />
              </label>

              <label className="flex flex-col gap-1 text-txt-secondary">
                Port
                <input
                  type="number"
                  value={config.proxy.port || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, port: parseInt(e.target.value, 10) || 0 },
                    }))
                  }
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono text-center"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-txt-secondary">
                Username (optional)
                <input
                  value={config.proxy.username ?? ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, username: e.target.value },
                    }))
                  }
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-txt-secondary">
                Password (optional)
                <input
                  type="password"
                  value={config.proxy.password ?? ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, password: e.target.value },
                    }))
                  }
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {testResult && (
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            testResult.success
              ? 'border border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
              : 'border border-red-800/60 bg-red-950/40 text-red-300'
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

      <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 flex items-center justify-between gap-2 border-t border-border-subtle bg-app-card px-4 py-3">
        <button
          type="button"
          disabled={!config.region.trim() || !config.accessKeyId.trim() || !config.secretAccessKey.trim() || testing}
          onClick={() => void handleTestConnection()}
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs text-txt-primary hover:bg-app-surface-hover disabled:opacity-40 transition-colors"
        >
          {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {testing ? 'Testing...' : 'Test Connection'}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border-subtle px-3.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 shadow-sm transition-colors"
          >
            Save Profile
          </button>
        </div>
      </div>
    </form>
  );
};

export default S3ProfileForm;
