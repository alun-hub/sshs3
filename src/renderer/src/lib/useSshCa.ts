import { useCallback, useEffect, useState } from 'react';
import type { SshCaConfig, SshCaStatus } from '@shared/types/sshCa';
import { ELECTRON_IPC_PREFIX } from './format';

function cleanIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(ELECTRON_IPC_PREFIX, '');
}

export function useSshCa() {
  const [status, setStatus] = useState<SshCaStatus>({ active: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async (): Promise<SshCaStatus> => {
    if (!window.sshs3?.sshCaGetStatus) {
      return { active: false };
    }
    try {
      const s = await window.sshs3.sshCaGetStatus();
      setStatus(s);
      return s;
    } catch (err) {
      const msg = cleanIpcError(err);
      setError(msg);
      return { active: false, error: msg };
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    if (!window.sshs3?.onSshCaStatusChanged) return;
    const unsubscribe = window.sshs3.onSshCaStatusChanged((s) => {
      setStatus(s);
      if (s.error) {
        setError(s.error);
      } else {
        setError(null);
      }
    });
    return () => unsubscribe();
  }, [refreshStatus]);

  const login = useCallback(async (config?: SshCaConfig): Promise<SshCaStatus> => {
    if (!window.sshs3?.sshCaLogin) {
      throw new Error('SSH CA is not supported in this environment');
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.sshs3.sshCaLogin(config);
      setStatus(res);
      return res;
    } catch (err) {
      const msg = cleanIpcError(err);
      setError(msg);
      throw new Error(msg, { cause: err });
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    if (!window.sshs3?.sshCaLogout) return;
    setLoading(true);
    setError(null);
    try {
      await window.sshs3.sshCaLogout();
      setStatus({ active: false });
    } catch (err) {
      const msg = cleanIpcError(err);
      setError(msg);
      throw new Error(msg, { cause: err });
    } finally {
      setLoading(false);
    }
  }, []);

  const renew = useCallback(async (): Promise<SshCaStatus> => {
    if (!window.sshs3?.sshCaRenew) {
      throw new Error('SSH CA is not supported in this environment');
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.sshs3.sshCaRenew();
      setStatus(res);
      return res;
    } catch (err) {
      const msg = cleanIpcError(err);
      setError(msg);
      throw new Error(msg, { cause: err });
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    status,
    loading,
    error,
    login,
    logout,
    renew,
    refreshStatus,
  };
}
