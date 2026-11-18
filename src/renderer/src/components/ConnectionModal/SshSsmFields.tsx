import React, { useState } from 'react';
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

  const source: CredentialSource = ssm ? sourceOf(ssm) : 'default';
  const patch = (p: Partial<SshSsmConfig>) => onChange({ enabled: true, ...ssm, ...p });

  const setSource = (next: CredentialSource) => {
    const base: SshSsmConfig = { enabled: true, region: ssm?.region };
    if (next === 'profile') onChange({ ...base, awsProfile: '' });
    else if (next === 'sso') onChange({ ...base, sso: { startUrl: '', region: ssm?.region ?? 'us-east-1' } });
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
          onChange={(e) => onChange(e.target.checked ? { enabled: true } : undefined)}
          className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
        />
        <span>Connect via AWS Systems Manager (SSM)</span>
        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">Experimental</span>
      </label>

      <FeatureBlockedNotice blocked={blocked} id="aws-ssm-blocked" />
      {enabled && ssm && (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-divider pt-2">
          <p className="text-xs text-txt-muted">
            Enter the instance ID as hostname (i-0123456789abcdef0). The instance still needs an SSH daemon and SSH
            authentication; SSM only carries the connection. A jump host or outgoing proxy cannot be combined with SSM.
          </p>
          {host.trim() !== '' && ssmProblem({ host, ssm }) && (
            <p role="alert" className="text-xs text-red-400">
              {ssmProblem({ host, ssm })}
            </p>
          )}

          <div>
            <button type="button" onClick={() => setPicking(true)} className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-txt-primary hover:bg-app-hover">
              Pick from AWS…
            </button>
          </div>
          {picking && (
            <AwsInstancePickerModal
              mode="single"
              initialSso={ssm.sso ? { startUrl: ssm.sso.startUrl, region: ssm.sso.region } : undefined}
              onClose={() => setPicking(false)}
              onPick={(r) => {
                const item = r.items[0];
                if (item) onChange(ssmConfigForSource(item.source, item.instance.region), { host: item.instance.instanceId, username: item.username });
                setPicking(false);
              }}
            />
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-txt-secondary">
              AWS credentials
              <select value={source} onChange={(e) => setSource(e.target.value as CredentialSource)} className={inputCls}>
                <option value="default">Default AWS CLI credentials</option>
                <option value="profile">AWS CLI profile</option>
                <option value="sso">Signed in with sshs3 (SSO)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-txt-secondary">
              {source === 'sso' ? 'Region of the instance' : 'Region (optional)'}
              <input
                value={ssm.region ?? ''}
                onChange={(e) => patch({ region: e.target.value.trim() || undefined })}
                className={inputCls}
                placeholder="eu-north-1"
              />
              {source === 'sso' && ssm.sso && ssm.region && ssm.region === ssm.sso.region && (
                <span role="note" className="text-amber-300">
                  Same as the SSO region. This is the region the instance runs in, which is often a different one.
                </span>
              )}
            </label>
          </div>

          {source === 'profile' && (
            <label className="flex flex-col gap-1 text-txt-secondary">
              AWS CLI profile name
              <input
                value={ssm.awsProfile ?? ''}
                onChange={(e) => patch({ awsProfile: e.target.value.trim() })}
                className={inputCls}
                placeholder="default"
              />
            </label>
          )}

          {source === 'sso' && ssm.sso && (
            <AwsSsoSignInPanel
              idPrefix="ssm-sso"
              value={ssm.sso}
              onChange={(p) => patch({ sso: { ...ssm.sso!, ...p } })}
            />
          )}

          <AwsToolsPanel />
        </div>
      )}
    </div>
  );
};
