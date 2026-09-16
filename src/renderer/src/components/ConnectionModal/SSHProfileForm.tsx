import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FolderOpen, Loader2, Plus, Trash2 } from 'lucide-react';
import type {
  SSHAuthType,
  SSHConnectionConfig,
  DetectedSmartcardLib,
  SSHTunnelConfig,
  SSHTunnelType,
} from '@shared/types/ssh';

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tunnelsOpen, setTunnelsOpen] = useState(false);

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
          Grupp / Mapp (valfritt)
          <input
            value={config.group ?? ''}
            onChange={(e) => update('group', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            placeholder="t.ex. Produktion eller Servrar"
          />
        </label>
      </div>

      <div className="grid grid-cols-[1fr_80px_1fr] gap-2">
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
          Port
          <input
            type="number"
            value={config.port ?? 22}
            onChange={(e) => update('port', Number(e.target.value) || 22)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
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

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Startsökväg för SFTP (valfritt)
          <input
            value={config.initialPath ?? ''}
            onChange={(e) => update('initialPath', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            placeholder="t.ex. /home/användare eller /var/www"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Jump host / ProxyJump (valfritt)
          <input
            value={config.proxyJump ?? ''}
            onChange={(e) => update('proxyJump', e.target.value)}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
            placeholder="t.ex. jumpuser@bastion.example.com:22"
          />
        </label>
      </div>

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

      {/* Outgoing Proxy */}
      <div className="rounded border border-slate-700/80 bg-slate-900/50 p-2.5">
        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
          <input
            type="checkbox"
            checked={Boolean(config.proxy?.enabled)}
            onChange={(e) => {
              const enabled = e.target.checked;
              setConfig((prev) => ({
                ...prev,
                proxy: {
                  enabled,
                  type: prev.proxy?.type ?? 'socks5',
                  host: prev.proxy?.host ?? '',
                  port: prev.proxy?.port ?? 1080,
                  username: prev.proxy?.username ?? '',
                  password: prev.proxy?.password ?? '',
                },
              }));
            }}
            className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
          />
          <span>Utgående proxy (HTTP / SOCKS)</span>
        </label>

        {config.proxy?.enabled && (
          <div className="mt-2.5 space-y-2 text-xs">
            <div className="grid grid-cols-[110px_1fr_90px] gap-2">
              <label className="flex flex-col gap-1 text-slate-400">
                Proxytyp
                <select
                  value={config.proxy.type}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: {
                        ...prev.proxy!,
                        type: e.target.value as any,
                        port:
                          prev.proxy?.port === 1080 || prev.proxy?.port === 8080
                            ? e.target.value === 'http'
                              ? 8080
                              : 1080
                            : prev.proxy?.port ?? 1080,
                      },
                    }))
                  }
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                >
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP</option>
                  <option value="socks4">SOCKS4</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-slate-400">
                Proxy-värd
                <input
                  value={config.proxy.host}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, host: e.target.value },
                    }))
                  }
                  placeholder="proxy.example.com"
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </label>

              <label className="flex flex-col gap-1 text-slate-400">
                Port
                <input
                  type="number"
                  value={config.proxy.port || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, port: parseInt(e.target.value, 10) || 0 },
                    }))
                  }
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-slate-400">
                Användarnamn (valfritt)
                <input
                  value={config.proxy.username ?? ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, username: e.target.value },
                    }))
                  }
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-slate-400">
                Lösenord (valfritt)
                <input
                  type="password"
                  value={config.proxy.password ?? ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, password: e.target.value },
                    }))
                  }
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Advanced SSH Options */}
      <div className="rounded border border-slate-700/80 bg-slate-900/50">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex w-full items-center justify-between p-2.5 text-xs font-medium text-slate-300 hover:bg-slate-800/50"
        >
          <span>Avancerade SSH-alternativ (Kompression, KeepAlive, Ciphers, KEX, MACs)</span>
          {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {advancedOpen && (
          <div className="border-t border-slate-800 p-2.5 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
                <input
                  type="checkbox"
                  checked={Boolean(config.compression)}
                  onChange={(e) => update('compression', e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                />
                <span>Aktivera kompression (Compression)</span>
              </label>

              <label className="flex flex-col gap-1 text-slate-400">
                Keep-alive-intervall i sekunder (ServerAliveInterval)
                <input
                  type="number"
                  min={0}
                  value={config.serverAliveInterval || ''}
                  onChange={(e) => update('serverAliveInterval', parseInt(e.target.value, 10) || undefined)}
                  placeholder="t.ex. 30 eller 60 (0 = av)"
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-slate-400">
              KEX-algoritmer (Key Exchange, komma-separerad)
              <input
                value={config.kexAlgorithms ?? ''}
                onChange={(e) => update('kexAlgorithms', e.target.value)}
                placeholder="t.ex. curve25519-sha256,diffie-hellman-group14-sha1"
                className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-slate-400">
                Krypteringsalgoritmer (Ciphers)
                <input
                  value={config.ciphers ?? ''}
                  onChange={(e) => update('ciphers', e.target.value)}
                  placeholder="t.ex. aes128-ctr,aes256-gcm@openssh.com"
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </label>

              <label className="flex flex-col gap-1 text-slate-400">
                MAC-algoritmer (MACs)
                <input
                  value={config.macs ?? ''}
                  onChange={(e) => update('macs', e.target.value)}
                  placeholder="t.ex. hmac-sha2-256,hmac-sha1"
                  className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* SSH Port Forwarding / Tunnels */}
      <div className="rounded border border-slate-700/80 bg-slate-900/50">
        <div className="flex w-full items-center justify-between p-2.5 text-xs font-medium text-slate-300">
          <button
            type="button"
            onClick={() => setTunnelsOpen((o) => !o)}
            className="flex items-center gap-1.5 hover:text-white"
          >
            <span>Porttunnling (Lokal, Fjärr, Dynamisk SOCKS)</span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-sky-400">
              {(config.tunnels || []).length}
            </span>
            {tunnelsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setTunnelsOpen(true);
              const newTunnel: SSHTunnelConfig = {
                id: crypto.randomUUID(),
                type: 'local',
                localPort: 8080,
                remoteHost: '127.0.0.1',
                remotePort: 80,
                enabled: true,
              };
              setConfig((prev) => ({ ...prev, tunnels: [...(prev.tunnels || []), newTunnel] }));
            }}
            className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs text-sky-400 hover:bg-slate-700"
          >
            <Plus className="h-3 w-3" />
            <span>Lägg till tunnel</span>
          </button>
        </div>

        {tunnelsOpen && (
          <div className="border-t border-slate-800 p-2.5 space-y-2 text-xs">
            {(config.tunnels || []).length === 0 ? (
              <p className="py-2 text-center text-slate-500">Inga porttunnlar konfigurerade</p>
            ) : (
              (config.tunnels || []).map((tunnel) => (
                <div
                  key={tunnel.id}
                  className="flex flex-col gap-2 rounded border border-slate-800 bg-slate-950/60 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={tunnel.enabled !== false}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setConfig((prev) => ({
                            ...prev,
                            tunnels: (prev.tunnels || []).map((t) =>
                              t.id === tunnel.id ? { ...t, enabled } : t
                            ),
                          }));
                        }}
                        className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500"
                      />
                      <span className="font-semibold text-slate-200">
                        {tunnel.type === 'local'
                          ? 'Lokal portvidarebefordran (-L)'
                          : tunnel.type === 'remote'
                          ? 'Fjärrportvidarebefordran (-R)'
                          : 'Dynamisk SOCKS-proxy (-D)'}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setConfig((prev) => ({
                          ...prev,
                          tunnels: (prev.tunnels || []).filter((t) => t.id !== tunnel.id),
                        }))
                      }
                      className="rounded p-1 text-red-400 hover:bg-slate-800"
                      title="Ta bort tunnel"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-[120px_1fr] gap-2">
                    <label className="flex flex-col gap-1 text-slate-400">
                      Typ
                      <select
                        value={tunnel.type}
                        onChange={(e) => {
                          const type = e.target.value as SSHTunnelType;
                          setConfig((prev) => ({
                            ...prev,
                            tunnels: (prev.tunnels || []).map((t) =>
                              t.id === tunnel.id ? { ...t, type } : t
                            ),
                          }));
                        }}
                        className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                      >
                        <option value="local">Lokal (-L)</option>
                        <option value="remote">Fjärr (-R)</option>
                        <option value="dynamic">Dynamisk (-D)</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-slate-400">
                      Lokal port
                      <input
                        type="number"
                        value={tunnel.localPort || ''}
                        onChange={(e) => {
                          const localPort = parseInt(e.target.value, 10) || 0;
                          setConfig((prev) => ({
                            ...prev,
                            tunnels: (prev.tunnels || []).map((t) =>
                              t.id === tunnel.id ? { ...t, localPort } : t
                            ),
                          }));
                        }}
                        placeholder="t.ex. 8080 eller 1080"
                        className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                      />
                    </label>
                  </div>

                  {tunnel.type !== 'dynamic' && (
                    <div className="grid grid-cols-[1fr_90px] gap-2">
                      <label className="flex flex-col gap-1 text-slate-400">
                        Fjärrvärd
                        <input
                          value={tunnel.remoteHost ?? '127.0.0.1'}
                          onChange={(e) => {
                            const remoteHost = e.target.value;
                            setConfig((prev) => ({
                              ...prev,
                              tunnels: (prev.tunnels || []).map((t) =>
                                t.id === tunnel.id ? { ...t, remoteHost } : t
                              ),
                            }));
                          }}
                          placeholder="127.0.0.1 eller db.internal"
                          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-slate-400">
                        Fjärrport
                        <input
                          type="number"
                          value={tunnel.remotePort || ''}
                          onChange={(e) => {
                            const remotePort = parseInt(e.target.value, 10) || 0;
                            setConfig((prev) => ({
                              ...prev,
                              tunnels: (prev.tunnels || []).map((t) =>
                                t.id === tunnel.id ? { ...t, remotePort } : t
                              ),
                            }));
                          }}
                          placeholder="80"
                          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                        />
                      </label>
                    </div>
                  )}

                  <label className="flex flex-col gap-1 text-slate-400">
                    Beskrivning (valfritt)
                    <input
                      value={tunnel.description ?? ''}
                      onChange={(e) => {
                        const description = e.target.value;
                        setConfig((prev) => ({
                          ...prev,
                          tunnels: (prev.tunnels || []).map((t) =>
                            t.id === tunnel.id ? { ...t, description } : t
                          ),
                        }));
                      }}
                      placeholder="t.ex. Databastunnel eller Web UI"
                      className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                    />
                  </label>
                </div>
              ))
            )}
          </div>
        )}
      </div>

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
