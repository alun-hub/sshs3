import React, { useMemo, useState } from 'react';
import { parseRegionList } from '@shared/awsSignIns';
import { AWS_DEFAULT_REGIONS } from '@shared/awsScan';
import type { AwsSsoAccount } from '@shared/types/aws';

const input = 'rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500';
const link = 'text-xs text-sky-400 hover:underline';

interface Props {
  /** The portal would not list accounts: let the user type account ids instead (SSO sign-in only). */
  manualAccounts?: { text: string; onText: (text: string) => void; role?: string; onRole?: (r: string) => void };
  /** Accounts to choose from (SSO sign-in only). */
  accounts?: readonly AwsSsoAccount[];
  selectedAccounts?: ReadonlySet<string>;
  onToggleAccount?: (id: string) => void;
  onSelectAccounts?: (ids: string[]) => void;
  role?: string;
  onRole?: (role: string) => void;
  roleOptions?: readonly string[];
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
            <input data-testid="guide-role" value={p.role ?? ''} onChange={(e) => p.onRole?.(e.target.value.trim())} placeholder="e.g. ReadOnlyAccess" className={`${input} font-mono`} />
          </label>
        </section>
      )}

      {p.accounts && !p.manualAccounts && (
        <section className="flex flex-col gap-2" aria-label="Accounts and role">
          <div className="flex items-end justify-between gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-txt-secondary">
              Role (the same name is used in every selected account)
              <input
                data-testid="guide-role"
                list="guide-role-options"
                value={p.role ?? ''}
                onChange={(e) => p.onRole?.(e.target.value.trim())}
                placeholder="e.g. ReadOnlyAccess"
                className={`${input} font-mono`}
              />
              <datalist id="guide-role-options">
                {(p.roleOptions ?? []).map((r) => <option key={r} value={r} />)}
              </datalist>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input aria-label="Filter accounts" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter accounts" className={`${input} flex-1`} />
            <button type="button" className={link} onClick={() => p.onSelectAccounts?.(visible.map((a) => a.accountId))}>Select shown</button>
            <button type="button" className={link} onClick={() => p.onSelectAccounts?.([])}>None</button>
          </div>
          <ul aria-label="Accounts" className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border-subtle bg-app-card p-1">
            {visible.length === 0 && <li className="px-2 py-1.5 text-txt-muted">{p.accounts.length === 0 ? 'No accounts found for this sign-in.' : 'No account matches the filter.'}</li>}
            {visible.map((a) => (
              <li key={a.accountId}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-app-surface-hover">
                  <input type="checkbox" checked={p.selectedAccounts?.has(a.accountId) ?? false} onChange={() => p.onToggleAccount?.(a.accountId)} className="h-3.5 w-3.5 text-sky-600" />
                  <span className="truncate font-medium text-txt-primary">{a.accountName || a.accountId}</span>
                  {a.accountName && <span className="font-mono text-txt-muted">{a.accountId}</span>}
                </label>
              </li>
            ))}
          </ul>
          <p className="text-txt-muted">{p.selectedAccounts?.size ?? 0} of {p.accounts.length} selected.</p>
        </section>
      )}

      <section className="flex flex-col gap-2" aria-label="Regions">
        <div className="flex items-center justify-between">
          <span className="font-medium text-txt-secondary">Regions to search</span>
          <span className="flex gap-3">
            <button type="button" className={link} onClick={() => p.onRegions([...new Set([...AWS_DEFAULT_REGIONS, ...custom])])}>All regions</button>
            <button type="button" className={link} onClick={() => p.onRegions([])}>None</button>
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
          <button type="button" className={link} onClick={addExtra}>Add</button>
        </div>
        <p className="text-txt-muted">Searching many regions in many accounts takes longer; organizations often restrict regions, and those searches are skipped.</p>
      </section>
    </div>
  );
};
