import { useCallback, useState } from 'react';
import type { AwsSsoNetworkOptions } from '@shared/types/aws';
import { describeIpcError } from './format';

/**
 * Signing in one listed sign-in (settings page row, top-bar badge row): which row is busy, the last error, and a
 * `signIn` that runs the device-authorization flow and then asks the caller to re-read the statuses.
 */
export function useAwsRowSignIn(refresh: () => void, network?: AwsSsoNetworkOptions) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signIn = useCallback(
    async (row: { id: string; startUrl: string; region: string }) => {
      setBusyId(row.id);
      setError(null);
      try {
        await window.multissh.awsSsoLogin(row.startUrl, row.region, network);
        refresh();
      } catch (err) {
        setError(describeIpcError(err, 'AWS SSO login failed').replace(/^Error:\s*/, ''));
      } finally {
        setBusyId(null);
      }
    },
    [refresh, network]
  );
  return { busyId, error, signIn, clearError: () => setError(null) };
}
