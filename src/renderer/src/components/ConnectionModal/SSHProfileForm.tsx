import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2 } from 'lucide-react';
import type { SSHAuthType, SSHConnectionConfig, DetectedSmartcardLib } from '@shared/types/ssh';

interface SSHProfileFormProps {
  initial?: SSHConnectionConfig;
  onSave: (config: SSHConnectionConfig) => void;
  onCancel: () => void;
}

const AUTH_TYPES: { value: SSHAuthType; label: string }[] = [
  { value: 'password', label: 'Lösenord' },
  { value: 'privateKey', label: 'SSH-nyckel' },
  { value: 'agent', label: 'SSH-agent' },
  { value: 'smartcard', label: 'Smartcard (PKCS#11)' },
];

function emptyConfig(): SSHConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: '',
    host: '',
    port: 22,
    username: '',
    authType: 'password',
  };
}

export const SSHProfileForm: React.FC<SSHProfileFormProps> = ({ initial, onSave, onCancel }) => {
  const [config, setConfig] = useState<SSHConnectionConfig>(initial ?? emptyConfig());
  const [smartcardLibs, setSmartcardLibs] = useState<DetectedSmartcardLib[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (config.authType !== 'smartcard') return;
    let mounted = true;
    setDetecting(true);
    void window.multissh
      .smartcardDetect()
      .then((libs) => {
        if (mounted) setSmartcardLibs(libs);
      })
      .finally(() => {
        if (mounted) setDetecting(false);
      });
    return () => {
      mounted = false;
    };
  }, [config.authType]);

  const update = <K extends keyof SSHConnectionConfig>(key: K, value: SSHConnectionConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    if (testResult) setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.multissh.testSSHConnection(config);
      if (res.success) {
        setTestResult({ success: true, message: 'Anslutningen lyckades!' });
      } else {
        setTestResult({ success: false, message: res.error || 'Anslutningen misslyckades' });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Kunde inte testa anslutningen',
      });
    } finally {
      setTesting(false);
    }
  };

  const browseFor = async (key: 'privateKeyPath' | 'pkcs11LibPath' | 'agentPath') => {
    const path = await window.multissh.dialogOpenFile({ title: 'Välj fil' });
    if (path) update(key, path);
  };

  const isValid = config.name.trim() && config.host.trim() && config.username.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isValid) onSave(config);
      }}
      className="flex flex-col gap-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Profilnamn
          <input
            required
            value={config.name}
            onChange={(e) => update('name', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            placeholder="t.ex. Produktionsserver"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Port
          <input
            type="number"
            value={config.port ?? 22}
            onChange={(e) => update('port', Number(e.target.value) || 22)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Värdnamn / IP
          <input
            required
            value={config.host}
            onChange={(e) => update('host', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            placeholder="host.example.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Användarnamn
          <input
            required
            value={config.username}
            onChange={(e) => update('username', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Startsökväg för SFTP (valfritt)
        <input
          value={config.initialPath ?? ''}
          onChange={(e) => update('initialPath', e.target.value)}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          placeholder="t.ex. /home/användare eller /var/www (standard: /)"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Autentisering
        <select
          value={config.authType}
          onChange={(e) => update('authType', e.target.value as SSHAuthType)}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
        >
          {AUTH_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {config.authType === 'password' && (
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Lösenord
          <input
            type="password"
            value={config.password ?? ''}
            onChange={(e) => update('password', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </label>
      )}

      {config.authType === 'privateKey' && (
        <>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Privat nyckel
            <div className="flex gap-1">
              <input
                value={config.privateKeyPath ?? ''}
                onChange={(e) => update('privateKeyPath', e.target.value)}
                className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                placeholder="~/.ssh/id_ed25519"
              />
              <button
                type="button"
                onClick={() => void browseFor('privateKeyPath')}
                className="rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-700"
                title="Bläddra"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Lösenfras (valfritt)
            <input
              type="password"
              value={config.passphrase ?? ''}
              onChange={(e) => update('passphrase', e.target.value)}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          </label>
        </>
      )}

      {config.authType === 'agent' && (
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Agent-socket (valfritt, tom = SSH_AUTH_SOCK)
          <div className="flex gap-1">
            <input
              value={config.agentPath ?? ''}
              onChange={(e) => update('agentPath', e.target.value)}
              className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
              placeholder="/tmp/ssh-agent.sock"
            />
            <button
              type="button"
              onClick={() => void browseFor('agentPath')}
              className="rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-700"
              title="Bläddra"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </label>
      )}

      {config.authType === 'smartcard' && (
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          PKCS#11-bibliotek
          <div className="flex gap-1">
            <select
              value={smartcardLibs.some((lib) => lib.path === config.pkcs11LibPath) ? config.pkcs11LibPath : ''}
              onChange={(e) => {
                if (e.target.value) update('pkcs11LibPath', e.target.value);
              }}
              className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            >
              <option value="">{detecting ? 'Söker...' : 'Välj identifierat bibliotek'}</option>
              {smartcardLibs.map((lib) => (
                <option key={lib.path} value={lib.path} disabled={!lib.exists}>
                  {lib.name} {lib.exists ? '' : '(hittades ej)'}
                </option>
              ))}
            </select>
            {detecting && <Loader2 className="h-4 w-4 animate-spin self-center text-slate-400" />}
          </div>
          <div className="mt-1 flex gap-1">
            <input
              value={config.pkcs11LibPath ?? ''}
              onChange={(e) => update('pkcs11LibPath', e.target.value)}
              className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
              placeholder="Sökväg till .so / .dll"
            />
            <button
              type="button"
              onClick={() => void browseFor('pkcs11LibPath')}
              className="rounded border border-slate-600 px-2 text-slate-300 hover:bg-slate-700"
              title="Bläddra"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
          <span className="mt-0.5 text-slate-500">PIN-kod anges vid anslutning, inte här.</span>
        </label>
      )}

      {testResult && (
        <div
          className={`flex items-center gap-2 rounded px-2.5 py-1.5 text-xs ${
            testResult.success
              ? 'border border-emerald-800 bg-emerald-950/60 text-emerald-300'
              : 'border border-red-800 bg-red-950/60 text-red-300'
          }`}
        >
          {testResult.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          )}
          <span className="truncate">{testResult.message}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          disabled={!config.host.trim() || !config.username.trim() || testing}
          onClick={() => void handleTestConnection()}
          className="flex items-center gap-1.5 rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {testing ? 'Testar...' : 'Testa anslutning'}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
          >
            Avbryt
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
          >
            Spara profil
          </button>
        </div>
      </div>
    </form>
  );
};

export default SSHProfileForm;
