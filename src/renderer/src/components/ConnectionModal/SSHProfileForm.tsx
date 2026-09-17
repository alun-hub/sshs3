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
  { value: 'password', label: 'Password' },
  { value: 'privateKey', label: 'SSH Key' },
  { value: 'agent', label: 'SSH Agent' },
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
        if (mounted) setSmartcardLibs(libs.filter((l) => l.exists));
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
        setTestResult({ success: true, message: 'Connection succeeded!' });
      } else {
        setTestResult({ success: false, message: res.error || 'Connection failed' });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to test connection',
      });
    } finally {
      setTesting(false);
    }
  };

  const browseFor = async (key: 'privateKeyPath' | 'pkcs11LibPath' | 'agentPath') => {
    const path = await window.multissh.dialogOpenFile({ title: 'Choose File' });
    if (path) update(key, path);
  };

  const isValid = config.name.trim() && config.host.trim() && config.username.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isValid) onSave(config);
      }}
      className="flex flex-col gap-3.5 text-xs text-txt-secondary"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-txt-secondary">
          Profile Name
          <input
            required
            value={config.name}
            onChange={(e) => update('name', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="e.g. Production Server"
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          Group / Folder (optional)
          <input
            value={config.group ?? ''}
            onChange={(e) => update('group', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="e.g. Production or Web Servers"
          />
        </label>
      </div>

      <div className="grid grid-cols-[1fr_80px_1fr] gap-2.5">
        <label className="flex flex-col gap-1 text-txt-secondary">
          Hostname / IP
          <input
            required
            value={config.host}
            onChange={(e) => update('host', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="host.example.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          Port
          <input
            type="number"
            value={config.port ?? 22}
            onChange={(e) => update('port', Number(e.target.value) || 22)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 text-center"
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          Username
          <input
            required
            value={config.username}
            onChange={(e) => update('username', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="root or deploy"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-txt-secondary">
          Initial SFTP Path (optional)
          <input
            value={config.initialPath ?? ''}
            onChange={(e) => update('initialPath', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="e.g. /var/www or /home/user"
          />
        </label>
        <label className="flex flex-col gap-1 text-txt-secondary">
          Jump Host / ProxyJump (optional)
          <input
            value={config.proxyJump ?? ''}
            onChange={(e) => update('proxyJump', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted"
            placeholder="e.g. jumpuser@bastion.example.com:22"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-txt-secondary">
        Authentication
        <select
          value={config.authType}
          onChange={(e) => update('authType', e.target.value as SSHAuthType)}
          className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500"
        >
          {AUTH_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {config.authType === 'password' && (
        <label className="flex flex-col gap-1 text-txt-secondary">
          Password
          <input
            type="password"
            value={config.password ?? ''}
            onChange={(e) => update('password', e.target.value)}
            className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500"
          />
        </label>
      )}

      {config.authType === 'privateKey' && (
        <>
          <label className="flex flex-col gap-1 text-txt-secondary">
            Private Key
            <div className="flex gap-1.5">
              <input
                value={config.privateKeyPath ?? ''}
                onChange={(e) => update('privateKeyPath', e.target.value)}
                className="flex-1 rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted font-mono"
                placeholder="~/.ssh/id_ed25519"
              />
              <button
                type="button"
                onClick={() => void browseFor('privateKeyPath')}
                className="rounded-lg border border-border-subtle px-2.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                title="Browse"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-txt-secondary">
            Passphrase (optional)
            <input
              type="password"
              value={config.passphrase ?? ''}
              onChange={(e) => update('passphrase', e.target.value)}
              className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500"
            />
          </label>
        </>
      )}

      {config.authType === 'agent' && (
        <label className="flex flex-col gap-1 text-txt-secondary">
          Agent Socket (optional, empty = SSH_AUTH_SOCK)
          <div className="flex gap-1.5">
            <input
              value={config.agentPath ?? ''}
              onChange={(e) => update('agentPath', e.target.value)}
              className="flex-1 rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-sm text-txt-primary outline-none focus:border-sky-500 placeholder-txt-muted font-mono"
              placeholder="/tmp/ssh-agent.sock"
            />
            <button
              type="button"
              onClick={() => void browseFor('agentPath')}
              className="rounded-lg border border-border-subtle px-2.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
              title="Browse"
            >
              <FolderOpen className="h-4 w-4" />
            </button>
          </div>
        </label>
      )}

      {config.authType === 'smartcard' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-app-surface-subtle p-3">
          <label className="flex flex-col gap-1 text-txt-secondary">
            PKCS#11 Library (.so / .dll)
            <div className="flex gap-1.5">
              <input
                value={config.pkcs11LibPath ?? ''}
                onChange={(e) => update('pkcs11LibPath', e.target.value)}
                className="flex-1 rounded-lg border border-border-subtle bg-app-input px-2.5 py-1.5 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                placeholder="/usr/lib/libiidp11.so"
              />
              <button
                type="button"
                onClick={() => void browseFor('pkcs11LibPath')}
                className="rounded-lg border border-border-subtle px-2.5 text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
                title="Browse"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </label>

          {detecting ? (
            <div className="flex items-center gap-2 py-1 text-txt-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scanning for PKCS#11 libraries...
            </div>
          ) : smartcardLibs.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-txt-muted">Detected modules on system:</span>
              <div className="flex flex-wrap gap-1.5">
                {smartcardLibs.map((lib) => (
                  <button
                    key={lib.path}
                    type="button"
                    onClick={() => update('pkcs11LibPath', lib.path)}
                    className={
                      'rounded-md border px-2 py-0.5 text-left text-xs transition-colors ' +
                      (config.pkcs11LibPath === lib.path
                        ? 'border-sky-500 bg-sky-500/15 text-sky-300 font-medium'
                        : 'border-border-subtle bg-app-surface text-txt-secondary hover:bg-app-surface-hover')
                    }
                  >
                    <span className="font-semibold">{lib.name}</span>
                    <span className="ml-1 text-[10px] text-txt-muted font-mono">{lib.path}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <span className="text-[11px] text-txt-muted">
              No PKCS#11 libraries automatically detected. Please enter path or browse manually.
            </span>
          )}
        </div>
      )}

      {/* Outgoing Proxy Settings */}
      <div className="rounded-lg border border-border-subtle bg-app-surface-subtle p-2.5">
        <label className="flex items-center gap-2 text-txt-secondary font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(config.proxy)}
            onChange={(e) => {
              if (e.target.checked) {
                update('proxy', { type: 'socks5', host: '127.0.0.1', port: 1080 });
              } else {
                update('proxy', undefined);
              }
            }}
            className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
          />
          <span>Enable Outgoing Proxy (HTTP / SOCKS)</span>
        </label>

        {config.proxy && (
          <div className="mt-2.5 grid grid-cols-2 gap-2.5 pt-2 border-t border-border-subtle">
            <label className="flex flex-col gap-1 text-txt-secondary">
              Proxy Type
              <select
                value={config.proxy.type}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy!, type: e.target.value as any },
                  }))
                }
                className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
              >
                <option value="socks5">SOCKS5</option>
                <option value="socks4">SOCKS4</option>
                <option value="http">HTTP</option>
              </select>
            </label>

            <div className="grid grid-cols-[1fr_70px] gap-2">
              <label className="flex flex-col gap-1 text-txt-secondary">
                Proxy Host
                <input
                  value={config.proxy.host}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, host: e.target.value },
                    }))
                  }
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
                  placeholder="127.0.0.1"
                />
              </label>
              <label className="flex flex-col gap-1 text-txt-secondary">
                Port
                <input
                  type="number"
                  value={config.proxy.port}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      proxy: { ...prev.proxy!, port: Number(e.target.value) || 1080 },
                    }))
                  }
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 text-center"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-txt-secondary">
              Proxy Username (optional)
              <input
                value={config.proxy.username ?? ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy!, username: e.target.value },
                  }))
                }
                className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
              />
            </label>

            <label className="flex flex-col gap-1 text-txt-secondary">
              Proxy Password (optional)
              <input
                type="password"
                value={config.proxy.password ?? ''}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    proxy: { ...prev.proxy!, password: e.target.value },
                  }))
                }
                className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
              />
            </label>
          </div>
        )}
      </div>

      {/* Advanced SSH Options */}
      <div className="rounded-lg border border-border-subtle bg-app-surface-subtle">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex w-full items-center justify-between p-2.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
        >
          <span>Advanced SSH Options (Compression, KeepAlive, Ciphers, KEX, MACs)</span>
          {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {advancedOpen && (
          <div className="border-t border-border-subtle p-3 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-txt-primary">
                <input
                  type="checkbox"
                  checked={config.compression ?? false}
                  onChange={(e) => update('compression', e.target.checked)}
                  className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
                />
                <span>Enable Compression</span>
              </label>

              <label className="flex flex-col gap-1 text-txt-secondary">
                ServerAliveInterval (sec)
                <input
                  type="number"
                  min={0}
                  max={3600}
                  value={config.serverAliveInterval ?? 60}
                  onChange={(e) => update('serverAliveInterval', parseInt(e.target.value, 10) || 0)}
                  className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                />
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-txt-secondary">
                Custom Ciphers (comma-separated, empty = defaults)
                <input
                  value={config.ciphers ?? ''}
                  onChange={(e) => update('ciphers', e.target.value)}
                  className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                  placeholder="chacha20-poly1305@openssh.com,aes128-gcm@openssh.com"
                />
              </label>

              <label className="flex flex-col gap-1 text-txt-secondary">
                Custom KEX Algorithms (comma-separated, empty = defaults)
                <input
                  value={config.kexAlgorithms ?? ''}
                  onChange={(e) => update('kexAlgorithms', e.target.value)}
                  className="rounded-lg border border-border-subtle bg-app-input px-2.5 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                  placeholder="curve25519-sha256,ecdh-sha2-nistp256"
                />
              </label>

              <label className="flex flex-col gap-1 text-txt-secondary">
                Custom MACs (comma-separated, empty = defaults)
                <input
                  value={config.macs ?? ''}
                  onChange={(e) => update('macs', e.target.value)}
                  placeholder="e.g. hmac-sha2-256,hmac-sha1"
                  className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* SSH Port Forwarding / Tunnels */}
      <div className="rounded-lg border border-border-subtle bg-app-surface-subtle">
        <div className="flex w-full items-center justify-between p-2.5 text-xs font-medium text-txt-secondary">
          <button
            type="button"
            onClick={() => setTunnelsOpen((o) => !o)}
            className="flex items-center gap-1.5 hover:text-txt-primary transition-colors"
          >
            <span>Port Forwarding & Tunnels</span>
            <span className="rounded bg-app-surface px-1.5 py-0.5 text-[10px] text-sky-400 font-mono">
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
            className="flex items-center gap-1 rounded-lg border border-border-subtle bg-app-surface px-2.5 py-1 text-xs text-sky-400 hover:bg-app-surface-hover transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Add Tunnel</span>
          </button>
        </div>

        {tunnelsOpen && (
          <div className="border-t border-border-subtle p-3 space-y-2 text-xs">
            {(config.tunnels || []).length === 0 ? (
              <p className="py-2 text-center text-txt-muted">No port tunnels configured</p>
            ) : (
              (config.tunnels || []).map((tunnel) => (
                <div
                  key={tunnel.id}
                  className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-app-surface p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-txt-primary">
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
                        className="rounded border-border-subtle bg-app-input text-sky-600 focus:ring-sky-500"
                      />
                      <span className="font-semibold text-xs">
                        {tunnel.type === 'local'
                          ? 'Local Port Forward (-L)'
                          : tunnel.type === 'remote'
                          ? 'Remote Port Forward (-R)'
                          : 'Dynamic SOCKS Proxy (-D)'}
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
                      className="rounded p-1 text-red-400 hover:bg-app-surface-hover transition-colors"
                      title="Delete tunnel"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-[130px_1fr] gap-2">
                    <label className="flex flex-col gap-1 text-txt-secondary">
                      Type
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
                        className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
                      >
                        <option value="local">Local (-L)</option>
                        <option value="remote">Remote (-R)</option>
                        <option value="dynamic">Dynamic (-D)</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-txt-secondary">
                      Local Port
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
                        placeholder="e.g. 8080 or 1080"
                        className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                      />
                    </label>
                  </div>

                  {tunnel.type !== 'dynamic' && (
                    <div className="grid grid-cols-[1fr_90px] gap-2">
                      <label className="flex flex-col gap-1 text-txt-secondary">
                        Remote Host
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
                          placeholder="127.0.0.1 or db.internal"
                          className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-txt-secondary">
                        Remote Port
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
                          className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500 font-mono"
                        />
                      </label>
                    </div>
                  )}

                  <label className="flex flex-col gap-1 text-txt-secondary">
                    Description (optional)
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
                      placeholder="e.g. Database tunnel or Web UI"
                      className="rounded-lg border border-border-subtle bg-app-input px-2 py-1 text-xs text-txt-primary outline-none focus:border-sky-500"
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
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            testResult.success
              ? 'border border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
              : 'border border-red-800/60 bg-red-950/40 text-red-300'
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

      <div className="mt-2 flex items-center justify-between pt-2 border-t border-border-subtle">
        <button
          type="button"
          disabled={!config.host.trim() || !config.username.trim() || testing}
          onClick={() => void handleTestConnection()}
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-app-surface px-3 py-1.5 text-xs text-txt-primary hover:bg-app-surface-hover disabled:opacity-40 transition-colors"
        >
          {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {testing ? 'Testing...' : 'Test Connection'}
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border-subtle px-3.5 py-1.5 text-xs font-medium text-txt-secondary hover:bg-app-surface-hover hover:text-txt-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid}
            className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40 shadow-sm transition-colors"
          >
            Save Profile
          </button>
        </div>
      </div>
    </form>
  );
};

export default SSHProfileForm;
