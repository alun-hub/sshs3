import React from 'react';
import type { SSHConnectionConfig } from '@shared/types/ssh';

export type JumpHostMode = 'none' | 'profile' | 'custom';

interface Props {
  config: SSHConnectionConfig;
  /** Other saved profiles that may serve as the jump host. */
  profiles: readonly SSHConnectionConfig[];
  mode: JumpHostMode;
  onMode: (mode: JumpHostMode) => void;
  update: <K extends keyof SSHConnectionConfig>(key: K, value: SSHConnectionConfig[K]) => void;
}

/** "Jump Host / ProxyJump": none, another saved profile (never an SSM profile) or a typed `user@host:port`. */
export const JumpHostField: React.FC<Props> = ({ config, profiles, mode, onMode, update }) => (
  <label className="flex flex-col gap-1 text-txt-secondary">
    Jump Host / ProxyJump (optional)
    <select
      value={mode === 'none' ? '' : mode === 'custom' ? '__custom__' : config.proxyJumpProfileId ?? ''}
      onChange={(e) => {
        const value = e.target.value;
        if (value === '') {
          onMode('none');
          update('proxyJumpProfileId', undefined);
          update('proxyJump', undefined);
        } else if (value === '__custom__') {
          onMode('custom');
          update('proxyJumpProfileId', undefined);
        } else {
          onMode('profile');
          update('proxyJumpProfileId', value);
          update('proxyJump', undefined);
        }
      }}
      className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500"
    >
      <option value="">None</option>
      {profiles
        .filter((p) => p.id !== config.id && p.proxyJumpProfileId !== config.id && !p.ssm?.enabled)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name || p.host}
          </option>
        ))}
      <option value="__custom__">Custom (enter manually)</option>
    </select>
    {mode === 'custom' && (
      <input
        value={config.proxyJump ?? ''}
        onChange={(e) => update('proxyJump', e.target.value)}
        className="mt-1 rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
        placeholder="e.g. jumpuser@bastion.example.com:22"
      />
    )}
  </label>
);
