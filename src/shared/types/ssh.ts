import type { ProxyConfig } from './storage';

export type SSHAuthType = 'password' | 'privateKey' | 'smartcard' | 'agent';

export type SSHTunnelType = 'local' | 'remote' | 'dynamic';

export interface SSHTunnelConfig {
  id: string;
  type: SSHTunnelType;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
  description?: string;
  enabled?: boolean;
}

export interface SSHConnectionConfig {
  id: string;
  name: string;
  host: string;
  port?: number; // default 22
  username: string;
  authType: SSHAuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  pkcs11LibPath?: string; // path to .so or .dll
  agentPath?: string;
  extraOptions?: Record<string, string>;
  initialPath?: string;
  proxy?: ProxyConfig;
  group?: string;
  lastUsedAt?: string;
  compression?: boolean;
  serverAliveInterval?: number;
  ciphers?: string;
  kexAlgorithms?: string;
  macs?: string;
  proxyJump?: string;
  tunnels?: SSHTunnelConfig[];
}

export interface DetectedSmartcardLib {
  name: string; // ('Net iD', 'OpenSC', etc.)
  path: string;
  platform: 'linux' | 'win32';
  exists: boolean;
}

/** Local shell to spawn on Windows. Ignored on macOS/Linux, which always use the user's $SHELL. */
export type LocalShellType = 'default' | 'cmd' | 'powershell' | 'pwsh';

export interface PtyOptions {
  cols?: number; // default 80
  rows?: number; // default 24
  cwd?: string;
  env?: Record<string, string>;
  /** Windows only: which shell to spawn for a local terminal. */
  shellType?: LocalShellType;
}

export interface SSHPtyExitEvent {
  exitCode: number;
  signal?: number;
}

export interface SSHPtySession {
  sessionId: string;
  config: SSHConnectionConfig;
  pid: number;
  cols: number;
  rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose: () => void };
  onExit(listener: (event: SSHPtyExitEvent) => void): { dispose: () => void };
  dispose(): Promise<void>;
}
