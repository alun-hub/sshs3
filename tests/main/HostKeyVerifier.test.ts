import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { KnownHostsStore } from '../../src/main/ssh/KnownHostsStore';
import { createHostVerifier } from '../../src/main/ssh/HostKeyVerifier';

function fakeKeyBuffer(algo: string, payload: string): Buffer {
  const algoBuf = Buffer.from(algo, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(algoBuf.length, 0);
  return Buffer.concat([lenBuf, algoBuf, Buffer.from(payload, 'utf8')]);
}

/** Wraps ssh2's callback-style hostVerifier(key, verify) in a Promise for easy await in tests. */
function runVerifier(
  verifier: (key: Buffer, verify: (ok: boolean) => void) => void,
  key: Buffer
): Promise<boolean> {
  return new Promise((resolve) => {
    verifier(key, resolve);
  });
}

describe('createHostVerifier', () => {
  let tempDir: string;
  let filePath: string;
  let knownHosts: KnownHostsStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-hostverifier-'));
    filePath = path.join(tempDir, 'known_hosts');
    knownHosts = new KnownHostsStore(filePath);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('auto-accepts a matching known key without prompting', async () => {
    const key = fakeKeyBuffer('ssh-ed25519', 'trusted-key');
    await knownHosts.addHostKey('h.example.com', 22, key);

    const onUnknownOrChanged = vi.fn();
    const verifier = createHostVerifier({
      host: 'h.example.com',
      port: 22,
      knownHosts,
      onUnknownOrChanged,
    });

    const result = await runVerifier(verifier, key);
    expect(result).toBe(true);
    expect(onUnknownOrChanged).not.toHaveBeenCalled();
  });

  it('prompts for an unknown host and persists the key when trusted', async () => {
    const key = fakeKeyBuffer('ssh-ed25519', 'new-key');
    const onUnknownOrChanged = vi.fn().mockResolvedValue(true);
    const verifier = createHostVerifier({
      host: 'new.example.com',
      port: 22,
      knownHosts,
      onUnknownOrChanged,
    });

    const result = await runVerifier(verifier, key);
    expect(result).toBe(true);
    expect(onUnknownOrChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'new.example.com',
        port: 22,
        keyType: 'ssh-ed25519',
        status: 'unknown',
      })
    );

    // Persisted: a subsequent check should now auto-match without prompting.
    const secondPrompt = vi.fn();
    const verifier2 = createHostVerifier({
      host: 'new.example.com',
      port: 22,
      knownHosts,
      onUnknownOrChanged: secondPrompt,
    });
    const secondResult = await runVerifier(verifier2, key);
    expect(secondResult).toBe(true);
    expect(secondPrompt).not.toHaveBeenCalled();
  });

  it('prompts for an unknown host and rejects without persisting when the user declines', async () => {
    const key = fakeKeyBuffer('ssh-ed25519', 'declined-key');
    const onUnknownOrChanged = vi.fn().mockResolvedValue(false);
    const verifier = createHostVerifier({
      host: 'declined.example.com',
      port: 22,
      knownHosts,
      onUnknownOrChanged,
    });

    const result = await runVerifier(verifier, key);
    expect(result).toBe(false);

    const check = await knownHosts.checkHost('declined.example.com', 22, key);
    expect(check).toBe('unknown');
  });

  it('prompts with status "mismatch" when the presented key differs from the trusted one', async () => {
    const originalKey = fakeKeyBuffer('ssh-ed25519', 'original-key');
    await knownHosts.addHostKey('changed.example.com', 22, originalKey);

    const rotatedKey = fakeKeyBuffer('ssh-ed25519', 'rotated-key');
    const onUnknownOrChanged = vi.fn().mockResolvedValue(false);
    const verifier = createHostVerifier({
      host: 'changed.example.com',
      port: 22,
      knownHosts,
      onUnknownOrChanged,
    });

    const result = await runVerifier(verifier, rotatedKey);
    expect(result).toBe(false);
    expect(onUnknownOrChanged).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'mismatch' })
    );
  });

  it('fails closed (rejects) if the prompt callback throws', async () => {
    const key = fakeKeyBuffer('ssh-ed25519', 'broken-prompt-key');
    const verifier = createHostVerifier({
      host: 'broken.example.com',
      port: 22,
      knownHosts,
      onUnknownOrChanged: async () => {
        throw new Error('renderer crashed');
      },
    });

    const result = await runVerifier(verifier, key);
    expect(result).toBe(false);
  });
});
