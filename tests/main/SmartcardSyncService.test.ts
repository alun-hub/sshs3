import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyAgentSignature } from '../../src/main/smartcard/SmartcardSyncService';

function sshString(value: Buffer | string): Buffer {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf-8') : value;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function buildEd25519KeyBlob(pub: Buffer): Buffer {
  return Buffer.concat([sshString('ssh-ed25519'), sshString(pub)]);
}

function buildEd25519SigBlob(sig: Buffer): Buffer {
  return Buffer.concat([sshString('ssh-ed25519'), sshString(sig)]);
}

describe('verifyAgentSignature', () => {
  it('verifies a real ssh-ed25519 signature over the given challenge', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubRaw = publicKey.export({ format: 'jwk' }).x as string;
    const pub = Buffer.from(pubRaw, 'base64url');
    const challenge = crypto.randomBytes(32);
    const sig = crypto.sign(null, challenge, privateKey);

    const keyBlob = buildEd25519KeyBlob(pub);
    const sigBlob = buildEd25519SigBlob(sig);

    expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(true);
  });

  it('rejects an ssh-ed25519 signature produced over a different challenge', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const pubRaw = publicKey.export({ format: 'jwk' }).x as string;
    const pub = Buffer.from(pubRaw, 'base64url');
    const challenge = crypto.randomBytes(32);
    const wrongChallenge = crypto.randomBytes(32);
    const sig = crypto.sign(null, wrongChallenge, privateKey);

    const keyBlob = buildEd25519KeyBlob(pub);
    const sigBlob = buildEd25519SigBlob(sig);

    expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(false);
  });

  // Regression test for the C1 finding (UX/security review): an unrecognized
  // key algorithm string (malformed, or a real-but-unimplemented one like
  // sk-ssh-ed25519@openssh.com) used to fall through to `return true` —
  // accepting attacker-controlled bytes as a "verified" signature without
  // checking anything. It must fail closed instead.
  it('fails closed (returns false) for an unrecognized/unsupported key algorithm', () => {
    const challenge = crypto.randomBytes(32);
    const attackerControlledSig = crypto.randomBytes(64);

    const keyBlob = Buffer.concat([sshString('sk-ssh-ed25519@openssh.com'), sshString(Buffer.from('anything'))]);
    const sigBlob = Buffer.concat([sshString('sk-ssh-ed25519@openssh.com'), sshString(attackerControlledSig)]);

    expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(false);
  });

  it('fails closed for a completely bogus/malformed key algorithm string', () => {
    const challenge = crypto.randomBytes(32);
    const keyBlob = sshString('not-a-real-algorithm');
    const sigBlob = Buffer.concat([sshString('not-a-real-algorithm'), sshString(Buffer.from([1, 2, 3]))]);

    expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(false);
  });
});
