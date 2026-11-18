import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, Loader2, Plus, Settings } from 'lucide-react';
import type { AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import { useAwsEnabled } from '../../lib/awsEnabled';
import { badgeTitle, badgeTone, buildBadgeRows, type BadgeRow } from '../../lib/awsBadge';
import { describeSsoStatus } from '../../lib/awsSsoStatus';
import { describeIpcError } from '../../lib/format';
import { useAwsSignInStatuses } from '../../lib/useAwsSignInStatuses';
import { AwsImportFlow } from './AwsImportFlow';

interface Props {
  /** Opens Settings on the AWS page. */
  onOpenAwsSettings?: () => void;
}

const TONE_CLASS = { ok: 'text-emerald-400 hover:text-emerald-300', attention: 'text-amber-300 hover:text-amber-200', none: 'text-txt-muted hover:text-txt-primary' } as const;
const secondary =
  'flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1.5 text-xs font-medium text-txt-primary hover:bg-app-surface-hover hover:border-border-strong transition-colors disabled:opacity-50';

/**
 * Top-bar button for AWS IAM Identity Center sign-ins, next to the SSH CA badge: green when signed in, amber when a
 * sign-in that saved profiles use has expired. The popover lists the sign-ins and signs in, adds instances from AWS
 * and opens Settings → AWS. Hidden while AWS features are off.
 */
export const AwsSsoStatusBadge: React.FC<Props> = ({ onOpenAwsSettings }) => {
  const awsEnabled = useAwsEnabled();
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [profiles, setProfiles] = useState<SSHConnectionConfig[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    window.multissh?.settingsGet?.().then(setSettings).catch(() => {});
    window.multissh?.profilesGet?.().then((p) => setProfiles(p.ssh ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!awsEnabled) return;
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [awsEnabled, load]);

  const rows: BadgeRow[] = buildBadgeRows(settings, profiles);
  const { statuses, refresh } = useAwsSignInStatuses(rows, awsEnabled);
  const tone = badgeTone(rows, statuses);

  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, importing]);

  if (!awsEnabled) return null;

  const signIn = async (row: BadgeRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await window.multissh.awsSsoLogin(row.startUrl, row.region);
      refresh();
    } catch (err) {
      setError(describeIpcError(err, 'AWS SSO login failed').replace(/^Error:\s*/, ''));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="aws-status-btn"
        aria-label="AWS sign-ins"
        aria-haspopup="true"
        aria-expanded={isOpen}
        title={badgeTitle(tone, rows)}
        onClick={() => {
          setIsOpen((v) => !v);
          load();
          refresh();
        }}
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-app-surface-hover ${TONE_CLASS[tone]}`}
      >
        {busyId ? <Loader2 className="h-4 w-4 animate-spin text-sky-400" /> : tone === 'attention' ? <AlertCircle className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="dialog"
          aria-label="AWS sign-ins"
          className="absolute right-0 top-8 z-50 w-80 rounded-xl border border-border-subtle bg-app-card p-2.5 text-xs text-txt-primary shadow-2xl animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="mb-2 flex items-center gap-1.5 border-b border-divider pb-2 font-semibold">
            <Cloud className="h-4 w-4 text-sky-400" aria-hidden="true" />
            <span>AWS</span>
          </div>

          {error && (
            <div role="alert" className="mb-2 flex items-start gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-2xs text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="mb-2 rounded-lg border border-border-subtle/50 bg-app-surface/40 p-2 text-2xs text-txt-muted">
              No AWS sign-ins yet. Add your IAM Identity Center start URL in Settings → AWS, or use an AWS CLI profile when you add instances.
            </p>
          ) : (
            <ul className="mb-2 max-h-64 space-y-1.5 overflow-y-auto" aria-label="Sign-ins">
              {rows.map((row) => {
                const info = describeSsoStatus(statuses[row.id] ?? null, false);
                const signedIn = statuses[row.id]?.status === 'valid';
                return (
                  <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle/60 bg-app-surface/60 p-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{row.name}</div>
                      <div className={`flex items-center gap-1 text-2xs ${info.tone === 'ok' ? 'text-emerald-400' : info.tone === 'warn' || (row.used && !signedIn && statuses[row.id]) ? 'text-amber-300' : 'text-txt-muted'}`}>
                        {info.tone === 'ok' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                        {info.text}
                      </div>
                    </div>
                    <button type="button" className={secondary} disabled={busyId === row.id} onClick={() => void signIn(row)}>
                      {busyId === row.id ? 'Signing in…' : signedIn ? 'Sign in again' : 'Sign in'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-1.5 border-t border-divider pt-2">
            <button
              type="button"
              className={secondary}
              onClick={() => {
                setImporting(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add instances from AWS…
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => {
                setIsOpen(false);
                onOpenAwsSettings?.();
              }}
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" /> AWS settings…
            </button>
          </div>
        </div>
      )}

      {importing && (
        <AwsImportFlow
          profiles={profiles}
          onDone={() => {
            setImporting(false);
            setIsOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
};
