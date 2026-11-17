import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, Loader2, X } from 'lucide-react';
import type { AwsSsoAccount, AwsSsoAccountRole, AwsSsoConfig } from '@shared/types/aws';
import { offersAwsSsoSignIn } from '@shared/types/aws';
import type { SsmInstance } from '@shared/types/ssm';
import { normalizeStartUrl } from '@shared/ssm';
import { ssmFolder } from '@shared/ssmProfileFactory';
import { useDialogFocus } from '../lib/useDialogFocus';
import { useModalDismiss } from '../lib/useModalDismiss';
import { describeIpcError } from '../lib/format';
import { filterInstances, suggestLogin, toggleSelection } from '../lib/ssmInstancePicker';

export interface AwsPickResult {
  instances: SsmInstance[];
  sso: AwsSsoConfig;
  region: string;
  username: string;
  folder: string;
}

interface Props {
  /** `single` picks one instance (fills the profile form); `multi` imports several as new profiles. */
  mode: 'single' | 'multi';
  initialSso?: { startUrl: string; region: string };
  onClose: () => void;
  onPick: (result: AwsPickResult) => void | Promise<void>;
}

const field =
  'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted';

/**
 * Sign in with IAM Identity Center, choose account/role and region, then pick instances that SSM manages.
 * Instances are listed from `ssm:DescribeInstanceInformation`, so only nodes with a running SSM Agent appear.
 * The access token stays in this component's memory; only account/role/region reach the profile.
 */
export const AwsInstancePickerModal: React.FC<Props> = ({ mode, initialSso, onClose, onPick }) => {
  const single = mode === 'single';
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  const onBackdrop = useModalDismiss(onClose, true);

  const [startUrl, setStartUrl] = useState(initialSso?.startUrl ?? '');
  const [ssoRegion, setSsoRegion] = useState(initialSso?.region ?? 'us-east-1');
  const [token, setToken] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AwsSsoAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [roles, setRoles] = useState<AwsSsoAccountRole[]>([]);
  const [roleName, setRoleName] = useState('');
  const [region, setRegion] = useState(initialSso?.region ?? 'us-east-1');
  const [instances, setInstances] = useState<SsmInstance[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [username, setUsername] = useState('ec2-user');
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sso: AwsSsoConfig = { startUrl: normalizeStartUrl(startUrl), region: ssoRegion.trim(), accountId, roleName };

  // The access token belongs to one start URL + region: editing either invalidates everything derived from it.
  const resetSignIn = () => {
    setToken(null);
    setAccounts([]);
    setAccountId('');
    setRoles([]);
    setRoleName('');
    setInstances(null);
    setSelected(new Set());
  };
  const visible = useMemo(() => filterInstances(instances ?? [], query), [instances, query]);
  const chosen = useMemo(() => (instances ?? []).filter((i) => selected.has(i.instanceId)), [instances, selected]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(describeIpcError(err, 'AWS request failed').replace(/^Error:\s*/, ''));
    } finally {
      setBusy(null);
    }
  };

  const signIn = () =>
    run('Waiting for browser sign-in…', async () => {
      const { accessToken } = await window.multissh.awsSsoLogin(sso.startUrl, sso.region);
      setToken(accessToken);
      setAccounts(await window.multissh.awsSsoListAccounts(accessToken, sso.region));
    });

  const pickAccount = (id: string) => {
    setAccountId(id);
    setRoleName('');
    setRoles([]);
    setInstances(null);
    if (!id || !token) return;
    void run('Loading roles…', async () => {
      const list = await window.multissh.awsSsoListRoles(token, sso.region, id);
      setRoles(list);
      if (list.length === 1) setRoleName(list[0].roleName);
    });
  };

  const find = () =>
    run('Finding instances…', async () => {
      const r = await window.multissh.awsSsmDiscoverInstances({ sso: { ...sso }, region: region.trim() });
      setInstances(r.instances);
      setTruncated(r.truncated);
      setSelected(new Set());
    });

  useEffect(() => {
    if (chosen.length > 0) setUsername(suggestLogin(chosen));
    // Only follows the platform of the selection; later edits by the user are kept until the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen[0]?.instanceId]);

  const submit = async () => {
    if (chosen.length === 0 || !username.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onPick({ instances: chosen, sso, region: region.trim(), username: username.trim(), folder: folder.trim() || ssmFolder(sso, region.trim()) });
    } catch (err) {
      setError(describeIpcError(err, 'Could not import the selected instances'));
      setSaving(false);
    }
  };

  const ready = !!accountId && !!roleName;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onClick={onBackdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={single ? 'Pick an AWS instance' : 'Import instances from AWS'}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-xl border border-border-subtle bg-app-surface p-4 text-xs shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-divider pb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            <span>{single ? 'Pick an AWS instance' : 'Import instances from AWS'}</span>
          </div>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className="rounded p-1 text-txt-muted hover:text-txt-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="grid grid-cols-[1fr_140px_auto] items-end gap-2" aria-label="Sign in">
          <label className="flex flex-col gap-1 text-txt-secondary">
            SSO start URL
            <input value={startUrl} onChange={(e) => { setStartUrl(e.target.value); resetSignIn(); }} className={field} placeholder="https://d-xxxxxxxxxx.awsapps.com/start" autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-txt-secondary">
            SSO region
            <input value={ssoRegion} onChange={(e) => { setSsoRegion(e.target.value); resetSignIn(); }} className={field} />
          </label>
          <button type="button" onClick={() => void signIn()} disabled={!!busy || !startUrl.trim()} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {token ? 'Sign in again' : 'Sign in'}
          </button>
        </section>

        {token && (
          <section className="grid grid-cols-3 items-end gap-2" aria-label="Account, role and region">
            <label className="flex flex-col gap-1 text-txt-secondary">
              Account
              <select value={accountId} onChange={(e) => pickAccount(e.target.value)} className={field}>
                <option value="">Select account…</option>
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.accountName ? `${a.accountName} (${a.accountId})` : a.accountId}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-txt-secondary">
              Role
              <select value={roleName} onChange={(e) => { setRoleName(e.target.value); setInstances(null); }} disabled={roles.length === 0} className={field}>
                <option value="">Select role…</option>
                {roles.map((r) => (
                  <option key={r.roleName} value={r.roleName}>{r.roleName}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-txt-secondary">
              Region
              <input value={region} onChange={(e) => { setRegion(e.target.value); setInstances(null); }} className={field} placeholder="eu-north-1" />
            </label>
          </section>
        )}

        {ready && (
          <div>
            <button type="button" onClick={() => void find()} disabled={!!busy || !region.trim()} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-txt-primary hover:bg-app-hover disabled:opacity-50">
              Find instances
            </button>
          </div>
        )}

        {busy && (
          <p role="status" className="flex items-center gap-1.5 text-txt-muted">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> {busy}
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-400">
            {error}
            {offersAwsSsoSignIn(error) ? ' Press Sign in again above.' : ''}
          </p>
        )}

        {instances && (
          <section className="flex flex-col gap-2" aria-label="Instances">
            {instances.length === 0 ? (
              <p className="text-txt-muted">
                No online SSM-managed instances in this account and region. An instance appears here once it has the SSM Agent and an instance profile
                with SSM permissions.
              </p>
            ) : (
              <>
                <input aria-label="Filter instances" value={query} onChange={(e) => setQuery(e.target.value)} className={field} placeholder="Filter by name, ID, platform or IP" />
                {truncated && <p className="text-amber-300">Only the first instances are shown. Pick another account or region, or narrow the list with the filter.</p>}
                <div role="listbox" aria-label="SSM-managed instances" aria-multiselectable={!single} className="max-h-60 overflow-y-auto rounded-lg border border-border-subtle bg-app-card p-1">
                  {visible.map((i) => {
                    const on = selected.has(i.instanceId);
                    return (
                      <div
                        key={i.instanceId}
                        role="option"
                        aria-selected={on}
                        tabIndex={0}
                        onClick={() => setSelected((s) => toggleSelection(s, i.instanceId, single))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected((s) => toggleSelection(s, i.instanceId, single));
                          }
                        }}
                        className={`grid cursor-pointer grid-cols-[1.2fr_1.2fr_1fr_1fr] gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${on ? 'bg-sky-500/20' : 'hover:bg-app-surface-hover'}`}
                      >
                        <span className="truncate font-medium text-txt-primary">{on ? '✓ ' : ''}{i.name}</span>
                        <span className="truncate font-mono text-txt-muted">{i.instanceId}</span>
                        <span className="truncate text-txt-secondary">{i.platformName ?? i.platformType ?? ''}</span>
                        <span className="truncate text-txt-muted">{i.ipAddress ?? ''}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-txt-secondary">
                    SSH login name
                    <input value={username} onChange={(e) => setUsername(e.target.value)} className={field} />
                  </label>
                  {!single && (
                    <label className="flex flex-col gap-1 text-txt-secondary">
                      Folder
                      <input value={folder} onChange={(e) => setFolder(e.target.value)} className={field} placeholder={ssmFolder(sso, region.trim() || 'region')} />
                    </label>
                  )}
                </div>
                <p className="text-txt-muted">The login name is a suggestion for the platform; the instance may use another. SSH authentication is still required.</p>
              </>
            )}
          </section>
        )}

        <div className="flex justify-end gap-2 border-t border-divider pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-txt-secondary hover:bg-app-hover">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={saving || chosen.length === 0 || !username.trim()} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
            {single ? 'Use selected' : `Import selected${chosen.length ? ` (${chosen.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
