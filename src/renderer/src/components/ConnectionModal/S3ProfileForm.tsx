import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, FolderOpen, KeyRound, Loader2 } from 'lucide-react';
import type { S3Config } from '@shared/types/storage';
import { describeIpcError } from '../../lib/format';
import { useAwsEnabled } from '../../lib/awsEnabled';
import { AwsSsoSignInPanel } from '../AwsSsoSignInPanel';
import { S3BucketPickerModal } from '../S3BucketPickerModal';
import { ProfileOrganizationFields } from './ProfileOrganizationFields';

interface S3ProfileFormProps {
  initial?: S3Config;
  onSave: (config: S3Config) => void;
  onCancel: () => void;
  /** See `SSHProfileFormProps.folderSuggestions` — same Team Vault folder-path autocomplete. */
  folderSuggestions?: string[];
  /** See `SSHProfileFormProps.tagSuggestions`. */
  tagSuggestions?: string[];
  /** See `SSHProfileFormProps.canEditSecret` — same Team Vault admin-only secret gate, applied
   * here to `secretAccessKey`/`sessionToken`. */
  canEditSecret?: boolean;
}

function emptyConfig(): S3Config {
  return {
    id: crypto.randomUUID(),
    name: '',
    region: 'us-east-1',
    authMode: 'static',
    accessKeyId: '',
    secretAccessKey: '',
    forcePathStyle: false,
    ssl: true,
    rejectUnauthorized: true,
  };
}

export const S3ProfileForm: React.FC<S3ProfileFormProps> = ({
  initial,
  onSave,
  onCancel,
  folderSuggestions,
  tagSuggestions,
  canEditSecret = true,
}) => {
  const [config, setConfig] = useState<S3Config>(initial ?? emptyConfig());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const selfSigned = config.rejectUnauthorized === false;
  const authMode = config.authMode ?? 'static';
  // AWS features off: only access keys are offered. A profile that uses SSO keeps the choice (and keeps working).
  const awsEnabled = useAwsEnabled();
  const showAuthToggle = awsEnabled || authMode === 'sso';
  const [pickingBucket, setPickingBucket] = useState(false);
  const [bucketNote, setBucketNote] = useState<string | null>(null);
  // "Pick bucket" needs a complete SSO choice; the list itself is fetched by the main process from the cached sign-in.
  const bucketRequest =
    authMode === 'sso' && config.sso?.startUrl && config.sso.accountId && config.sso.roleName
      ? {
          startUrl: config.sso.startUrl,
          region: config.sso.region || config.region || 'us-east-1',
          accountId: config.sso.accountId,
          roleName: config.sso.roleName,
          s3ProfileId: initial ? config.id : undefined,
        }
      : null;
  const pickBucket = (bucket: string, region: string | undefined) => {
    setConfig((prev) => ({ ...prev, initialPath: bucket, name: prev.name.trim() ? prev.name : bucket, ...(region ? { region } : {}) }));
    setBucketNote(region ? `Region set to ${region}.` : 'The region of this bucket could not be told: check the Region field.');
    if (testResult) setTestResult(null);
    setPickingBucket(false);
  };

  const update = <K extends keyof S3Config>(key: K, value: S3Config[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    if (testResult) setTestResult(null);
  };

  const updateSso = (patch: Partial<NonNullable<S3Config['sso']>>) => {
    setConfig((prev) => ({
      ...prev,
      sso: { startUrl: '', region: prev.region || 'us-east-1', ...prev.sso, ...patch },
    }));
    if (testResult) setTestResult(null);
  };

  const setAuthMode = (mode: 'static' | 'sso') => {
    setConfig((prev) => ({ ...prev, authMode: mode }));
    setTestResult(null);
  };

  // Same proxy/custom-CA override the S3 client itself uses, so SSO sign-in
  // behind a corporate TLS-intercepting proxy hits the OIDC endpoint the
  // same way the S3 calls will once the profile is saved.
  const ssoNetworkOptions = () => ({
    customCaPath: config.customCaPath,
    rejectUnauthorized: config.rejectUnauthorized,
    proxy: config.proxy,
  });

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
        message: describeIpcError(err, 'Failed to test connection'),
      });
    } finally {
      setTesting(false);
    }
  };

  const browseForCa = async () => {
    const path = await window.multissh.dialogOpenFile({ title: 'Choose CA Certificate' });
    if (path) update('customCaPath', path);
  };

  const isValid =
    config.name.trim() &&
    config.region.trim() &&
    (authMode === 'sso'
      ? Boolean(config.sso?.startUrl?.trim() && config.sso?.accountId?.trim() && config.sso?.roleName?.trim())
      : Boolean(config.accessKeyId.trim() && (canEditSecret ? config.secretAccessKey.trim() : true)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isValid) onSave(config);
      }}
      className="flex h-full min-h-0 flex-col text-xs text-txt-secondary"
    >
      {/* Scrollable field area is a separate flex child from the footer below
          (UX review #11 bugfix) so a `sticky` footer can never render on top
          of fields revealed by expanding a collapsible section. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 pb-6 flex flex-col gap-3.5">
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
        <ProfileOrganizationFields
          group={config.group}
          tags={config.tags}
          onGroupChange={(group) => update('group', group)}
          onTagsChange={(tags) => update('tags', tags)}
          groupPlaceholder="e.g. Production or MinIO"
          folderSuggestions={folderSuggestions}
          tagSuggestions={tagSuggestions}
        />
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

      {showAuthToggle && (
        <div className="flex gap-1.5 rounded-lg border border-border-subtle bg-app-surface-subtle p-1">
          <button
            type="button"
            onClick={() => setAuthMode('static')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              authMode === 'static'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Access Keys
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('sso')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              authMode === 'sso'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
            }`}
          >
            <Cloud className="h-3.5 w-3.5" />
            AWS SSO
          </button>
        </div>
      )}
      {!awsEnabled && authMode === 'sso' && (
        <p role="note" className="text-xs text-amber-300">
          AWS features are off (Settings → AWS). This profile keeps working.
        </p>
      )}

      {authMode === 'static' ? (
        <>
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
                required={canEditSecret}
                type="password"
                value={config.secretAccessKey}
                onChange={(e) => update('secretAccessKey', e.target.value)}
                disabled={!canEditSecret}
                placeholder={
                  !canEditSecret ? (config.hasSecretAccessKey ? '•••• (admin only)' : 'Not set (admin only)') : undefined
                }
                className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 font-mono disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-txt-secondary">
            Session Token (optional, for temporary IAM credentials)
            <input
              value={config.sessionToken ?? ''}
              onChange={(e) => update('sessionToken', e.target.value)}
              disabled={!canEditSecret}
              placeholder={!canEditSecret ? '•••• (admin only)' : undefined}
              className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 font-mono disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          {!canEditSecret && (
            <p className="text-xs text-txt-muted">
              Only a Team Vault admin can see or change this secret key. You can still connect using it.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-app-surface-subtle p-3">
          <AwsSsoSignInPanel
            idPrefix="s3-sso"
            useSavedSignIns
            value={{
              startUrl: config.sso?.startUrl ?? '',
              region: config.sso?.region || config.region || 'us-east-1',
              accountId: config.sso?.accountId,
              roleName: config.sso?.roleName,
            }}
            onChange={updateSso}
            network={ssoNetworkOptions()}
            s3ProfileId={initial ? config.id : undefined}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="s3-pick-bucket"
              disabled={!bucketRequest}
              title={bucketRequest ? undefined : 'Sign in and choose an account and role first'}
              onClick={() => setPickingBucket(true)}
              className="rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs text-txt-primary hover:bg-app-surface-hover disabled:opacity-40"
            >
              Pick bucket…
            </button>
            {bucketNote && <span role="status" className="text-xs text-txt-muted">{bucketNote}</span>}
          </div>
          {pickingBucket && bucketRequest && <S3BucketPickerModal request={bucketRequest} onPick={pickBucket} onClose={() => setPickingBucket(false)} />}
        </div>
      )}

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
                aria-label="Browse"
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

      <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-app-surface-subtle p-3">
        <label className="flex flex-col gap-1 text-txt-secondary">
          Server-side encryption
          <select
            value={config.serverSideEncryption ?? 'none'}
            onChange={(e) => update('serverSideEncryption', e.target.value as S3Config['serverSideEncryption'])}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500"
          >
            <option value="none">None</option>
            <option value="AES256">SSE-S3 (AES256)</option>
            <option value="aws:kms">SSE-KMS</option>
          </select>
        </label>
        {config.serverSideEncryption === 'aws:kms' && (
          <label className="flex flex-col gap-1 text-txt-secondary">
            KMS Key ID (optional — blank uses the bucket's default key)
            <input
              value={config.kmsKeyId ?? ''}
              onChange={(e) => update('kmsKeyId', e.target.value)}
              placeholder="arn:aws:kms:us-east-1:111122223333:key/…"
              className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 font-mono"
            />
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
          <div className="mt-2.5 space-y-2 text-xs pt-2 border-t border-divider">
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
                  disabled={!canEditSecret}
                  placeholder={!canEditSecret ? '•••• (admin only)' : undefined}
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            </div>
          </div>
        )}
      </div>
      </div>

      <div className="shrink-0 flex items-center justify-between gap-2 border-t border-divider bg-app-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            disabled={!isValid || testing}
            onClick={() => void handleTestConnection()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs text-txt-primary hover:bg-app-surface-hover disabled:opacity-40 transition-colors"
          >
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>

          {testResult && (
            <div
              className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                testResult.success ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-400" />
              )}
              <span className="truncate">{testResult.message}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
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
