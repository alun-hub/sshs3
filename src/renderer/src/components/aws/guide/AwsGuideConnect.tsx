import React from 'react';
import { FolderOpen } from 'lucide-react';
import type { SsmMode } from '@shared/types/ssm';

const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';
const choice = (on: boolean) =>
  `rounded-lg border px-3 py-1.5 text-xs transition-colors ${on ? 'border-sky-500 bg-sky-500/15 text-sky-300' : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover'}`;

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
    <div role="radiogroup" aria-label="Connection type" className="flex flex-wrap gap-2">
      <button type="button" role="radio" aria-checked={value.mode === 'ssh'} onClick={() => onChange({ mode: 'ssh' })} className={choice(value.mode === 'ssh')}>
        SSH over SSM
      </button>
      <button type="button" role="radio" aria-checked={value.mode === 'shell'} onClick={() => onChange({ mode: 'shell' })} className={choice(value.mode === 'shell')}>
        Session Manager shell (no SSH)
      </button>
    </div>

    {value.mode === 'shell' ? (
      <p className="text-txt-muted">A terminal like the AWS console's Session Manager: IAM decides who may connect, and the instance needs no SSH daemon or key. The file manager, tunnels and key install need SSH.</p>
    ) : (
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="SSH authentication" className="flex flex-wrap items-center gap-2">
          <span className="text-txt-muted">Authentication</span>
          <button type="button" role="radio" aria-checked={value.authType === 'agent'} onClick={() => onChange({ authType: 'agent' })} className={choice(value.authType === 'agent')}>
            SSH agent
          </button>
          <button type="button" role="radio" aria-checked={value.authType === 'privateKey'} onClick={() => onChange({ authType: 'privateKey' })} className={choice(value.authType === 'privateKey')}>
            Private key file
          </button>
        </div>
        {value.authType === 'privateKey' && (
          <div className="flex gap-2">
            <input
              data-testid="guide-key-path"
              aria-label="Private key file"
              value={value.privateKeyPath}
              onChange={(e) => onChange({ privateKeyPath: e.target.value.trim() })}
              placeholder="~/.ssh/id_ed25519"
              className={`${input} flex-1 font-mono`}
            />
            <button
              type="button"
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
