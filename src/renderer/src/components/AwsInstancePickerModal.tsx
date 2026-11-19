import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, Search, X } from 'lucide-react';
import { allSignIns } from '@shared/awsSignIns';
import { normalizeStartUrl } from '@shared/ssm';
import { offersAwsSsoSignIn } from '@shared/types/aws';
import type { AwsCliProfile, AwsPickItem, AwsProfileStatus, AwsScanTarget } from '@shared/types/awsScan';
import type { AppSettings } from '@shared/types/settings';
import type { SSHConnectionConfig } from '@shared/types/ssh';
import { accountsWithoutRole, alreadyAdded, applyCommonRole, buildPickItems, commonRoleOptions, defaultRole, defaultTargets, initialRegions, instanceKey, parseAccountIds, profileTargets, ssoTargets, ssoTargetsByRole, takenNamesByFolder, type AccountRoles } from '../lib/awsGuide';
import { describeIpcError } from '../lib/format';
import { toggleSelection } from '../lib/ssmInstancePicker';
import { useAwsScan } from '../lib/useAwsScan';
import { useAwsSsoSignIn } from '../lib/useAwsSsoSignIn';
import { useDialogFocus } from '../lib/useDialogFocus';
import { useModalDismiss } from '../lib/useModalDismiss';
import { AwsGuideConnect, type ConnectChoice } from './aws/guide/AwsGuideConnect';
import { AwsGuideResults } from './aws/guide/AwsGuideResults';
import { AwsGuideScope } from './aws/guide/AwsGuideScope';
import { AwsGuideSource, type SourceKind } from './aws/guide/AwsGuideSource';

export interface AwsPickResult {
  items: AwsPickItem[];
}

interface Props {
  /** `single` picks one instance (fills the profile form); `multi` imports several as new profiles. */
  mode: 'single' | 'multi';
  initialSso?: { startUrl: string; region: string };
  onClose: () => void;
  onPick: (result: AwsPickResult) => void | Promise<void>;
}

/**
 * "Add from AWS": choose where the credentials come from (an IAM Identity Center sign-in, AWS CLI profiles or the
 * default chain), pick accounts and regions, search for SSM-managed nodes and choose the ones to add as profiles.
 * Instances come from `ssm:DescribeInstanceInformation`, so only nodes with a running SSM Agent appear.
 * Credentials and tokens stay in the main process; this dialog only sees status, lists and the nodes found.
 */
export const AwsInstancePickerModal: React.FC<Props> = ({ mode, initialSso, onClose, onPick }) => {
  const single = mode === 'single';
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, true);
  const onBackdrop = useModalDismiss(onClose, true);

  // Data the guide starts from.
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [profiles, setProfiles] = useState<SSHConnectionConfig[]>([]);
  const [cliProfiles, setCliProfiles] = useState<AwsCliProfile[] | null>(null);
  const loaded = useRef(false);

  // Step 1: credentials.
  const [kind, setKind] = useState<SourceKind>('sso');
  const userChoseKind = useRef(false);
  const [savedId, setSavedId] = useState('');
  const [sso, setSso] = useState({ startUrl: initialSso?.startUrl ?? '', region: initialSso?.region ?? 'us-east-1' });
  const [chosenProfiles, setChosenProfiles] = useState<Set<string>>(new Set());
  const [profileStatus, setProfileStatus] = useState<Record<string, AwsProfileStatus | 'checking' | undefined>>({});

  // Steps 2-3: scope.
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [role, setRole] = useState('');
  const [rolesByAccount, setRolesByAccount] = useState<AccountRoles>({});
  const [roleByAccount, setRoleByAccount] = useState<Record<string, string | undefined>>({});
  const [manualText, setManualText] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const regionsTouched = useRef(false);

  // Steps 4-5: search and choice.
  const scan = useAwsScan();
  const lastTargets = useRef<Map<string, AwsScanTarget>>(new Map());
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [connect, setConnect] = useState<ConnectChoice>({ mode: 'ssh', authType: 'agent', privateKeyPath: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIns = useMemo(() => allSignIns(settings?.awsSignIns, settings?.awsManagedSignIns), [settings]);

  const signInState = useAwsSsoSignIn({
    value: { startUrl: kind === 'sso' ? sso.startUrl : '', region: sso.region },
    onChange: (patch) => setSso((s) => ({ ...s, ...(patch.startUrl !== undefined ? { startUrl: patch.startUrl } : {}), ...(patch.region !== undefined ? { region: patch.region } : {}) })),
    pickAccountRole: kind === 'sso',
  });
  const signedIn = signInState.status?.status === 'valid';

  // Load settings, saved profiles and AWS CLI profiles once.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      window.multissh.settingsGet().catch(() => undefined),
      window.multissh.profilesGet().catch(() => ({ ssh: [] as SSHConnectionConfig[] })),
      window.multissh.awsSsmListProfiles().catch(() => [] as AwsCliProfile[]),
    ]).then(([s, p, cli]) => {
      if (!alive) return;
      setSettings(s);
      setProfiles(p.ssh ?? []);
      setCliProfiles(cli);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Pick sensible starting values once the data is there: the first saved sign-in, the configured regions, a source.
  useEffect(() => {
    if (loaded.current || !settings || cliProfiles === null) return;
    loaded.current = true;
    const first = signIns[0];
    if (!initialSso && first) {
      setSavedId(first.id);
      setSso({ startUrl: first.startUrl, region: first.region });
      if (first.lastRoleName) setRole(first.lastRoleName);
    }
    if (!userChoseKind.current) setKind(first || initialSso || cliProfiles.length === 0 ? 'sso' : 'profile');
    if (!regionsTouched.current) setRegions(initialRegions(settings.awsRegions, initialSso?.region ?? first?.region));
  }, [settings, cliProfiles, signIns, initialSso]);

  const chooseSaved = (id: string) => {
    setSavedId(id);
    const s = signIns.find((x) => x.id === id);
    if (s) {
      setSso({ startUrl: s.startUrl, region: s.region });
      if (s.lastRoleName) setRole(s.lastRoleName);
    }
    setSelectedAccounts(new Set());
  };

  // Roles per selected account, loaded as accounts are ticked (a few at a time) and preselected sensibly.
  const rolePrefs = useRef<Array<string | undefined>>([]);
  rolePrefs.current = [role, signIns.find((x) => x.id === savedId)?.lastRoleName];
  // Bumped when the sign-in changes so answers for the old one are dropped.
  const roleGeneration = useRef(0);
  useEffect(() => {
    roleGeneration.current += 1;
    setRolesByAccount({});
    setRoleByAccount({});
  }, [sso.startUrl, sso.region]);
  useEffect(() => {
    if (kind !== 'sso' || !signedIn || signInState.manualEntry) return;
    const loading = Object.values(rolesByAccount).filter((v) => v === 'loading').length;
    const batch = [...selectedAccounts].filter((id) => rolesByAccount[id] === undefined).slice(0, Math.max(0, 4 - loading));
    if (batch.length === 0) return;
    setRolesByAccount((r) => ({ ...r, ...Object.fromEntries(batch.map((id) => [id, 'loading' as const])) }));
    const generation = roleGeneration.current;
    for (const id of batch) {
      window.multissh
        .awsSsoListRolesCached({ startUrl: normalizeStartUrl(sso.startUrl), region: sso.region.trim(), accountId: id })
        .then((list) => {
          if (generation !== roleGeneration.current) return;
          const names = list.map((r) => r.roleName);
          setRolesByAccount((r) => ({ ...r, [id]: names }));
          const pick = defaultRole(names, rolePrefs.current);
          if (pick) setRoleByAccount((cur) => (cur[id] ? cur : { ...cur, [id]: pick }));
        })
        .catch(() => generation === roleGeneration.current && setRolesByAccount((r) => ({ ...r, [id]: 'error' })));
    }
  }, [kind, signedIn, signInState.manualEntry, selectedAccounts, rolesByAccount, sso.startUrl, sso.region]);

  const checkProfile = async (name: string) => {
    setProfileStatus((s) => ({ ...s, [name]: 'checking' }));
    try {
      const st = await window.multissh.awsSsmProfileStatus(name);
      setProfileStatus((s) => ({ ...s, [name]: st }));
    } catch (err) {
      setProfileStatus((s) => ({ ...s, [name]: { ok: false, message: describeIpcError(err, 'Could not check this profile').replace(/^Error:\s*/, '') } }));
    }
  };
  const loginProfile = async (name: string) => {
    setProfileStatus((s) => ({ ...s, [name]: 'checking' }));
    const r = await window.multissh.awsSsmProfileLogin(name).catch((err) => ({ ok: false, message: describeIpcError(err, 'Sign-in failed') }));
    if (r.ok) await checkProfile(name);
    else setProfileStatus((s) => ({ ...s, [name]: { ok: false, message: r.message } }));
  };
  const toggleProfile = (name: string) => {
    setChosenProfiles((cur) => toggleSelection(cur, name, single));
    if (!profileStatus[name]) void checkProfile(name);
  };

  // Some permission sets cannot list accounts through the portal: then account ids are typed in.
  const manualAccounts = kind === 'sso' && signedIn && signInState.manualEntry;

  // What a search would look at right now.
  const targets: AwsScanTarget[] = useMemo(() => {
    if (kind === 'sso') {
      const start = { startUrl: normalizeStartUrl(sso.startUrl), region: sso.region.trim() };
      if (manualAccounts) {
        const typed = parseAccountIds(manualText);
        return ssoTargets(start, typed, new Set(typed.map((a) => a.accountId)), role);
      }
      return ssoTargetsByRole(start, signInState.accounts, selectedAccounts, roleByAccount);
    }
    if (kind === 'profile') return profileTargets([...chosenProfiles]);
    return defaultTargets();
  }, [kind, sso, signInState.accounts, selectedAccounts, role, roleByAccount, chosenProfiles, manualAccounts, manualText]);
  const needRole = kind === 'sso' && !manualAccounts ? accountsWithoutRole(selectedAccounts, roleByAccount) : [];
  const rolesLoading = kind === 'sso' && !manualAccounts && [...selectedAccounts].some((id) => rolesByAccount[id] === 'loading' || rolesByAccount[id] === undefined);
  const canSearch =
    regions.length > 0 && targets.length > 0 && (kind !== 'sso' || (signedIn && (manualAccounts ? role.trim() !== '' : needRole.length === 0 && !rolesLoading))) && scan.state.phase !== 'running';

  const search = () => {
    lastTargets.current = new Map(targets.map((t) => [t.id, t]));
    setSelectedKeys(new Set());
    setError(null);
    void scan.start({ targets, regions, includeWindows: false });
  };

  const result = scan.state.result;
  const added = useMemo(() => alreadyAdded(profiles), [profiles]);
  const chosen = (result?.instances ?? []).filter((i) => selectedKeys.has(instanceKey(i)));

  const submit = async () => {
    if (chosen.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onPick({ items: buildPickItems(chosen, lastTargets.current, usernames, takenNamesByFolder(profiles), single ? {} : { mode: connect.mode, authType: connect.authType, privateKeyPath: connect.privateKeyPath || undefined }) });
    } catch (err) {
      setError(describeIpcError(err, 'Could not import the selected instances'));
      setSaving(false);
    }
  };

  const scanError = scan.state.error;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onClick={onBackdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={single ? 'Pick an AWS instance' : 'Import instances from AWS'}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-xl border border-border-subtle bg-app-surface p-4 text-xs shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-divider pb-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-sky-400">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            <span>{single ? 'Pick an AWS instance' : 'Add instances from AWS'}</span>
          </div>
          <button type="button" aria-label="Close" title="Close" onClick={onClose} className="rounded p-1 text-txt-muted hover:text-txt-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <AwsGuideSource
          kind={kind}
          onKind={(k) => { userChoseKind.current = true; setKind(k); scan.reset(); }}
          single={single}
          signIns={signIns}
          savedId={savedId}
          onSaved={chooseSaved}
          sso={sso}
          onSso={(patch) => { setSavedId(''); setSso((s) => ({ ...s, ...(patch.startUrl !== undefined ? { startUrl: patch.startUrl } : {}), ...(patch.region !== undefined ? { region: patch.region } : {}) })); }}
          signInState={signInState}
          profiles={cliProfiles}
          chosenProfiles={chosenProfiles}
          onToggleProfile={toggleProfile}
          profileStatus={profileStatus}
          onCheckProfile={(n) => void checkProfile(n)}
          onLoginProfile={(n) => void loginProfile(n)}
        />

        {(kind !== 'sso' || signedIn) && (
          <AwsGuideScope
            accounts={kind === 'sso' && !manualAccounts ? signInState.accounts : undefined}
            manualAccounts={manualAccounts ? { text: manualText, onText: setManualText, role, onRole: setRole } : undefined}
            selectedAccounts={selectedAccounts}
            onToggleAccount={(id) => setSelectedAccounts((cur) => toggleSelection(cur, id, false))}
            onSelectAccounts={(ids) => setSelectedAccounts(new Set(ids))}
            rolesByAccount={rolesByAccount}
            roleByAccount={roleByAccount}
            onRoleFor={(id, r) => setRoleByAccount((cur) => ({ ...cur, [id]: r || undefined }))}
            commonOptions={commonRoleOptions(selectedAccounts, rolesByAccount)}
            onApplyCommon={(r) => setRoleByAccount((cur) => applyCommonRole(r, selectedAccounts, rolesByAccount, cur))}
            regions={regions}
            onRegions={(r) => { regionsTouched.current = true; setRegions(r); }}
          />
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="guide-search"
            disabled={!canSearch}
            onClick={search}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs font-medium text-txt-primary hover:bg-app-surface-hover disabled:opacity-40"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" /> Find instances
          </button>
          {!canSearch && scan.state.phase !== 'running' && (
            <span className="text-txt-muted">
              {kind === 'sso' && !signedIn ? 'Sign in first.' : targets.length === 0 ? (kind === 'sso' ? (manualAccounts ? 'Enter at least one account ID.' : selectedAccounts.size > 0 ? (rolesLoading ? 'Loading roles…' : 'Choose a role for each selected account.') : 'Select at least one account.') : 'Choose a profile.') : kind === 'sso' && manualAccounts && !role.trim() ? 'Enter the role name.' : 'Select at least one region.'}
            </span>
          )}
        </div>

        <AwsGuideResults
          state={scan.state}
          targets={lastTargets.current}
          single={single}
          selected={selectedKeys}
          onToggle={(key) => setSelectedKeys((cur) => toggleSelection(cur, key, single))}
          onSelectMany={(keys) => setSelectedKeys((cur) => (keys.length === 0 ? new Set() : new Set([...cur, ...keys])))}
          showLogin={single || connect.mode === 'ssh'}
          usernames={usernames}
          onUsername={(id, v) => setUsernames((u) => ({ ...u, [id]: v }))}
          added={added}
          onCancel={scan.cancel}
        />

        {!single && result && result.instances.length > 0 && <AwsGuideConnect value={connect} onChange={(patch) => setConnect((c) => ({ ...c, ...patch }))} />}

        {(error || scanError) && (
          <p role="alert" className="text-red-400">
            {error ?? scanError}
            {offersAwsSsoSignIn(error ?? scanError ?? '') ? ' Sign in again above.' : ''}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-divider pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-txt-secondary hover:bg-app-hover">Cancel</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || chosen.length === 0 || (!single && connect.mode === 'ssh' && connect.authType === 'privateKey' && !connect.privateKeyPath)}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {single ? 'Use selected' : `Import selected${chosen.length ? ` (${chosen.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
