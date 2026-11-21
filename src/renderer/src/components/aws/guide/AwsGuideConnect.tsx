import React from 'react';
import { FolderOpen } from 'lucide-react';
import type { SsmMode } from '@shared/types/ssm';
import { SegmentedChoice, type SegmentedOption } from '../../ui/SegmentedChoice';

const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';

const MODES: readonly SegmentedOption<SsmMode>[] = [
  { value: 'ssh', label: 'SSH over SSM' },
  { value: 'shell', label: 'Session Manager shell (no SSH)' },
];
const AUTH: readonly SegmentedOption<ConnectChoice['authType']>[] = [
  { value: 'agent', label: 'SSH agent' },
  { value: 'privateKey', label: 'Private key file' },
];

export interface ConnectChoice {
  mode: SsmMode;
  authType: 'agent' | 'privateKey';
  privateKeyPath: string;
}

interface Props {
  value: ConnectChoice;
  onChange: (patch: Partial<ConnectChoice>) => void;
}

/** How the imported profiles connect: SSH over SSM (with SSH authentication) or a Session Manager shell. */
export const AwsGuideConnect: React.FC<Props> = ({ value, onChange }) => (
  <section className="flex flex-col gap-2" aria-label="How to connect">
    <span className="font-medium text-txt-secondary">Connect with</span>
    <SegmentedChoice label="Connection type" options={MODES} value={value.mode ?? 'ssh'} onChange={(mode) => onChange({ mode })} />

    {value.mode === 'shell' ? (
      <p className="text-txt-muted">A terminal like the AWS console's Session Manager: IAM decides who may connect, and the instance needs no SSH daemon or key. The file manager, tunnels and key install need SSH.</p>
    ) : (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-txt-muted" aria-hidden="true">Authentication</span>
          <SegmentedChoice label="SSH authentication" options={AUTH} value={value.authType} onChange={(authType) => onChange({ authType })} />
        </div>
        {value.authType === 'privateKey' && (
          <div className="flex gap-2">
            <input
              data-testid="guide-key-path"
              aria-label="Private key file"
              value={value.privateKeyPath}
              onChange={(e) => onChange({ privateKeyPath: e.target.value })}
              placeholder="~/.ssh/id_ed25519"
              className={`${input} flex-1 font-mono`}
            />
            <button
              type="button"
              aria-label="Browse for a private key file"
              className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs text-txt-primary hover:bg-app-surface-hover"
              onClick={() => void window.multissh.dialogOpenFile({ title: 'Choose Private Key' }).then((p) => p && onChange({ privateKeyPath: p }))}
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Browse
            </button>
          </div>
        )}
        <p className="text-txt-muted">
          {value.authType === 'agent' ? 'Uses a key loaded in your SSH agent (ssh-add). The instance must accept that key.' : 'The key must match the key pair the instance was launched with, or one added to its authorized_keys.'}
        </p>
      </div>
    )}
  </section>
);
