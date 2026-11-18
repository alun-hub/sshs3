import React, { useEffect, useState } from 'react';
import { Cloud } from 'lucide-react';
import { allSignIns } from '@shared/awsSignIns';
import { AWS_DEFAULT_REGIONS } from '@shared/awsScan';
import type { AwsSignIn } from '@shared/types/aws';
import type { AwsCliProfile } from '@shared/types/awsScan';
import type { SshSsmConfig } from '@shared/types/ssm';
import { ssmConfigForSource } from '@shared/ssmProfileFactory';
import { ssmProblem } from '../../lib/ssmProfile';
import { AwsInstancePickerModal } from '../AwsInstancePickerModal';
import { AwsSsoSignInPanel } from '../AwsSsoSignInPanel';
import { AwsToolsPanel } from '../aws/AwsToolsPanel';
import { useAwsEnabled } from '../../lib/awsEnabled';
import { isFeatureBlocked, usePolicy } from '../../lib/usePolicy';
import { FeatureBlockedNotice } from '../SettingsModal/Managed';

type CredentialSource = 'default' | 'profile' | 'sso';

interface Props {
  ssm: SshSsmConfig | undefined;
  host: string;
  onChange: (ssm: SshSsmConfig | undefined, extra?: { host?: string; username?: string }) => void;
}

const inputCls =
  'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted';

function sourceOf(ssm: SshSsmConfig): CredentialSource {
  return ssm.sso ? 'sso' : ssm.awsProfile !== undefined ? 'profile' : 'default';
}

export const SshSsmFields: React.FC<Props> = ({ ssm, host, onChange }) => {
  const awsEnabled = useAwsEnabled();
  const blocked = isFeatureBlocked(usePolicy(), 'awsSsm');
  const enabled = Boolean(ssm?.enabled);
  const [picking, setPicking] = useState(false);
  const [signIns, setSignIns] = useState<AwsSignIn[]>([]);
  const [cliProfiles, setCliProfiles] = useState<AwsCliProfile[]>([]);

  // Saved sign-ins (settings and policy) and the AWS CLI profiles, for the pickers below.
  useEffect(() => {
    if (!awsEnabled) return;
    let alive = true;
    window.multissh?.settingsGet?.().then((s) => alive && setSignIns(allSignIns(s.awsSignIns, s.awsManagedSignIns))).catch(() => {});
    window.multissh?.awsSsmListProfiles?.().then((p) => alive && setCliProfiles(p)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [awsEnabled]);

  const source: CredentialSource = ssm ? sourceOf(ssm) : 'default';
  const patch = (p: Partial<SshSsmConfig>) => onChange({ enabled: true, ...ssm, ...p });

  const setSource = (next: CredentialSource) => {
    const base: SshSsmConfig = { enabled: true, ...(ssm?.mode ? { mode: ssm.mode } : {}), region: ssm?.region };
    if (next === 'profile') onChange({ ...base, awsProfile: '' });
    else if (next === 'sso') onChange({ ...base, sso: { startUrl: signIns[0]?.startUrl ?? '', region: signIns[0]?.region ?? 'us-east-1' } });
    else onChange(base);
  };

  // AWS features are off: new profiles do not see this section at all. A profile that already uses SSM keeps it
  // (and keeps connecting), with a hint where to turn the feature on.
  if (!awsEnabled && !enabled) return null;

  return (
    <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5">
      {!awsEnabled && (
        <p role="note" className="mb-2 text-xs text-amber-300">
          AWS features are off. Turn them on in Settings → AWS to pick instances and manage sign-ins; this profile keeps working.
        </p>
      )}
      <label className="flex items-center gap-2 text-txt-secondary font-medium cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          disabled={blocked}
          onChange={(e) => onChange(e.target.checked ? (signIns[0] ? { enabled: true, sso: { startUrl: signIns[0].startUrl, region: signIns[0].region } } : { enabled: true }) : undefined)}
          className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
        />
        <span>Connect via AWS Systems Manager (SSM)</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">Experimental</span>
      </label>

      <FeatureBlockedNotice blocked={blocked} id="aws-ssm-blocked" />
      {enabled && ssm && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-divider pt-2">
          <p className="text-xs text-txt-muted">
            Enter the instance ID as hostname (i-0123456789abcdef0). With SSH over SSM the instance still needs an SSH daemon
            and SSH authentication; SSM only carries the connection. A jump host or outgoing proxy cannot be combined with SSM.
          </p>
          {host.trim() !== '' && ssmProblem({ host, ssm }) && (
            <p role="alert" className="text-xs text-red-400">
              {ssmProblem({ host, ssm })}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-primary hover:bg-app-surface-hover transition-colors"
            >
              <Cloud className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" /> Pick from AWS…
            </button>
            <span className="text-xs text-txt-muted">Search your accounts and fill in the instance, region and credentials.</span>
          </div>
          {picking && (
            <AwsInstancePickerModal
              mode="single"
              initialSso={ssm.sso ? { startUrl: ssm.sso.startUrl, region: ssm.sso.region } : undefined}
              onClose={() => setPicking(false)}
              onPick={(r) => {
                const item = r.items[0];
                if (item) onChange(ssmConfigForSource(item.source, item.instance.region, ssm.mode), { host: item.instance.instanceId, username: item.username });
                setPicking(false);
              }}
            />
          )}

          <label className="flex flex-col gap-1 text-txt-secondary">
            Connection type
            <select
              data-testid="ssm-mode"
              value={ssm.mode ?? 'ssh'}
              onChange={(e) => patch({ mode: e.target.value === 'shell' ? 'shell' : undefined })}
              className={inputCls}
            >
              <option value="ssh">SSH over SSM (files, tunnels and editing work)</option>
              <option value="shell">Session Manager shell (no SSH, no keys)</option>
            </select>
          </label>
          {ssm.mode === 'shell' && (
            <p role="note" className="text-xs text-txt-muted">
              Opens a shell through Session Manager like the AWS console: IAM decides who may connect, and the instance needs no SSH daemon or key. Terminal only: the file manager, tunnels and key install need SSH. The SSH user and authentication below are not used.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-txt-secondary">
              AWS credentials
              <select value={source} onChange={(e) => setSource(e.target.value as CredentialSource)} className={inputCls}>
                <option value="sso">AWS sign-in (SSO)</option>
                <option value="profile">AWS CLI profile</option>
                <option value="default">Default credentials</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-txt-secondary">
              {source === 'sso' ? 'Region of the instance' : 'Region (optional)'}
              <input
                list="ssm-regions"
                value={ssm.region ?? ''}
                onChange={(e) => patch({ region: e.target.value.trim() || undefined })}
                className={inputCls}
                placeholder="eu-north-1"
              />
              <datalist id="ssm-regions">
                {AWS_DEFAULT_REGIONS.map((r) => <option key={r} value={r} />)}
              </datalist>
              {source === 'sso' && ssm.sso && ssm.region && ssm.region === ssm.sso.region && (
                <span role="note" className="text-amber-300">
                  Same as the SSO region. This is the region the instance runs in, which is often a different one.
                </span>
              )}
            </label>
          </div>

          {source === 'profile' && (
            <label className="flex flex-col gap-1 text-txt-secondary">
              AWS CLI profile
              <input
                list="ssm-cli-profiles"
                value={ssm.awsProfile ?? ''}
                onChange={(e) => patch({ awsProfile: e.target.value.trim() })}
                className={inputCls}
                placeholder="default"
              />
              <datalist id="ssm-cli-profiles">
                {cliProfiles.map((p) => <option key={p.name} value={p.name} />)}
              </datalist>
            </label>
          )}

          {source === 'sso' && ssm.sso && (
            <div className="flex flex-col gap-2">
              {signIns.length > 0 && (
                <label className="flex flex-col gap-1 text-txt-secondary">
                  AWS sign-in
                  <select
                    data-testid="ssm-saved-signin"
                    value={signIns.find((s) => s.startUrl === ssm.sso!.startUrl && s.region === ssm.sso!.region)?.id ?? ''}
                    onChange={(e) => {
                      const s = signIns.find((x) => x.id === e.target.value);
                      patch({ sso: s ? { startUrl: s.startUrl, region: s.region, accountId: s.lastAccountId, roleName: s.lastRoleName } : { startUrl: '', region: ssm.sso!.region } });
                    }}
                    className={inputCls}
                  >
                    <option value="">Other…</option>
                    {signIns.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.region})</option>
                    ))}
                  </select>
                </label>
              )}
              {ssm.sso.accountId && ssm.sso.roleName && (
                <p className="text-xs text-txt-muted">Account <span className="font-mono">{ssm.sso.accountId}</span> · role <span className="font-mono">{ssm.sso.roleName}</span></p>
              )}
              <details open={signIns.length === 0 || !ssm.sso.accountId || !ssm.sso.roleName || undefined} className="rounded-lg border border-border-subtle bg-app-surface/40 p-2">
                <summary className="cursor-pointer text-xs text-txt-secondary">Sign-in, account and role</summary>
                <div className="mt-2">
                  <AwsSsoSignInPanel idPrefix="ssm-sso" value={ssm.sso} onChange={(p) => patch({ sso: { ...ssm.sso!, ...p } })} />
                </div>
              </details>
            </div>
          )}

          <AwsToolsPanel compact />
        </div>
      )}
    </div>
  );
};
