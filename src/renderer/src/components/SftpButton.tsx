import React from 'react';
import { Files } from 'lucide-react';
import { isSsmShellProfile } from '@shared/ssm';
import type { SshSsmConfig } from '@shared/types/ssm';
import { sftpUnavailableReason } from '../lib/platform';

interface SftpButtonProps {
  authType: string | undefined;
  /** A Session Manager shell profile has no SSH, so there is nothing for SFTP to open: the button is not shown. */
  ssm?: Pick<SshSsmConfig, 'enabled' | 'mode'>;
  onOpen: () => void;
  /** Nothing to open yet (e.g. an empty quick-connect box); greyed out like the Connect button next to it. */
  disabled?: boolean;
  /** 'icon': the compact button of a terminal pane header, styled like its neighbours. */
  variant?: 'default' | 'icon';
  /** Shortcut shown in the icon button's tooltip. */
  shortcut?: string;
  testId?: string;
}

/**
 * The "SFTP" quick-action shown next to an SSH profile. For profiles that can't use SFTP (see
 * sftpUnavailableReason) it stays visible but is greyed out and explains why on hover, so the
 * limitation is discoverable instead of the button silently failing after a PIN/touch prompt.
 */
export const SftpButton: React.FC<SftpButtonProps> = ({
  authType,
  ssm,
  onOpen,
  disabled = false,
  variant = 'default',
  shortcut,
  testId,
}) => {
  if (isSsmShellProfile({ ssm })) return null;
  const unavailableReason = sftpUnavailableReason(authType);
  if (variant === 'icon') {
    const label = 'Open SFTP for this server';
    return (
      <button
        type="button"
        aria-label={label}
        title={unavailableReason ?? (shortcut ? `${label} (${shortcut})` : label)}
        aria-disabled={unavailableReason ? true : undefined}
        disabled={disabled}
        data-testid={testId}
        onClick={() => {
          if (!unavailableReason) onOpen();
        }}
        className={
          'rounded p-1.5 transition-colors ' +
          (unavailableReason ? 'cursor-not-allowed opacity-50' : 'hover:bg-app-surface-hover hover:text-txt-primary')
        }
      >
        <Files className="h-3 w-3" />
      </button>
    );
  }
  return (
    <button
      type="button"
      title={unavailableReason ?? 'Open SFTP in Dual-Pane File Manager'}
      aria-disabled={unavailableReason ? true : undefined}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!unavailableReason) onOpen();
      }}
      className={
        'flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium shadow-sm transition-colors ' +
        (unavailableReason
          ? 'cursor-not-allowed bg-app-surface text-txt-muted opacity-50'
          : 'bg-sky-700 text-white hover:bg-sky-600 disabled:opacity-40 disabled:hover:bg-sky-700')
      }
    >
      <Files className="h-3 w-3" />
      SFTP
    </button>
  );
};
