import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidRegion, isValidSsoConfig, normalizeStartUrl } from '@shared/ssm';
import type { AwsSsoAccount, AwsSsoAccountRole, AwsSsoNetworkOptions } from '@shared/types/aws';
import type { AwsSsoStatusInfo } from '@shared/types/awsScan';
import { describeIpcError } from './format';

export interface AwsSsoValue {
  startUrl: string;
  region: string;
  accountId?: string;
  roleName?: string;
}

interface Options {
  value: AwsSsoValue;
  onChange: (patch: Partial<AwsSsoValue>) => void;
  /** Proxy / CA of the profile this sign-in belongs to. */
  network?: AwsSsoNetworkOptions;
  /** Saved S3 profile whose proxy/CA the account and role lists should use (looked up in the main process). */
  s3ProfileId?: string;
  /** false = only sign in (no account/role lists). */
  pickAccountRole?: boolean;
}

const STATUS_DEBOUNCE_MS = 400;

/**
 * IAM Identity Center sign-in for a form: shows whether the cached sign-in is still valid, signs in, and (when
 * `pickAccountRole`) lists accounts and roles. The access token stays in the main process; only status and the lists
 * come back (`awsSsoStatus`, `awsSsoList*Cached`).
 */
export function useAwsSsoSignIn({ value, onChange, network, s3ProfileId, pickAccountRole = true }: Options) {
  const startUrl = normalizeStartUrl(value.startUrl);
  const region = value.region.trim();
  const ready = isValidSsoConfig({ startUrl, region });

  const [status, setStatus] = useState<AwsSsoStatusInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AwsSsoAccount[]>([]);
  const [roles, setRoles] = useState<AwsSsoAccountRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [manualEntry, setManualEntry] = useState(false);
  const generation = useRef(0);
  // Latest account / role request: answers for an older one (another account or sign-in was chosen meanwhile) are dropped.
  const rolesReq = useRef(0);
  const accountsReq = useRef(0);
  const networkRef = useRef(network);
  networkRef.current = network;
  const valueRef = useRef(value);
  valueRef.current = value;

  const loadRoles = useCallback(
    async (accountId: string) => {
      if (!accountId || !ready) return;
      const mine = ++rolesReq.current;
      setLoadingRoles(true);
      try {
        const list = await window.multissh.awsSsoListRolesCached({ startUrl, region, accountId, s3ProfileId });
        if (mine === rolesReq.current) setRoles(list);
      } catch (err) {
        if (mine === rolesReq.current) setError(describeIpcError(err, 'Failed to list roles for this account'));
      } finally {
        if (mine === rolesReq.current) setLoadingRoles(false);
      }
    },
    [ready, startUrl, region, s3ProfileId]
  );

  const loadAccounts = useCallback(async () => {
    const mine = ++accountsReq.current;
    try {
      setManualEntry(false);
      const list = await window.multissh.awsSsoListAccountsCached({ startUrl, region, s3ProfileId });
      if (mine !== accountsReq.current) return;
      setAccounts(list);
      const current = valueRef.current.accountId;
      if (current) void loadRoles(current);
    } catch (err) {
      if (mine !== accountsReq.current) return; // a newer request (another URL or region) owns the state now
      // Some permission sets cannot list accounts/roles through the portal API: fall back to typing them in, and say why.
      setManualEntry(true);
      const detail = describeIpcError(err, 'Could not list the accounts');
      // Listing goes through the proxy/CA of Settings -> AWS or of the SAVED profile, never one typed in this form.
      const hasOwnNetwork = Boolean(networkRef.current?.proxy || networkRef.current?.customCaPath);
      setError(`${detail} You can type the account and role instead.${hasOwnNetwork && !s3ProfileId ? ' Account lists use the proxy and CA from Settings → AWS; save this profile first to use its own.' : ''}`);
    }
  }, [startUrl, region, s3ProfileId, loadRoles]);

  const refreshStatus = useCallback(async (): Promise<AwsSsoStatusInfo | null> => {
    if (!ready) {
      setStatus(null);
      return null;
    }
    const mine = ++generation.current;
    setChecking(true);
    try {
      const info = await window.multissh.awsSsoStatus(startUrl);
      if (mine !== generation.current) return null;
      setStatus(info);
      if (info.status === 'valid' && pickAccountRole) void loadAccounts();
      return info;
    } catch {
      if (mine === generation.current) setStatus(null);
      return null;
    } finally {
      if (mine === generation.current) setChecking(false);
    }
  }, [ready, startUrl, pickAccountRole, loadAccounts]);

  // Re-check (debounced) whenever the start URL or region changes, including on first render.
  useEffect(() => {
    accountsReq.current++;
    rolesReq.current++;
    setAccounts([]);
    setRoles([]);
    setError(null);
    const t = setTimeout(() => void refreshStatus(), STATUS_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // refreshStatus changes with startUrl/region/ready, which is exactly when to re-check.
  }, [refreshStatus]);

  const signIn = useCallback(async () => {
    if (!ready) return;
    setError(null);
    setSigningIn(true);
    try {
      await window.multissh.awsSsoLogin(startUrl, region, s3ProfileId);
      await refreshStatus();
    } catch (err) {
      setError(describeIpcError(err, 'AWS SSO login failed'));
    } finally {
      setSigningIn(false);
    }
  }, [ready, startUrl, region, s3ProfileId, refreshStatus]);

  const selectAccount = useCallback(
    (accountId: string) => {
      onChange({ accountId: accountId || undefined, roleName: undefined });
      setRoles([]);
      void loadRoles(accountId);
    },
    [onChange, loadRoles]
  );

  return { startUrl, region, ready: ready && isValidRegion(region), status, checking, signingIn, error, accounts, roles, loadingRoles, manualEntry, signIn, refreshStatus, selectAccount };
}
