import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Cloud, Loader2 } from 'lucide-react';
import { allSignIns } from '@shared/awsSignIns';
import { normalizeStartUrl } from '@shared/ssm';
import type { AwsSignIn, AwsSsoNetworkOptions } from '@shared/types/aws';
import { describeSsoStatus } from '../lib/awsSsoStatus';
import { useAwsSsoSignIn, type AwsSsoValue } from '../lib/useAwsSsoSignIn';

type SignInState = ReturnType<typeof useAwsSsoSignIn>;

interface Props {
  value: AwsSsoValue;
  onChange: (patch: Partial<AwsSsoValue>) => void;
  network?: AwsSsoNetworkOptions;
  s3ProfileId?: string;
  /** false = start URL, region and the sign-in button only. */
  pickAccountRole?: boolean;
  /** Prefix for element ids and test ids when a page shows more than one panel. */
  idPrefix?: string;
  /**
   * Offer the sign-ins saved in Settings → AWS (and those from policy) as a **Saved sign-in** list, and fill in a new
   * form that is still empty when there is exactly one. Off in the editor that creates those sign-ins.
   */
  useSavedSignIns?: boolean;
}

const input =
  'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';

/** The sign-in controls (start URL, region, button, status, error) without account/role pickers. */
export const AwsSsoSignInFields: React.FC<{
  value: AwsSsoValue;
  onChange: (patch: Partial<AwsSsoValue>) => void;
  /** State from `useAwsSsoSignIn`, owned by the caller so it can also use the account list. */
  s: SignInState;
  idPrefix?: string;
  /** Enter in the start URL or region signs in (when both are valid). Off where the fields sit in a form that owns Enter. */
  submitOnEnter?: boolean;
}> = ({ value, onChange, s, idPrefix = 'aws-sso', submitOnEnter = false }) => {
  const info = describeSsoStatus(s.status, s.checking);
  const signedIn = s.status?.status === 'valid';
  const enterSignsIn = (e: React.KeyboardEvent) => {
    if (!submitOnEnter || e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (s.ready && !s.signingIn) void s.signIn();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-txt-secondary">
          SSO Start URL
          <input
            data-testid={`${idPrefix}-start-url`}
            value={value.startUrl}
            onChange={(e) => onChange({ startUrl: normalizeStartUrl(e.target.value) })}
            onKeyDown={enterSignsIn}
            placeholder="https://my-sso.awsapps.com/start"
            className={`${input} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          SSO Region
          <input
            data-testid={`${idPrefix}-region`}
            value={value.region}
            onChange={(e) => onChange({ region: e.target.value.trim() })}
            onKeyDown={enterSignsIn}
            placeholder="us-east-1"
            className={`${input} font-mono`}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid={`${idPrefix}-sign-in`}
          disabled={!s.ready || s.signingIn}
          onClick={() => void s.signIn()}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs text-txt-primary hover:bg-app-surface-hover disabled:opacity-40 transition-colors"
        >
          {s.signingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Cloud className="h-3.5 w-3.5" aria-hidden="true" />}
          {s.signingIn ? 'Signing in…' : signedIn ? 'Sign in again' : 'Sign in with AWS SSO'}
        </button>
        <span
          role="status"
          data-testid={`${idPrefix}-status`}
          className={`flex items-center gap-1 text-xs ${info.tone === 'ok' ? 'text-emerald-400' : info.tone === 'warn' ? 'text-amber-300' : 'text-txt-muted'}`}
        >
          {info.tone === 'ok' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
          {s.ready ? info.text : 'Enter the start URL and region to sign in'}
        </span>
      </div>

      {s.error && (
        <p role="alert" className="rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-red-300">
          {s.error}
        </p>
      )}
    </div>
  );
};

/**
 * AWS IAM Identity Center sign-in: start URL, region, a clear **Sign in** button, the sign-in status and, once signed
 * in, account and role pickers. Shared by the S3 profile form, the AWS sign-in list, the SSM profile form and the
 * instance import dialog so that signing in looks and behaves the same everywhere.
 */
export const AwsSsoSignInPanel: React.FC<Props> = ({ value, onChange, network, s3ProfileId, pickAccountRole = true, idPrefix = 'aws-sso', useSavedSignIns = false }) => {
  const s = useAwsSsoSignIn({ value, onChange, network, s3ProfileId, pickAccountRole });
  const signedIn = s.status?.status === 'valid';

  const [saved, setSaved] = useState<AwsSignIn[]>([]);
  useEffect(() => {
    if (!useSavedSignIns) return;
    let alive = true;
    window.multissh?.settingsGet?.().then((st) => alive && setSaved(allSignIns(st.awsSignIns, st.awsManagedSignIns))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [useSavedSignIns]);

  // A new, still empty form with exactly one saved sign-in starts from it, once. With several the user chooses, and a profile
  // that already has a start URL is never touched.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || saved.length === 0) return;
    prefilled.current = true;
    if (saved.length === 1 && !value.startUrl) onChange({ startUrl: saved[0].startUrl, region: saved[0].region });
  }, [saved, value.startUrl, onChange]);

  const savedId = saved.find((x) => x.startUrl === value.startUrl && x.region === value.region)?.id ?? '';
  const chooseSaved = (id: string) => {
    const pick = saved.find((x) => x.id === id);
    if (!pick || id === savedId) return; // "Other…" keeps what is typed
    onChange({ startUrl: pick.startUrl, region: pick.region, accountId: undefined, roleName: undefined });
  };

  return (
    <div className="flex flex-col gap-3">
      {useSavedSignIns && saved.length > 0 && (
        <label className="flex flex-col gap-1 text-txt-secondary">
          Saved sign-in
          <select data-testid={`${idPrefix}-saved-signin`} value={savedId} onChange={(e) => chooseSaved(e.target.value)} className={input}>
            <option value="">Other…</option>
            {saved.map((x) => (
              <option key={x.id} value={x.id}>{x.name} ({x.region})</option>
            ))}
          </select>
        </label>
      )}
      <AwsSsoSignInFields value={value} onChange={onChange} s={s} idPrefix={idPrefix} />

      {pickAccountRole && signedIn && !s.manualEntry && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-txt-secondary">
            Account
            <select
              data-testid={`${idPrefix}-account`}
              value={value.accountId ?? ''}
              onChange={(e) => s.selectAccount(e.target.value)}
              className={input}
            >
              <option value="">Select an account…</option>
              {s.accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.accountName ? `${a.accountName} (${a.accountId})` : a.accountId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-txt-secondary">
            Role
            <select
              data-testid={`${idPrefix}-role`}
              value={value.roleName ?? ''}
              onChange={(e) => onChange({ roleName: e.target.value || undefined })}
              disabled={!value.accountId || s.loadingRoles}
              className={`${input} disabled:opacity-40`}
            >
              <option value="">{s.loadingRoles ? 'Loading…' : 'Select a role…'}</option>
              {s.roles.map((r) => (
                <option key={r.roleName} value={r.roleName}>
                  {r.roleName}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {pickAccountRole && (s.manualEntry || (!signedIn && (value.accountId || value.roleName))) && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-txt-secondary">
            Account ID
            <input value={value.accountId ?? ''} onChange={(e) => onChange({ accountId: e.target.value.trim() || undefined })} className={`${input} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-txt-secondary">
            Role Name
            <input value={value.roleName ?? ''} onChange={(e) => onChange({ roleName: e.target.value.trim() || undefined })} className={`${input} font-mono`} />
          </label>
        </div>
      )}
    </div>
  );
};
