import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import type { SshSsmConfig } from '@shared/types/ssm';
import { ssmProblem } from '../../lib/ssmProfile';
import { AwsInstancePickerModal } from '../AwsInstancePickerModal';
import { AwsSsoSignInPanel } from '../AwsSsoSignInPanel';
import { useAwsSsmTools } from '../../lib/useAwsSsmTools';
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

const INSTALL_STEPS: Array<{ os: string; steps: string[] }> = [
  {
    os: 'Windows',
    steps: [
      'Install the AWS CLI v2 (MSI) from https://aws.amazon.com/cli/ and the Session Manager plugin installer from the AWS documentation ("Install the Session Manager plugin on Windows").',
      'Run the installers as administrator, then reopen sshs3 if the tools are still not found.',
    ],
  },
  {
    os: 'Linux',
    steps: [
      'Install the AWS CLI v2 with the official installer (awscli.amazonaws.com), or your distribution package.',
      'Install the Session Manager plugin .deb or .rpm from the AWS documentation ("Install the Session Manager plugin on Linux").',
    ],
  },
];

export const SshSsmFields: React.FC<Props> = ({ ssm, host, onChange }) => {
  const blocked = isFeatureBlocked(usePolicy(), 'awsSsm');
  const enabled = Boolean(ssm?.enabled);
  const { tools, readiness, refresh } = useAwsSsmTools(enabled);
  const [picking, setPicking] = useState(false);

  const source: CredentialSource = ssm ? sourceOf(ssm) : 'default';
  const patch = (p: Partial<SshSsmConfig>) => onChange({ enabled: true, ...ssm, ...p });

  const setSource = (next: CredentialSource) => {
    const base: SshSsmConfig = { enabled: true, region: ssm?.region };
    if (next === 'profile') onChange({ ...base, awsProfile: '' });
    else if (next === 'sso') onChange({ ...base, sso: { startUrl: '', region: ssm?.region ?? 'us-east-1' } });
    else onChange(base);
  };

  return (
    <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5">
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
                onChange({ enabled: true, region: r.region, sso: r.sso }, { host: r.instances[0].instanceId, username: r.username });
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

          <div className="rounded-lg border border-border-subtle p-2" aria-label="Required tools">
            <div role="status" aria-live="polite" className="flex flex-col gap-1 text-xs">
              {readiness === 'checking' && (
                <span className="flex items-center gap-1.5 text-txt-muted">
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" /> Checking for the AWS CLI and Session Manager plugin…
                </span>
              )}
              {tools && (
                <>
                  <ToolLine name="AWS CLI v2" status={tools.aws} />
                  <ToolLine name="Session Manager plugin" status={tools.plugin} outdated={tools.plugin.ok === false} />
                  {readiness === 'ready' && <span className="font-medium text-emerald-400">Ready</span>}
                </>
              )}
            </div>
            {(readiness === 'missing' || readiness === 'outdated') && (
              <details className="mt-1.5 text-xs text-txt-secondary">
                <summary className="cursor-pointer">How to install</summary>
                {INSTALL_STEPS.map((s) => (
                  <div key={s.os} className="mt-1">
                    <div className="font-medium">{s.os}</div>
                    <ul className="list-disc pl-4">
                      {s.steps.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                <button type="button" onClick={refresh} className="mt-1.5 rounded border border-border-subtle px-2 py-0.5 hover:bg-app-hover">
                  Check again
                </button>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ToolLine: React.FC<{ name: string; status: { found: boolean; version?: string; path?: string }; outdated?: boolean }> = ({
  name,
  status,
  outdated,
}) => (
  <span className="flex items-center gap-1.5 text-txt-secondary">
    {status.found && !outdated ? (
      <CheckCircle2 size={12} className="text-emerald-400" aria-hidden="true" />
    ) : (
      <AlertTriangle size={12} className="text-amber-400" aria-hidden="true" />
    )}
    <span>
      {name}: {outdated ? 'Too old (1.1.23.0 or newer required)' : status.found ? 'Found' : 'Missing'}
      {status.version ? ` ${status.version}` : ''}
      {status.path ? ` — ${status.path}` : ''}
    </span>
  </span>
);
