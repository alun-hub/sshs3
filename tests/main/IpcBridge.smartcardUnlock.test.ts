import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('electron', () => {
  const mockObj = {
    ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
    app: { getPath: vi.fn().mockReturnValue('/tmp/user-data-unused') },
    // No OS keyring: an "enc:v1:" value cannot be decrypted, exactly the case under test below.
    safeStorage: {
      isEncryptionAvailable: vi.fn().mockReturnValue(false),
      encryptString: vi.fn(),
      decryptString: vi.fn(),
    },
    shell: { openPath: vi.fn().mockResolvedValue('') },
  };
  return { ...mockObj, default: mockObj };
});

const sync = vi.hoisted(() => ({
  getAgentIdentities: vi.fn(),
  signChallengeWithAgent: vi.fn(),
  verifyAgentSignature: vi.fn(),
  deriveSecretFromSignature: vi.fn(),
  getKeyAlgorithm: vi.fn(),
}));
vi.mock('../../src/main/smartcard/SmartcardSyncService', () => ({
  ...sync,
  KEY_DERIVATION_MESSAGE: Buffer.from('mock-key-derivation-message', 'utf-8'),
}));

import { IpcBridge } from '../../src/main/IpcBridge';
import { SmartcardDetector } from '../../src/main/smartcard/SmartcardDetector';
import { AgentLifecycleManager } from '../../src/main/ssh/AgentLifecycleManager';

// Characterization of the error paths and the decisions of IpcBridge.unlockWithSmartcardInternal (which
// card library, which agent, which key on the card, how the sync passwords are obtained). The success
// path is covered end to end in IpcBridge.sync.test.ts. Public methods and injected fakes only.

const LIB = '/usr/lib/opensc-pkcs11.so';
const KEY_A = Buffer.from('key-blob-a');
const KEY_B = Buffer.from('key-blob-b');
const sha256Hex = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const TARGET = { id: 't', name: 'n', type: 's3' as const };

describe('IpcBridge.unlockWithSmartcardInternal', () => {
  let syncConfig: Record<string, any>;
  let settings: Record<string, any>;

  function makeBridge() {
    const syncConfigStore = { getConfig: vi.fn(async () => syncConfig) };
    const settingsStore = { getSettings: vi.fn(async () => settings) };
    const bridge = new IpcBridge({ syncConfigStore: syncConfigStore as any, settingsStore: settingsStore as any });
    const smartcard = bridge.smartcard;
    const spies = {
      getUnlockedCardSocket: vi.spyOn(smartcard, 'getUnlockedCardSocket').mockResolvedValue('/tmp/app-agent.sock'),
      findCachedGlobalAgentHoldingKey: vi.spyOn(smartcard, 'findCachedGlobalAgentHoldingKey').mockResolvedValue(undefined),
      getOrLoadGlobalSmartcardAgent: vi.spyOn(smartcard, 'getOrLoadGlobalSmartcardAgent').mockResolvedValue('/tmp/global.sock'),
      loadPrivate: vi.spyOn(smartcard, 'loadSmartcardIntoPrivateAgentWithPresence').mockResolvedValue({ socketPath: '/tmp/private.sock', pid: 4242 } as any),
      forget: vi.spyOn(smartcard, 'forgetGlobalCardAfterFailure').mockImplementation(() => {}),
      promptForPin: vi.spyOn(bridge, 'promptForPinDirect').mockResolvedValue('typed-pin'),
    };
    return { bridge, spies };
  }

  beforeEach(() => {
    syncConfig = { target: TARGET, smartcardSync: { pkcs11LibPath: LIB } };
    settings = {};
    sync.getAgentIdentities.mockReset().mockResolvedValue([{ keyBlob: KEY_A, comment: 'a' }]);
    sync.signChallengeWithAgent.mockReset().mockResolvedValue(Buffer.from('sig'));
    sync.verifyAgentSignature.mockReset().mockReturnValue(true);
    sync.deriveSecretFromSignature.mockReset().mockReturnValue('derived-secret');
    sync.getKeyAlgorithm.mockReset().mockReturnValue('ssh-ed25519');
    vi.spyOn(AgentLifecycleManager, 'killPrivateAgent').mockImplementation(() => {});
    vi.spyOn(AgentLifecycleManager, 'unloadCard').mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses without a configured sync target', async () => {
    syncConfig = {};
    const { bridge } = makeBridge();
    await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/Configure a sync target first/);
  });

  describe('which PKCS#11 library is used', () => {
    it('prefers the library passed in, over the linked card and the setting', async () => {
      settings = { smartcardLibPath: '/opt/preferred.so' };
      const { bridge, spies } = makeBridge();
      sync.getAgentIdentities.mockResolvedValue([]);

      await expect(bridge.unlockWithSmartcardInternal({ pkcs11LibPath: '/opt/explicit.so' })).rejects.toThrow();

      expect(spies.getUnlockedCardSocket).toHaveBeenCalledWith('/opt/explicit.so');
    });

    it('uses the linked card\'s library when none is passed in', async () => {
      const { bridge, spies } = makeBridge();
      sync.getAgentIdentities.mockResolvedValue([]);
      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();
      expect(spies.getUnlockedCardSocket).toHaveBeenCalledWith(LIB);
    });

    it('falls back to the preferred library from settings when it is valid', async () => {
      syncConfig = { target: TARGET };
      settings = { smartcardLibPath: '/opt/preferred.so' };
      const { bridge, spies } = makeBridge();
      vi.spyOn(SmartcardDetector, 'validateLibraryPath').mockResolvedValue(true as any);
      sync.getAgentIdentities.mockResolvedValue([]);

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();

      expect(spies.getUnlockedCardSocket).toHaveBeenCalledWith('/opt/preferred.so');
    });

    it('ignores an invalid preferred library and takes the first detected one', async () => {
      syncConfig = { target: TARGET };
      settings = { smartcardLibPath: '/opt/stale.so' };
      const { bridge, spies } = makeBridge();
      vi.spyOn(SmartcardDetector, 'validateLibraryPath').mockResolvedValue(false as any);
      vi.spyOn(SmartcardDetector, 'detectAvailableLibraries').mockResolvedValue([{ path: '/opt/detected-1.so' }, { path: '/opt/detected-2.so' }] as any);
      sync.getAgentIdentities.mockResolvedValue([]);

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();

      expect(spies.getUnlockedCardSocket).toHaveBeenCalledWith('/opt/detected-1.so');
    });

    it('fails clearly when no library is configured, preferred or detected', async () => {
      syncConfig = { target: TARGET };
      const { bridge } = makeBridge();
      vi.spyOn(SmartcardDetector, 'detectAvailableLibraries').mockResolvedValue([]);

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/No smartcard libraries detected/);
    });
  });

  describe('which agent holds the card', () => {
    beforeEach(() => {
      sync.getAgentIdentities.mockResolvedValue([]); // stop right after the agent is chosen
    });

    it('reuses the app agent when the card is already unlocked there (no new agent, no PIN prompt)', async () => {
      const { bridge, spies } = makeBridge();
      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();
      expect(sync.getAgentIdentities).toHaveBeenCalledWith('/tmp/app-agent.sock');
      expect(spies.getOrLoadGlobalSmartcardAgent).not.toHaveBeenCalled();
      expect(spies.loadPrivate).not.toHaveBeenCalled();
    });

    it("loads the card into the shared app agent in 'agent-global' mode", async () => {
      settings = { smartcardAuthMode: 'agent-global' };
      const { bridge, spies } = makeBridge();
      spies.getUnlockedCardSocket.mockResolvedValue(undefined);

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();

      expect(spies.getOrLoadGlobalSmartcardAgent).toHaveBeenCalledWith(LIB, expect.any(Function), 'Remote Profile Sync');
      expect(sync.getAgentIdentities).toHaveBeenCalledWith('/tmp/global.sock');
    });

    it.each([[{}], [{ smartcardAuthMode: 'always-prompt' }], [{ smartcardAuthMode: 'agent-per-session' }]])(
      'loads the card into a throw-away private agent for %j',
      async (s) => {
        settings = s;
        const { bridge, spies } = makeBridge();
        spies.getUnlockedCardSocket.mockResolvedValue(undefined);

        await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();

        expect(spies.loadPrivate).toHaveBeenCalledWith(LIB, expect.any(Function), undefined, 'Remote Profile Sync');
        expect(spies.getOrLoadGlobalSmartcardAgent).not.toHaveBeenCalled();
      }
    );
  });

  describe('PIN handling', () => {
    async function pinHandlerOf(options: { pin?: string }) {
      settings = { smartcardAuthMode: 'agent-global' };
      const { bridge, spies } = makeBridge();
      spies.getUnlockedCardSocket.mockResolvedValue(undefined);
      sync.getAgentIdentities.mockResolvedValue([]);
      await expect(bridge.unlockWithSmartcardInternal(options)).rejects.toThrow();
      return { handler: spies.getOrLoadGlobalSmartcardAgent.mock.calls[0][1] as (p: string, retry?: any) => Promise<string>, spies };
    }

    it('uses a PIN handed in by the caller for the first attempt, without prompting', async () => {
      const { handler, spies } = await pinHandlerOf({ pin: '123456' });
      expect(await handler('Enter PIN')).toBe('123456');
      expect(spies.promptForPin).not.toHaveBeenCalled();
    });

    it('never replays that PIN on a retry after a wrong PIN: it asks the user again', async () => {
      const { handler, spies } = await pinHandlerOf({ pin: '123456' });
      const retry = { error: 'wrong PIN', attempt: 2, maxAttempts: 3 };

      expect(await handler('Enter PIN', retry)).toBe('typed-pin');
      expect(spies.promptForPin).toHaveBeenCalledWith('Enter your smartcard PIN to unlock Remote Profile Sync:', 'smartcard', undefined, retry);
    });

    it('prompts through the in-app PIN dialog when no PIN was handed in', async () => {
      const { handler, spies } = await pinHandlerOf({});
      expect(await handler('Enter PIN')).toBe('typed-pin');
      expect(spies.promptForPin).toHaveBeenCalledTimes(1);
    });
  });

  describe('which key on the card is used', () => {
    beforeEach(() => {
      sync.getAgentIdentities.mockResolvedValue([
        { keyBlob: KEY_A, comment: 'a' },
        { keyBlob: KEY_B, comment: 'b' },
      ]);
      sync.verifyAgentSignature.mockReturnValue(false); // stop after the challenge, before any unlock
    });
    const signedBlob = () => sync.signChallengeWithAgent.mock.calls[0][1] as Buffer;

    it('takes the first key when the link does not pin one', async () => {
      const { bridge } = makeBridge();
      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/Failed to verify cryptographic signature/);
      expect(signedBlob()).toEqual(KEY_A);
    });

    it('takes the key whose blob was linked', async () => {
      syncConfig = { target: TARGET, smartcardSync: { pkcs11LibPath: LIB, keyBlobBase64: KEY_B.toString('base64') } };
      const { bridge } = makeBridge();
      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();
      expect(signedBlob()).toEqual(KEY_B);
    });

    it('takes the key whose fingerprint was linked', async () => {
      syncConfig = { target: TARGET, smartcardSync: { pkcs11LibPath: LIB, keyFingerprint: sha256Hex(KEY_B) } };
      const { bridge } = makeBridge();
      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();
      expect(signedBlob()).toEqual(KEY_B);
    });

    it('falls back to the first key when the linked key is not on the card', async () => {
      syncConfig = { target: TARGET, smartcardSync: { pkcs11LibPath: LIB, keyBlobBase64: Buffer.from('other').toString('base64') } };
      const { bridge } = makeBridge();
      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();
      expect(signedBlob()).toEqual(KEY_A);
    });
  });

  describe('failures', () => {
    it('fails when the card holds no identities, and drops the card from the app agent', async () => {
      sync.getAgentIdentities.mockResolvedValue([]);
      const { bridge, spies } = makeBridge();

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/No smartcard identities\/certificates found on the card/);

      expect(spies.forget).toHaveBeenCalledWith(LIB, undefined);
    });

    it('fails when the card\'s signature does not verify', async () => {
      sync.verifyAgentSignature.mockReturnValue(false);
      const { bridge, spies } = makeBridge();

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/Failed to verify cryptographic signature from smartcard/);

      expect(spies.forget).toHaveBeenCalledWith(LIB, undefined);
    });

    it('fails clearly when the saved sync passwords cannot be decrypted with the OS keyring', async () => {
      syncConfig = { target: TARGET, smartcardSync: { pkcs11LibPath: LIB, wrappedPasswordsEncrypted: 'enc:v1:AAAA' } }; // pragma: allowlist secret
      const { bridge } = makeBridge();

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow('Failed to decrypt saved sync passwords with OS keyring.');
    });

    it('tells the user to re-link a card that was linked by an older, incompatible version', async () => {
      syncConfig = { target: TARGET, smartcardSync: { pkcs11LibPath: LIB, wrappedPassword: 'legacy' } }; // pragma: allowlist secret
      const { bridge } = makeBridge();

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/older, incompatible version of sshs3/);
      expect(sync.deriveSecretFromSignature).not.toHaveBeenCalled();
    });

    it('refuses to derive the sync secret from an ECDSA key (its signature is not reproducible)', async () => {
      sync.getKeyAlgorithm.mockReturnValue('ecdsa-sha2-nistp256');
      const { bridge } = makeBridge();

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/ECDSA key cannot derive a stable one/);
      expect(sync.deriveSecretFromSignature).not.toHaveBeenCalled();
    });

    it('does not apply the ECDSA refusal when saved passwords exist (they are not derived from the signature)', async () => {
      sync.getKeyAlgorithm.mockReturnValue('ecdsa-sha2-nistp256');
      syncConfig = { target: TARGET, smartcardSync: { pkcs11LibPath: LIB, wrappedPassword: 'legacy' } }; // pragma: allowlist secret
      const { bridge } = makeBridge();

      // Reaches the legacy-format refusal instead: the ECDSA guard sits only in the "nothing saved" branch.
      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow(/older, incompatible version/);
    });

    it('always unloads the card and kills the private agent it started, success or failure', async () => {
      sync.getAgentIdentities.mockResolvedValue([]);
      const { bridge, spies } = makeBridge();
      spies.getUnlockedCardSocket.mockResolvedValue(undefined);

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();

      expect(AgentLifecycleManager.unloadCard).toHaveBeenCalledWith('/tmp/private.sock', LIB);
      expect(AgentLifecycleManager.killPrivateAgent).toHaveBeenCalledWith(4242);
      // A private agent is gone with it: the shared app agent's card cache is left alone.
      expect(spies.forget).toHaveBeenCalledWith(LIB, 4242);
    });

    it('leaves the shared app agent running when the card came from it', async () => {
      sync.getAgentIdentities.mockResolvedValue([]);
      const { bridge } = makeBridge();

      await expect(bridge.unlockWithSmartcardInternal()).rejects.toThrow();

      expect(AgentLifecycleManager.killPrivateAgent).not.toHaveBeenCalled();
      expect(AgentLifecycleManager.unloadCard).not.toHaveBeenCalled();
    });
  });
});
