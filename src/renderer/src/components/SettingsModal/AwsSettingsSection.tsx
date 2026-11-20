import React, { useEffect, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { allSignIns, awsNetworkToOptions, parseRegionList } from '@shared/awsSignIns';
import { isValidSsoConfig, normalizeStartUrl } from '@shared/ssm';
import type { AwsSignIn } from '@shared/types/aws';
import type { AwsCliProfile } from '@shared/types/awsScan';
import { AwsSsoSignInPanel } from '../AwsSsoSignInPanel';
import { AwsToolsPanel } from '../aws/AwsToolsPanel';
import { describeSsoStatus } from '../../lib/awsSsoStatus';
import { useAwsSignInStatuses } from '../../lib/useAwsSignInStatuses';
import { useAwsRowSignIn } from '../../lib/useAwsRowSignIn';
import { isFeatureBlocked, usePolicy } from '../../lib/usePolicy';
import { FeatureBlockedNotice, ManagedGroup } from './Managed';
import type { SettingsForm } from './useSettingsForm';

const input =
  'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted';
const secondaryButton =
  'flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs text-txt-primary hover:bg-app-surface-hover disabled:opacity-40 transition-colors';

interface Draft {
  id?: string;
  name: string;
  startUrl: string;
  region: string;
}

const KIND_LABEL: Record<AwsCliProfile['kind'], string> = {
  sso: 'SSO',
  'assume-role': 'assume-role',
  process: 'credential process',
  login: 'aws login',
  keys: 'access keys',
  other: 'other',
};

/** "AWS" page of the settings dialog: the master switch, saved sign-ins, default regions, network and tools. */
export const AwsSettingsSection: React.FC<{ form: SettingsForm }> = ({ form }) => {
  const { enableAws, setEnableAws, awsSignIns, setAwsSignIns, awsRegions, setAwsRegions, awsNetwork, setAwsNetwork, awsManagedSignIns, isManaged } = form;
  const blocked = isFeatureBlocked(usePolicy(), 'awsSsm');
  const rows = allSignIns(awsSignIns, awsManagedSignIns);
  const { statuses, refresh } = useAwsSignInStatuses(rows, enableAws);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [profiles, setProfiles] = useState<AwsCliProfile[] | null>(null);

  useEffect(() => {
    if (!enableAws) return;
    let cancelled = false;
    window.multissh
      ?.awsSsmListProfiles?.()
      .then((p) => !cancelled && setProfiles(p))
      .catch(() => !cancelled && setProfiles([]));
    return () => {
      cancelled = true;
    };
  }, [enableAws]);

  const network = awsNetworkToOptions(awsNetwork);
  const { busyId, error, signIn } = useAwsRowSignIn(refresh);
  const regionList = parseRegionList(awsRegions);
  const ignoredRegions = awsRegions.split(/[\s,;]+/).filter((r) => r && !regionList.includes(r));
  const draftValid = !!draft && draft.name.trim() !== '' && isValidSsoConfig({ startUrl: normalizeStartUrl(draft.startUrl), region: draft.region.trim() });

  const saveDraft = () => {
    if (!draft || !draftValid) return;
    const entry: AwsSignIn = { id: draft.id ?? `signin-${Date.now().toString(36)}`, name: draft.name.trim(), startUrl: normalizeStartUrl(draft.startUrl), region: draft.region.trim() };
    setAwsSignIns(draft.id ? awsSignIns.map((s) => (s.id === draft.id ? { ...s, ...entry } : s)) : [...awsSignIns, entry]);
    setDraft(null);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 rounded-xl border border-border-subtle bg-app-surface p-4">
        <ManagedGroup managed={isManaged('enableAws')} indentNotice>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={enableAws}
              disabled={blocked}
              onChange={(e) => setEnableAws(e.target.checked)}
              className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
            />
            <span className="text-xs font-semibold text-txt-primary">Enable AWS features</span>
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">Experimental</span>
          </label>
        </ManagedGroup>
        <FeatureBlockedNotice blocked={blocked} id="aws-blocked" />
        <p className="pl-6 text-xs leading-relaxed text-txt-muted">
          Connect to EC2 instances through AWS Systems Manager (no open SSH port), import them as profiles, and sign in to AWS IAM Identity Center from the top bar.
        </p>
      </div>

      {enableAws && (
        <>
          <div className="space-y-3 rounded-xl border border-border-subtle bg-app-surface p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-txt-primary">AWS sign-ins</h3>
              <button type="button" className={secondaryButton} onClick={() => setDraft({ name: '', startUrl: '', region: 'us-east-1' })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add sign-in
              </button>
            </div>
            {rows.length === 0 && !draft && (
              <p className="text-xs text-txt-muted">No sign-ins yet. Add your IAM Identity Center start URL to sign in once and reuse it everywhere. You can also use AWS CLI profiles without a sign-in here.</p>
            )}
            <ul className="space-y-1.5" aria-label="AWS sign-ins">
              {rows.map((row) => {
                const info = describeSsoStatus(statuses[row.id] ?? null, false);
                const signedIn = statuses[row.id]?.status === 'valid';
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-app-card px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium text-txt-primary">
                        {row.managed && <Lock className="h-3 w-3 text-amber-300" aria-label="Managed by your organization" />}
                        <span className="truncate">{row.name}</span>
                      </div>
                      <div className="truncate font-mono text-txt-muted">{row.startUrl} · {row.region}</div>
                      <div role="status" className={`flex items-center gap-1 ${info.tone === 'ok' ? 'text-emerald-400' : info.tone === 'warn' ? 'text-amber-300' : 'text-txt-muted'}`}>
                        {info.tone === 'ok' && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                        {info.text}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button type="button" className={secondaryButton} disabled={busyId === row.id} onClick={() => void signIn(row)}>
                        {busyId === row.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                        {busyId === row.id ? 'Signing in…' : signedIn ? 'Sign in again' : 'Sign in'}
                      </button>
                      {!row.managed && (
                        <>
                          <button type="button" aria-label={`Edit ${row.name}`} title="Edit" className={secondaryButton} onClick={() => setDraft({ id: row.id, name: row.name, startUrl: row.startUrl, region: row.region })}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button type="button" aria-label={`Remove ${row.name}`} title="Remove" className={secondaryButton} onClick={() => setAwsSignIns(awsSignIns.filter((s) => s.id !== row.id))}>
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {error && <p role="alert" className="rounded-lg border border-red-800/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>}

            {draft && (
              <div className="space-y-3 rounded-lg border border-border-subtle bg-app-surface-subtle p-3" role="group" aria-label={draft.id ? 'Edit sign-in' : 'New sign-in'}>
                <label className="flex flex-col gap-1 text-xs text-txt-secondary">
                  Name
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Company" className={input} autoFocus />
                </label>
                <AwsSsoSignInPanel
                  idPrefix="settings-sso"
                  pickAccountRole={false}
                  value={{ startUrl: draft.startUrl, region: draft.region }}
                  onChange={(p) => setDraft((d) => (d ? { ...d, ...(p.startUrl !== undefined ? { startUrl: p.startUrl } : {}), ...(p.region !== undefined ? { region: p.region } : {}) } : d))}
                  network={network}
                />
                <div className="flex justify-end gap-2">
                  <button type="button" className={secondaryButton} onClick={() => setDraft(null)}>Cancel</button>
                  <button type="button" disabled={!draftValid} onClick={saveDraft} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40">
                    {draft.id ? 'Save sign-in' : 'Add sign-in'}
                  </button>
                </div>
              </div>
            )}
            <p className="text-xs text-txt-muted">Sign-ins are saved when you press Save in this dialog. Signing in takes effect immediately.</p>
          </div>

          <div className="space-y-2 rounded-xl border border-border-subtle bg-app-surface p-4">
            <h3 className="text-xs font-semibold text-txt-primary">Regions to search</h3>
            <ManagedGroup managed={isManaged('awsRegions')}>
              <input aria-label="Regions to search" value={awsRegions} onChange={(e) => setAwsRegions(e.target.value)} placeholder="eu-north-1, eu-west-1" className={`${input} w-full font-mono`} />
            </ManagedGroup>
            <p className="text-xs text-txt-muted">
              Used by Add from AWS. Comma separated; leave empty to choose each time. Searching many regions in many accounts takes longer, and organizations often restrict regions.
              {regionList.length > 0 && ` Searching ${regionList.length} region${regionList.length === 1 ? '' : 's'}.`}
            </p>
            {ignoredRegions.length > 0 && <p role="note" className="text-xs text-amber-300">Not a region, ignored: {ignoredRegions.join(', ')}</p>}
          </div>

          <div className="space-y-3 rounded-xl border border-border-subtle bg-app-surface p-4">
            <h3 className="text-xs font-semibold text-txt-primary">Network</h3>
            <label className="flex flex-col gap-1 text-xs text-txt-secondary">
              HTTPS proxy
              <input
                value={awsNetwork.httpsProxy ?? ''}
                onChange={(e) => setAwsNetwork({ ...awsNetwork, httpsProxy: e.target.value.trim() || undefined })}
                placeholder="http://proxy.example.com:3128"
                className={`${input} font-mono`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-txt-secondary">
              Custom CA certificate (PEM)
              <div className="flex gap-2">
                <input
                  value={awsNetwork.customCaPath ?? ''}
                  onChange={(e) => setAwsNetwork({ ...awsNetwork, customCaPath: e.target.value.trim() || undefined })}
                  placeholder="/etc/ssl/corp-ca.pem"
                  className={`${input} flex-1 font-mono`}
                />
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => void window.multissh.dialogOpenFile({ title: 'Choose CA Certificate' }).then((p) => p && setAwsNetwork({ ...awsNetwork, customCaPath: p }))}
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" /> Browse
                </button>
              </div>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-txt-primary">
              <input
                type="checkbox"
                checked={awsNetwork.rejectUnauthorized !== false}
                onChange={(e) => setAwsNetwork({ ...awsNetwork, rejectUnauthorized: e.target.checked ? undefined : false })}
                className="h-4 w-4 rounded border-border-subtle text-sky-600 focus:ring-sky-500"
              />
              Verify TLS certificates
            </label>
            <p className="text-xs text-txt-muted">
              Used for sign-in, listing and instance search, and passed to the aws CLI as HTTPS_PROXY and AWS_CA_BUNDLE. A proxy that needs a login is not supported for the CLI; use the system proxy settings in that case.
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-border-subtle bg-app-surface p-4">
            <h3 className="text-xs font-semibold text-txt-primary">Tools and AWS CLI profiles</h3>
            <AwsToolsPanel />
            <p className="text-xs text-txt-muted" role="status">
              {profiles === null
                ? 'Looking for AWS CLI profiles…'
                : profiles.length === 0
                  ? 'No AWS CLI profiles found in ~/.aws/config or ~/.aws/credentials.'
                  : `Detected ${profiles.length} AWS CLI profile${profiles.length === 1 ? '' : 's'}: ${Object.entries(
                      profiles.reduce<Record<string, number>>((acc, p) => ({ ...acc, [KIND_LABEL[p.kind]]: (acc[KIND_LABEL[p.kind]] ?? 0) + 1 }), {})
                    )
                      .map(([k, n]) => `${n} ${k}`)
                      .join(', ')}.`}
            </p>
          </div>
        </>
      )}
    </div>
  );
};
