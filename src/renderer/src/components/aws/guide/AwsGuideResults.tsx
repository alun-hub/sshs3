import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { groupInstances, summarizeScan } from '@shared/awsScan';
import { suggestLoginName } from '@shared/ssm';
import type { AwsScanTarget, ScannedInstance } from '@shared/types/awsScan';
import { instanceKey } from '../../../lib/awsGuide';
import { filterInstances } from '../../../lib/ssmInstancePicker';
import type { AwsScanState } from '../../../lib/useAwsScan';

const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';

interface Props {
  state: AwsScanState;
  targets: ReadonlyMap<string, AwsScanTarget>;
  single: boolean;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  usernames: Readonly<Record<string, string>>;
  onUsername: (instanceId: string, value: string) => void;
  /** Instance ids that already have an SSM profile. */
  added: ReadonlySet<string>;
  onCancel: () => void;
}

/** Steps 4 and 5 of "Add from AWS": progress while searching, then the nodes found, grouped by account and region. */
export const AwsGuideResults: React.FC<Props> = ({ state, targets, single, selected, onToggle, usernames, onUsername, added, onCancel }) => {
  const [query, setQuery] = useState('');
  const result = state.result;
  const groups = useMemo(() => {
    if (!result) return [];
    const shown = filterInstances(result.instances, query) as ScannedInstance[];
    return groupInstances(shown);
  }, [result, query]);

  if (state.phase === 'idle') return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Instances" aria-live="polite">
      {state.phase === 'running' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-txt-secondary">
            <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching… {state.progress.done} of {state.progress.total}</span>
            <button type="button" className="text-xs text-sky-400 hover:underline" onClick={onCancel}>Cancel search</button>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={state.progress.total} aria-valuenow={state.progress.done} className="h-1.5 overflow-hidden rounded bg-app-surface">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${state.progress.total ? Math.round((100 * state.progress.done) / state.progress.total) : 0}%` }} />
          </div>
        </div>
      )}

      {state.phase === 'done' && result && (
        <>
          <p className="text-txt-muted" data-testid="guide-summary">
            {state.cancelled ? 'Search stopped. ' : ''}{summarizeScan(result.searched, result.skipped)}
            {result.truncated && ' Only the first instances are shown; choose fewer accounts or regions.'}
          </p>
          {result.skipped.length > 0 && (
            <details className="text-txt-muted">
              <summary className="cursor-pointer">Why were some skipped?</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {result.skipped.map((s, i) => (
                  <li key={i}>{s.label}{s.region ? ` · ${s.region}` : ''}: {s.message}</li>
                ))}
              </ul>
            </details>
          )}
          {result.instances.length === 0 ? (
            <p className="text-txt-muted">No online SSM-managed nodes were found. A node appears once it has the SSM Agent and an instance profile with SSM permissions.</p>
          ) : (
            <>
              <input aria-label="Filter instances" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, ID, platform or IP" className={input} />
              <div role="listbox" aria-label="SSM-managed instances" aria-multiselectable={!single} className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border-subtle bg-app-card p-1.5">
                {groups.map((g) => {
                  const target = targets.get(g.targetId);
                  return (
                    <div key={`${g.targetId}|${g.region}`} role="group" aria-label={`${target?.label ?? g.targetId} ${g.region}`}>
                      <div className="px-2 py-1 font-semibold text-txt-secondary">{target?.accountName || target?.label || g.targetId} · <span className="font-mono">{g.region}</span> ({g.items.length})</div>
                      {g.items.map((i) => {
                        const key = instanceKey(i);
                        const on = selected.has(key);
                        const isAdded = added.has(i.instanceId);
                        return (
                          <div
                            key={key}
                            role="option"
                            aria-selected={on}
                            aria-disabled={isAdded}
                            tabIndex={isAdded ? -1 : 0}
                            onClick={() => !isAdded && onToggle(key)}
                            onKeyDown={(e) => {
                              if (!isAdded && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                onToggle(key);
                              }
                            }}
                            className={`grid cursor-pointer grid-cols-[1.3fr_1.2fr_0.9fr_0.9fr_7rem] items-center gap-2 rounded-md px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${on ? 'bg-sky-500/20' : 'hover:bg-app-surface-hover'} ${isAdded ? 'cursor-default opacity-60' : ''}`}
                          >
                            <span className="truncate font-medium text-txt-primary">{on ? '✓ ' : ''}{i.name}{isAdded && <span className="ml-1.5 rounded bg-emerald-500/20 px-1 text-[10px] text-emerald-300">Already added</span>}</span>
                            <span className="truncate font-mono text-txt-muted">{i.instanceId}</span>
                            <span className="truncate text-txt-secondary">{i.platformName ?? i.platformType ?? ''}</span>
                            <span className="truncate text-txt-muted">{i.ipAddress ?? ''}</span>
                            <input
                              aria-label={`SSH login for ${i.name}`}
                              value={usernames[i.instanceId] ?? suggestLoginName(i.platformName)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              onChange={(e) => onUsername(i.instanceId, e.target.value)}
                              disabled={isAdded}
                              className="rounded border border-border-subtle bg-app-input px-1.5 py-0.5 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <p className="text-txt-muted">The SSH login is a suggestion for the platform; the instance may use another. SSH authentication is still required.</p>
            </>
          )}
        </>
      )}
    </section>
  );
};
