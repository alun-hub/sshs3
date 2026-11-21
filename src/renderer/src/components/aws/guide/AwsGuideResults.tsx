import React, { useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { groupInstances, summarizeScan } from '@shared/awsScan';
import { suggestLoginName } from '@shared/ssm';
import type { AwsScanTarget, ScannedInstance } from '@shared/types/awsScan';
import { instanceKey } from '../../../lib/awsGuide';
import { filterInstances } from '../../../lib/ssmInstancePicker';
import type { AwsScanState } from '../../../lib/useAwsScan';

const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';
const link = 'inline-flex min-h-6 items-center rounded px-1.5 text-xs hover:underline';

interface Props {
  state: AwsScanState;
  targets: ReadonlyMap<string, AwsScanTarget>;
  single: boolean;
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Select / clear several rows at once (multi mode). */
  onSelectMany?: (keys: string[]) => void;
  /** false for a Session Manager shell: there is no SSH login to choose. */
  showLogin?: boolean;
  usernames: Readonly<Record<string, string>>;
  onUsername: (instanceId: string, value: string) => void;
  /** Instance ids that already have an SSM profile. */
  added: ReadonlySet<string>;
  /** Rows for those ids cannot be chosen (importing several profiles). False when filling one profile form: a second profile for the same instance is fine, e.g. in a Team Vault. */
  blockAdded?: boolean;
  onCancel: () => void;
}

/** Steps 4 and 5 of "Add from AWS": progress while searching, then the nodes found, grouped by account and region. */
export const AwsGuideResults: React.FC<Props> = ({ state, targets, single, selected, onToggle, onSelectMany, showLogin = true, usernames, onUsername, added, blockAdded = true, onCancel }) => {
  const [query, setQuery] = useState('');
  const radioName = useId();
  const result = state.result;
  const groups = useMemo(() => {
    if (!result) return [];
    const shown = filterInstances(result.instances, query) as ScannedInstance[];
    return groupInstances(shown);
  }, [result, query]);

  // Rows a bulk selection may take: what the filter shows, minus nodes that already have a profile.
  const selectable = groups.flatMap((g) => g.items).filter((i) => !added.has(i.instanceId));

  if (state.phase === 'idle') return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Instances">
      {state.phase === 'running' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-txt-secondary">
            <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching… {state.progress.done} of {state.progress.total}</span>
            <button type="button" className={`${link} text-sky-400`} onClick={onCancel}>Cancel search</button>
          </div>
          <div role="progressbar" aria-label="Search progress" aria-valuemin={0} aria-valuemax={state.progress.total} aria-valuenow={state.progress.done} className="h-1.5 overflow-hidden rounded bg-app-surface">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${state.progress.total ? Math.round((100 * state.progress.done) / state.progress.total) : 0}%` }} />
          </div>
        </div>
      )}

      {state.phase === 'done' && result && (
        <>
          <p role="status" className="text-txt-muted" data-testid="guide-summary">
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
              <div className="flex items-center gap-3">
                <input aria-label="Filter instances" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, ID, platform or IP" className={`${input} flex-1`} />
                {!single && onSelectMany && (
                  <span className="flex shrink-0 items-center gap-1 text-xs">
                    <button type="button" className={`${link} text-sky-400`} onClick={() => onSelectMany(selectable.map(instanceKey))}>Select all shown ({selectable.length})</button>
                    <button type="button" className={`${link} text-txt-muted`} aria-label="Clear instance selection" onClick={() => onSelectMany([])}>None</button>
                  </span>
                )}
              </div>
              <p role="status" className="text-txt-muted">{selected.size} selected</p>
              <div role="group" aria-label="SSM-managed instances" className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border-subtle bg-app-card p-1.5">
                {groups.map((g) => {
                  const target = targets.get(g.targetId);
                  return (
                    <div key={`${g.targetId}|${g.region}`} role="group" aria-label={`${target?.label ?? g.targetId} ${g.region}`}>
                      <div className="px-2 py-1 font-semibold text-txt-secondary">{target?.accountName || target?.label || g.targetId} · <span className="font-mono">{g.region}</span> ({g.items.length})</div>
                      {g.items.map((i) => {
                        const key = instanceKey(i);
                        const on = selected.has(key);
                        const isAdded = added.has(i.instanceId);
                        const blocked = isAdded && blockAdded;
                        return (
                          <div
                            key={key}
                            // A click on the row (not on one of its inputs) picks it, like a click on the checkbox itself.
                            onClick={(e) => {
                              if (!blocked && !(e.target instanceof HTMLInputElement)) onToggle(key);
                            }}
                            className={`grid ${blocked ? 'cursor-default opacity-60' : 'cursor-pointer'} ${showLogin ? 'grid-cols-[1.25rem_1.3fr_1.2fr_0.9fr_0.9fr_7rem]' : 'grid-cols-[1.25rem_1.3fr_1.2fr_0.9fr_0.9fr]'} items-center gap-2 rounded-md px-2 py-1.5 ${on ? 'bg-sky-500/20' : 'hover:bg-app-surface-hover'}`}
                          >
                            <input
                              type={single ? 'radio' : 'checkbox'}
                              name={single ? radioName : undefined}
                              checked={on}
                              onChange={() => onToggle(key)}
                              // Enter picks the row as well as Space (keyboard-first rule); Space is the native toggle.
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (!blocked) onToggle(key);
                                }
                              }}
                              disabled={blocked}
                              aria-label={`${i.name}, ${i.instanceId}${isAdded ? ', already added' : ''}`}
                              className="h-3.5 w-3.5 text-sky-600"
                            />
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium text-txt-primary" title={i.name}>{i.name}</span>
                              {isAdded && <span title="A profile for this instance already exists" className="shrink-0 rounded bg-emerald-500/20 px-1 text-2xs text-emerald-300">Already added</span>}
                            </span>
                            <span className="truncate font-mono text-txt-muted" title={i.instanceId}>{i.instanceId}</span>
                            <span className="truncate text-txt-secondary" title={i.platformName ?? i.platformType ?? ''}>{i.platformName ?? i.platformType ?? ''}</span>
                            <span className="truncate text-txt-muted">{i.ipAddress ?? ''}</span>
                            {showLogin && (
                            <input
                              aria-label={`SSH login for ${i.name}`}
                              value={usernames[i.instanceId] ?? suggestLoginName(i.platformName)}
                              onChange={(e) => onUsername(i.instanceId, e.target.value)}
                              disabled={blocked}
                              className="rounded border border-border-subtle bg-app-input px-1.5 py-1 font-mono text-xs text-txt-primary outline-none focus:border-sky-500"
                            />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {showLogin && <p className="text-txt-muted">The SSH login is a suggestion for the platform; the instance may use another. SSH authentication is still required.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
};
