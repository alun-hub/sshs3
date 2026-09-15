export type SSHAuthType = 'password' | 'privateKey' | 'smartcard' | 'agent';

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
}

export interface DetectedSmartcardLib {
  name: string; // ('Net iD', 'OpenSC', etc.)
  path: string;
  platform: 'linux' | 'win32';
  exists: boolean;
}

export interface PtyOptions {
  cols?: number; // default 80
  rows?: number; // default 24
  cwd?: string;
  env?: Record<string, string>;
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
