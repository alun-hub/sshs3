import React from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import type { AwsSignIn } from '@shared/types/aws';
import type { AwsCliProfile, AwsProfileStatus } from '@shared/types/awsScan';
import type { AwsSsoValue } from '../../../lib/useAwsSsoSignIn';
import { useAwsSsoSignIn } from '../../../lib/useAwsSsoSignIn';
import { AwsSsoSignInFields } from '../../AwsSsoSignInPanel';
import { SegmentedChoice, type SegmentedOption } from '../../ui/SegmentedChoice';

export type SourceKind = 'sso' | 'profile' | 'default';

const SOURCES: readonly SegmentedOption<SourceKind>[] = [
  { value: 'sso', label: 'AWS sign-in (SSO)' },
  { value: 'profile', label: 'AWS CLI profiles' },
  { value: 'default', label: 'Default credentials' },
];

const KIND_LABEL: Record<AwsCliProfile['kind'], string> = {
  sso: 'SSO', 'assume-role': 'assume-role', process: 'credential process', login: 'aws login', keys: 'access keys', other: 'other',
};
const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';
const secondary =
  'flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1 text-xs text-txt-primary hover:bg-app-surface-hover disabled:opacity-40 transition-colors';

interface Props {
  kind: SourceKind;
  onKind: (k: SourceKind) => void;
  single: boolean;
  signIns: readonly AwsSignIn[];
  savedId: string;
  onSaved: (id: string) => void;
  sso: AwsSsoValue;
  onSso: (patch: Partial<AwsSsoValue>) => void;
  signInState: ReturnType<typeof useAwsSsoSignIn>;
  profiles: readonly AwsCliProfile[] | null;
  chosenProfiles: ReadonlySet<string>;
  onToggleProfile: (name: string) => void;
  profileStatus: Readonly<Record<string, AwsProfileStatus | 'checking' | undefined>>;
  onCheckProfile: (name: string) => void;
  onLoginProfile: (name: string) => void;
}

/** Step 1 of "Add from AWS": where the credentials come from. */
export const AwsGuideSource: React.FC<Props> = (p) => {
  return (
    <section className="flex flex-col gap-3" aria-label="Credentials">
      <SegmentedChoice label="Credentials source" options={SOURCES} value={p.kind} onChange={p.onKind} autoFocus />

      {p.kind === 'sso' && (
        <div className="flex flex-col gap-3">
          {p.signIns.length > 0 && (
            <label className="flex flex-col gap-1 text-txt-secondary">
              Saved sign-in
              <select data-testid="guide-saved-signin" value={p.savedId} onChange={(e) => p.onSaved(e.target.value)} className={input}>
                <option value="">Other…</option>
                {p.signIns.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.region})</option>
                ))}
              </select>
            </label>
          )}
          <AwsSsoSignInFields value={p.sso} onChange={p.onSso} s={p.signInState} idPrefix="guide-sso" submitOnEnter />
        </div>
      )}

      {p.kind === 'profile' && (
        <div className="flex flex-col gap-2">
          {p.profiles === null && <p role="status" className="text-txt-muted">Looking for AWS CLI profiles…</p>}
          {p.profiles !== null && p.profiles.length === 0 && (
            <p className="text-txt-muted">No profiles found in ~/.aws/config or ~/.aws/credentials. Use the AWS CLI (<code>aws configure</code>, <code>aws configure sso</code> or <code>aws login</code>) to create one.</p>
          )}
          <ul aria-label="AWS CLI profiles" className="max-h-44 space-y-1 overflow-y-auto">
            {(p.profiles ?? []).map((prof) => {
              const st = p.profileStatus[prof.name];
              const on = p.chosenProfiles.has(prof.name);
              return (
                <li key={prof.name} className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle/60 bg-app-card px-2.5 py-1.5">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input type={p.single ? 'radio' : 'checkbox'} name="guide-profile" checked={on} onChange={() => p.onToggleProfile(prof.name)} className="h-3.5 w-3.5 text-sky-600" />
                    <span className="truncate font-medium text-txt-primary">{prof.name}</span>
                    <span className="shrink-0 text-txt-muted">{KIND_LABEL[prof.kind]}{prof.region ? ` · ${prof.region}` : ''}</span>
                  </label>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {st === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin text-txt-muted" role="img" aria-label="Checking" />}
                    {st && st !== 'checking' && st.ok && (
                      <span role="status" className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Ready</span>
                    )}
                    {st && st !== 'checking' && !st.ok && (
                      <span role="status" className="max-w-[16rem] break-words text-amber-300">{st.message}</span>
                    )}
                    {st && st !== 'checking' && !st.ok && prof.kind === 'sso' && (
                      <button type="button" className={secondary} aria-label={`Sign in to ${prof.name}`} onClick={() => p.onLoginProfile(prof.name)}>Sign in</button>
                    )}
                    <button type="button" className={secondary} aria-label={`Check ${prof.name}`} disabled={st === 'checking'} onClick={() => p.onCheckProfile(prof.name)}>Check</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {p.kind === 'default' && (
        <p className="text-txt-muted">Uses the credentials the AWS SDK finds on its own: environment variables, your default profile, or an instance role.</p>
      )}
    </section>
  );
};
