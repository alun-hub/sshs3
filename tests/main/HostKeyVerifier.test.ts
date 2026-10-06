import { describe, it, expect, vi } from 'vitest';
import { createHostVerifier, type HostKeyPromptInfo } from '../../src/main/ssh/HostKeyVerifier';

const info: HostKeyPromptInfo = {
  host: 'h.example.com',
  port: 22,
  keyType: 'ssh-ed25519',
  fingerprint: 'SHA256:abc',
  status: 'unknown',
};

describe('createHostVerifier', () => {
  it('exposes the target host and port', () => {
    const verifier = createHostVerifier({ host: 'h.example.com', port: 2222, onUnknownOrChanged: async () => true });
    expect(verifier).toMatchObject({ host: 'h.example.com', port: 2222 });
  });

  it('hostKeyPrompt resolves to the user decision', async () => {
    const onUnknownOrChanged = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const verifier = createHostVerifier({ host: 'h.example.com', port: 22, onUnknownOrChanged });

    expect(await verifier.hostKeyPrompt(info)).toBe(true);
    expect(await verifier.hostKeyPrompt({ ...info, status: 'mismatch' })).toBe(false);
    expect(onUnknownOrChanged).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'mismatch' }));
  });
});
