import React from 'react';
import { Server, Cloud } from 'lucide-react';
import type { StorageConnectConfig } from '@shared/types/ipc';

export interface SyncTargetDraft {
  type: 'sftp' | 's3';
  // SFTP fields
  host: string;
  port: number;
  username: string;
  password: string;
  // S3 fields
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  // Common: where under the connection the .sshs3 folder is created.
  // For S3 this MUST include the bucket (S3Config carries no bucket itself —
  // an S3 "remotePath" is always "bucket/key...").
  remoteBasePath: string;
}

export function emptySyncTargetDraft(): SyncTargetDraft {
  return {
    type: 'sftp',
    host: '',
    port: 22,
    username: '',
    password: '',
    endpoint: '',
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
    remoteBasePath: '',
  };
}

const SYNC_TARGET_ID = 'sshs3-remote-profile-sync';

export function buildSyncTarget(draft: SyncTargetDraft): StorageConnectConfig {
  if (draft.type === 'sftp') {
    return {
      id: SYNC_TARGET_ID,
      name: 'Remote profile sync',
      type: 'sftp',
      sftpConfig: {
        host: draft.host,
        port: draft.port || 22,
        username: draft.username,
        authType: 'password',
        password: draft.password,
      },
    };
  }
  return {
    id: SYNC_TARGET_ID,
    name: 'Remote profile sync',
    type: 's3',
    s3Config: {
      id: SYNC_TARGET_ID,
      name: 'Remote profile sync',
      endpoint: draft.endpoint || undefined,
      region: draft.region,
      accessKeyId: draft.accessKeyId,
      secretAccessKey: draft.secretAccessKey,
    },
  };
}

export function validateSyncTargetDraft(draft: SyncTargetDraft): string | null {
  if (draft.type === 'sftp') {
    if (!draft.host.trim()) return 'Host is required';
    if (!draft.username.trim()) return 'Username is required';
    if (!draft.password) return 'Password is required';
  } else {
    if (!draft.region.trim()) return 'Region is required';
    if (!draft.accessKeyId.trim()) return 'Access key ID is required';
    if (!draft.secretAccessKey) return 'Secret access key is required';
    if (!draft.remoteBasePath.trim()) return 'A bucket (optionally "bucket/prefix") is required for an S3 target';
  }
  return null;
}

interface SyncTargetFormProps {
  draft: SyncTargetDraft;
  onChange: (draft: SyncTargetDraft) => void;
  disabled?: boolean;
}

const inputClass =
  'w-full rounded-lg border border-border-subtle bg-app-input px-3 py-2 text-xs text-txt-primary outline-none focus:border-sky-500 disabled:opacity-50';
const labelClass = 'text-xs font-medium text-txt-primary';

let fieldIdCounter = 0;

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: (id: string) => React.ReactNode;
}) {
  const [id] = React.useState(() => `sync-target-field-${++fieldIdCounter}`);
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children(id)}
    </div>
  );
}

export const SyncTargetForm: React.FC<SyncTargetFormProps> = ({ draft, onChange, disabled }) => {
  const set = <K extends keyof SyncTargetDraft>(key: K, value: SyncTargetDraft[K]) => {
    onChange({ ...draft, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => set('type', 'sftp')}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            draft.type === 'sftp'
              ? 'border-sky-500 bg-sky-500/15 text-sky-300'
              : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
          }`}
        >
          <Server className="h-4 w-4" />
          SFTP server
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => set('type', 's3')}
          className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            draft.type === 's3'
              ? 'border-sky-500 bg-sky-500/15 text-sky-300'
              : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary'
          }`}
        >
          <Cloud className="h-4 w-4" />
          S3 bucket
        </button>
      </div>

      {draft.type === 'sftp' ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="Host" className="col-span-2">
              {(id) => (
                <input
                  id={id}
                  type="text"
                  disabled={disabled}
                  value={draft.host}
                  onChange={(e) => set('host', e.target.value)}
                  placeholder="sync.example.com"
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Port">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  disabled={disabled}
                  value={draft.port}
                  onChange={(e) => set('port', parseInt(e.target.value, 10) || 22)}
                  className={inputClass}
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Username">
              {(id) => (
                <input
                  id={id}
                  type="text"
                  disabled={disabled}
                  value={draft.username}
                  onChange={(e) => set('username', e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Password">
              {(id) => (
                <input
                  id={id}
                  type="password"
                  disabled={disabled}
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) => set('password', e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
          </div>
          <Field label="Remote directory (optional)">
            {(id) => (
              <input
                id={id}
                type="text"
                disabled={disabled}
                value={draft.remoteBasePath}
                onChange={(e) => set('remoteBasePath', e.target.value)}
                placeholder="Leave empty to use the home directory"
                className={inputClass}
              />
            )}
          </Field>
        </div>
      ) : (
        <div className="space-y-2.5">
          <Field label="Endpoint (optional — for MinIO, R2, etc.)">
            {(id) => (
              <input
                id={id}
                type="text"
                disabled={disabled}
                value={draft.endpoint}
                onChange={(e) => set('endpoint', e.target.value)}
                placeholder="https://s3.example.com"
                className={inputClass}
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Region">
              {(id) => (
                <input
                  id={id}
                  type="text"
                  disabled={disabled}
                  value={draft.region}
                  onChange={(e) => set('region', e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Bucket (or bucket/prefix)">
              {(id) => (
                <input
                  id={id}
                  type="text"
                  disabled={disabled}
                  value={draft.remoteBasePath}
                  onChange={(e) => set('remoteBasePath', e.target.value)}
                  placeholder="my-bucket/sshs3-sync"
                  className={inputClass}
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Access key ID">
              {(id) => (
                <input
                  id={id}
                  type="text"
                  disabled={disabled}
                  value={draft.accessKeyId}
                  onChange={(e) => set('accessKeyId', e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Secret access key">
              {(id) => (
                <input
                  id={id}
                  type="password"
                  disabled={disabled}
                  autoComplete="new-password"
                  value={draft.secretAccessKey}
                  onChange={(e) => set('secretAccessKey', e.target.value)}
                  className={inputClass}
                />
              )}
            </Field>
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncTargetForm;
