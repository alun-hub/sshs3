import React from 'react';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useAwsSsmTools } from '../../lib/useAwsSsmTools';

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

/**
 * Whether the `aws` CLI and the Session Manager plugin are installed (found, version, install steps), updating by
 * itself when they appear. Shared by the AWS settings page and the SSM profile form.
 */
export const AwsToolsPanel: React.FC<{ enabled?: boolean }> = ({ enabled = true }) => {
  const { tools, readiness, refresh } = useAwsSsmTools(enabled);
  return (
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
