import React from 'react';
import { isSsmShellProfile } from '@shared/ssm';
import type { SSHConnectionConfig } from '@shared/types/ssh';

/** "SSM" / "SSM shell" chip of a profile row; nothing for a profile that does not use AWS Systems Manager. */
export const SsmBadge: React.FC<{ profile: Pick<SSHConnectionConfig, 'ssm'> }> = ({ profile }) => {
  if (!profile.ssm?.enabled) return null;
  const shell = isSsmShellProfile(profile);
  return (
    <span
      title={shell ? 'Session Manager shell, no SSH' : 'Connects through AWS Systems Manager'}
      className="rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.2 text-2xs text-sky-400"
    >
      {shell ? 'SSM shell' : 'SSM'}
    </span>
  );
};
