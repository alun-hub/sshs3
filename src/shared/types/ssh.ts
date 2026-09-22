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
  pin?: string;
  agentPath?: string;
  extraOptions?: Record<string, string>;
  initialPath?: string;
  proxy?: ProxyConfig;
  group?: string;
  lastUsedAt?: string;
  /** ISO 8601 timestamp of the last edit. Used by remote profile sync to resolve conflicts. */
  updatedAt?: string;
  /** ISO 8601 timestamp set instead of removing the entry outright, so sync can propagate the deletion. */
  deletedAt?: string;
  /** Whether to forward the local ssh-agent to the remote host (-A / ForwardAgent yes). */
  forwardAgent?: boolean;
  /** Whether to enable X11 forwarding (-Y / ForwardX11Trusted yes). */
  x11Forwarding?: boolean;
  /** Custom local X11 display (default: '127.0.0.1:0.0' on Windows, process.env.DISPLAY or ':0' on Linux/macOS). */
  x11Display?: string;
  compression?: boolean;
  serverAliveInterval?: number;
  ciphers?: string;
  kexAlgorithms?: string;
  macs?: string;
  proxyJump?: string;
  tunnels?: SSHTunnelConfig[];
  /** Dotfiles pool to sync on connect. Unset = feature not opted into for this host. */
  poolId?: string;
  /** Unset = never sync, even if a pool is assigned. 'ask' prompts on diff, 'always' syncs silently. */
  dotfilesSyncPolicy?: 'ask' | 'always';
  /** Whether to automatically attempt reconnection when the SSH session drops unexpectedly. */
  autoReconnect?: boolean;
  /** Maximum number of auto-reconnection attempts (default: 3). */
  maxReconnectAttempts?: number;
  /** Initial delay in ms before reconnection attempts (default: 2000ms). */
  reconnectDelayMs?: number;
}

export interface DetectedSmartcardLib {
  name: string; // ('Net iD', 'OpenSC', etc.)
  path: string;
  platform: 'linux' | 'win32';
  exists: boolean;
}

/** One identity (certificate/key) an app-managed smartcard agent currently holds. */
export interface CachedSmartcardIdentity {
  comment: string; // e.g. "PIV AUTH pubkey" — the certificate's label
  fingerprint: string;
  keyType: string;
  /**
   * X.509 certificate details for this identity, read directly from the PKCS#11 token and
   * matched to it by fingerprint. Undefined if the token doesn't expose a readable certificate
   * for this key, or reading/parsing it failed — the identity itself is still valid either way.
   */
  certificate?: {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    upn?: string;
  };
}

/** One cached global smartcard agent ('agent-global' PIN caching mode), and what it holds. */
export interface CachedSmartcardAgent {
  pkcs11LibPath: string;
  identities: CachedSmartcardIdentity[];
}

/** Local shell to spawn on Windows. Ignored on macOS/Linux, which always use the user's $SHELL. */
export type LocalShellType = 'default' | 'cmd' | 'powershell' | 'pwsh' | 'wsl';

export interface PtyOptions {
  cols?: number; // default 80
  rows?: number; // default 24
  cwd?: string;
  env?: Record<string, string>;
  /** Windows only: which shell to spawn for a local terminal. */
  shellType?: LocalShellType;
  /** Windows only: specific WSL distribution to launch (wsl.exe -d <distro>). */
  wslDistro?: string;
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
  /** Returns the buffered recent scrollback terminal output. */
  getScrollbackBuffer?(): string;
  /** Whether the session is currently attempting to reconnect. */
  isReconnecting?(): boolean;
  /** Attempts to manually re-establish the underlying SSH connection. */
  reconnect?(): Promise<boolean>;
}

export interface XServerStatus {
  available: boolean;
  executablePath?: string;
  running: boolean;
  managedByApp: boolean;
  pid?: number;
  display: string;
  platform?: string;
}
