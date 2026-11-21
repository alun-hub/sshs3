import React, { useMemo, useState } from 'react';
import { parseRegionList } from '@shared/awsSignIns';
import { AWS_DEFAULT_REGIONS } from '@shared/awsScan';
import type { AwsSsoAccount } from '@shared/types/aws';
import type { AccountRoles } from '../../../lib/awsGuide';

const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';
const link = 'inline-flex min-h-6 items-center rounded px-1.5 text-xs text-sky-400 hover:underline';

interface Props {
  /** The portal would not list accounts: let the user type account ids instead (SSO sign-in only). */
  manualAccounts?: { text: string; onText: (text: string) => void; role?: string; onRole?: (r: string) => void };
  /** Accounts to choose from (SSO sign-in only). */
  accounts?: readonly AwsSsoAccount[];
  selectedAccounts?: ReadonlySet<string>;
  onToggleAccount?: (id: string) => void;
  onSelectAccounts?: (ids: string[]) => void;
  /** Roles per account (list mode) and the role chosen for each. */
  rolesByAccount?: AccountRoles;
  roleByAccount?: Readonly<Record<string, string | undefined>>;
  onRoleFor?: (accountId: string, role: string) => void;
  commonOptions?: Array<{ role: string; count: number; total: number }>;
  onApplyCommon?: (role: string) => void;
  regions: readonly string[];
  onRegions: (regions: string[]) => void;
}

/** Steps 2 and 3 of "Add from AWS": which accounts and role (SSO) and which regions to search. */
export const AwsGuideScope: React.FC<Props> = (p) => {
  const [filter, setFilter] = useState('');
  const [extra, setExtra] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (p.accounts ?? []).filter((a) => !q || a.accountId.includes(q) || (a.accountName ?? '').toLowerCase().includes(q));
  }, [p.accounts, filter]);
  const selectedRegions = new Set(p.regions);
  const known = new Set(AWS_DEFAULT_REGIONS);
  const custom = p.regions.filter((r) => !known.has(r));

  const toggleRegion = (r: string) => p.onRegions(selectedRegions.has(r) ? p.regions.filter((x) => x !== r) : [...p.regions, r]);
  const addExtra = () => {
    const more = parseRegionList(extra);
    if (more.length > 0) p.onRegions([...new Set([...p.regions, ...more])]);
    setExtra('');
  };

  return (
    <div className="flex flex-col gap-4">
      {p.manualAccounts && (
        <section className="flex flex-col gap-2" aria-label="Accounts and role">
          <p className="text-txt-muted">This sign-in cannot list accounts. Enter the account IDs and the role name instead.</p>
          <label className="flex flex-col gap-1 text-txt-secondary">
            Account IDs (comma separated)
            <textarea
              data-testid="guide-account-ids"
              value={p.manualAccounts.text}
              onChange={(e) => p.manualAccounts?.onText(e.target.value)}
              rows={2}
              placeholder="123456789012, 210987654321"
              className={`${input} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1 text-txt-secondary">
            Role
            <input data-testid="guide-role" value={p.manualAccounts.role ?? ''} onChange={(e) => p.manualAccounts?.onRole?.(e.target.value.trim())} placeholder="e.g. ReadOnlyAccess" className={`${input} font-mono`} />
          </label>
        </section>
      )}

      {p.accounts && !p.manualAccounts && (
        <section className="flex flex-col gap-2" aria-label="Accounts and role">
          <div className="flex items-center gap-2">
            <input aria-label="Filter accounts" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter accounts" className={`${input} flex-1`} />
            <button type="button" className={link} onClick={() => p.onSelectAccounts?.(visible.map((a) => a.accountId))}>Select shown</button>
            <button type="button" className={link} aria-label="Clear account selection" onClick={() => p.onSelectAccounts?.([])}>None</button>
          </div>
          <ul aria-label="Accounts" className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border-subtle bg-app-card p-1">
            {visible.length === 0 && <li className="px-2 py-1.5 text-txt-muted">{p.accounts.length === 0 ? 'No accounts found for this sign-in.' : 'No account matches the filter.'}</li>}
            {visible.map((a) => {
              const on = p.selectedAccounts?.has(a.accountId) ?? false;
              const roles = p.rolesByAccount?.[a.accountId];
              const label = a.accountName || a.accountId;
              return (
                <li key={a.accountId} className="flex items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-app-surface-hover">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={on} onChange={() => p.onToggleAccount?.(a.accountId)} className="h-3.5 w-3.5 text-sky-600" />
                    <span className="truncate font-medium text-txt-primary">{label}</span>
                    {a.accountName && <span className="font-mono text-txt-muted">{a.accountId}</span>}
                  </label>
                  {on && (
                    <span className="shrink-0">
                      {roles === 'loading' || roles === undefined ? (
                        <span className="text-txt-muted">Loading roles…</span>
                      ) : roles === 'error' ? (
                        <input
                          aria-label={`Role for ${label}`}
                          value={p.roleByAccount?.[a.accountId] ?? ''}
                          onChange={(e) => p.onRoleFor?.(a.accountId, e.target.value.trim())}
                          placeholder="Role name"
                          className={`${input} w-40 font-mono`}
                        />
                      ) : roles.length === 0 ? (
                        <span className="text-amber-300">No role available</span>
                      ) : (
                        <select
                          aria-label={`Role for ${label}`}
                          value={p.roleByAccount?.[a.accountId] ?? ''}
                          onChange={(e) => p.onRoleFor?.(a.accountId, e.target.value)}
                          className={`${input} w-44 py-1`}
                        >
                          {!p.roleByAccount?.[a.accountId] && <option value="">Choose a role…</option>}
                          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-3">
            <p role="status" className="text-txt-muted">{p.selectedAccounts?.size ?? 0} of {p.accounts.length} selected.</p>
            {(p.commonOptions?.length ?? 0) > 0 && (
              <label className="flex items-center gap-2 text-txt-secondary">
                Same role everywhere
                <select data-testid="guide-common-role" value="" onChange={(e) => e.target.value && p.onApplyCommon?.(e.target.value)} className={`${input} py-1`}>
                  <option value="">Apply to all selected…</option>
                  {p.commonOptions!.map((o) => (
                    <option key={o.role} value={o.role}>{o.role} ({o.count} of {o.total})</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="Regions">
        <div className="flex items-center justify-between">
          <span className="font-medium text-txt-secondary">Regions to search</span>
          <span className="flex gap-3">
            <button type="button" className={link} onClick={() => p.onRegions([...new Set([...AWS_DEFAULT_REGIONS, ...custom])])}>All regions</button>
            <button type="button" className={link} aria-label="Clear region selection" onClick={() => p.onRegions([])}>None</button>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-1">
          {[...AWS_DEFAULT_REGIONS, ...custom].map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-1.5 font-mono text-txt-secondary">
              <input type="checkbox" checked={selectedRegions.has(r)} onChange={() => toggleRegion(r)} className="h-3.5 w-3.5 text-sky-600" />
              {r}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            aria-label="Another region"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }}
            placeholder="Another region, e.g. ap-east-1"
            className={`${input} flex-1 font-mono`}
          />
          <button type="button" className={link} aria-label="Add region" onClick={addExtra}>Add</button>
        </div>
        <p className="text-txt-muted">Searching many regions in many accounts takes longer; organizations often restrict regions, and those searches are skipped.</p>
      </section>
    </div>
  );
};
