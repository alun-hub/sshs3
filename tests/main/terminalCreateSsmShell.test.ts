import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/main/x11/XServerManager', () => ({ XServerManager: { ensureRunning: vi.fn(async () => {}) } }));

import { registerTerminalHandlers, type TerminalHost } from '../../src/main/ipc/terminalHandlers';
import { XServerManager } from '../../src/main/x11/XServerManager';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

/**
 * A Session Manager shell runs `aws ssm start-session`, never ssh. The terminal handler used to run the smartcard, FIDO2
 * and SSH CA preparation (PIN or touch prompts, a key file that waits for its YubiKey) and the dotfiles check for it too,
 * which mattered for a profile that was switched to a shell and still carries its old authType.
 */
describe('TERMINAL_CREATE: Session Manager shell vs SSH profiles', () => {
  const handlers = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  const prepareSmartcardConfig = vi.fn(async (c: SSHConnectionConfig) => c);
  const prepareFido2Config = vi.fn(async (c: SSHConnectionConfig) => c);
  const prepareSshCaConfig = vi.fn(async (c: SSHConnectionConfig) => c);
  const createSession = vi.fn(async () => ({ sessionId: 's1' }));
  const runDotfilesSyncCheck = vi.fn(async () => {});

  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    for (const f of [prepareSmartcardConfig, prepareFido2Config, prepareSshCaConfig, createSession, runDotfilesSyncCheck]) f.mockClear();
    vi.mocked(XServerManager.ensureRunning).mockClear();
    registerTerminalHandlers({
      registerHandler: (c: string, h: (...a: unknown[]) => Promise<unknown>) => { handlers.set(c, h); },
      assignSession: vi.fn(),
      awsSsoAuthService: { getTokenStatus: async () => 'valid' },
      policy: { policy: { features: {}, settings: {}, managed: [], warnings: [] } },
      resolveProxyJumpConfig: async (c: SSHConnectionConfig) => c,
      restoreSavedSecrets: async (c: SSHConnectionConfig) => c,
      teamVaultService: {},
      settingsStore: { getSettings: async () => ({ x11ServerMode: 'auto' }) },
      sshPtyManager: { createSession },
      runDotfilesSyncCheck,
      smartcard: { awaitStartupUnlock: async () => {}, prepareSmartcardConfig, prepareFido2Config, prepareSshCaConfig },
    } as unknown as TerminalHost);
  });

  const create = (config: Partial<SSHConnectionConfig>) =>
    handlers.get(IPC_CHANNELS.TERMINAL_CREATE)!({ sender: {} }, { config: { id: 'p1', name: 'x', host: 'i-0123456789abcdef0', port: 22, username: '', ...config }, ptyOptions: { cols: 80, rows: 24 } });

  const staleSshSettings = { authType: 'smartcard' as const, pkcs11LibPath: '/usr/lib/opensc-pkcs11.so', useSshCa: true, poolId: 'pool', dotfilesSyncPolicy: 'always' as const };

  it('does no smartcard, FIDO2 or SSH CA preparation and no dotfiles check for a shell profile that still carries SSH settings', async () => {
    await create({ ...staleSshSettings, ssm: { enabled: true, mode: 'shell', region: 'eu-north-1' } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(prepareSmartcardConfig).not.toHaveBeenCalled();
    expect(prepareFido2Config).not.toHaveBeenCalled();
    expect(prepareSshCaConfig).not.toHaveBeenCalled();
    expect(runDotfilesSyncCheck).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1); // the session itself is still created
  });

  it('does not start an X server for a shell profile that still has X11 forwarding on', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await create({ x11Forwarding: true, ssm: { enabled: true, mode: 'shell', region: 'eu-north-1' } });
      expect(XServerManager.ensureRunning).not.toHaveBeenCalled();
      await create({ x11Forwarding: true, authType: 'agent' });
      expect(XServerManager.ensureRunning).toHaveBeenCalledTimes(1); // an SSH profile still gets it
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('still prepares an ordinary SSH profile and a profile that uses SSH over SSM', async () => {
    await create({ ...staleSshSettings, host: 'ssh.example.com' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(prepareSmartcardConfig).toHaveBeenCalledTimes(1);
    expect(prepareFido2Config).toHaveBeenCalledTimes(1);
    expect(prepareSshCaConfig).toHaveBeenCalledTimes(1);
    expect(runDotfilesSyncCheck).toHaveBeenCalledTimes(1);

    prepareSmartcardConfig.mockClear();
    await create({ authType: 'smartcard', pkcs11LibPath: '/usr/lib/opensc-pkcs11.so', ssm: { enabled: true, region: 'eu-north-1' } }); // SSH over SSM
    expect(prepareSmartcardConfig).toHaveBeenCalledTimes(1);
  });
});
