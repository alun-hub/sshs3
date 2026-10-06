import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  verifyAgentSignature,
  getKeyAlgorithm,
  deriveSecretFromSignature,
  KEY_DERIVATION_MESSAGE,
  sendAgentMessage,
  getAgentIdentities,
  signChallengeWithAgent,
} from '../../src/main/smartcard/SmartcardSyncService';

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

function buildRsaKeyBlob(n: Buffer, e: Buffer): Buffer {
  return Buffer.concat([sshString('ssh-rsa'), sshString(e), sshString(n)]);
}

function buildRsaSigBlob(sigAlgo: string, sig: Buffer): Buffer {
  return Buffer.concat([sshString(sigAlgo), sshString(sig)]);
}

function buildEcdsaKeyBlob(curve: string, q: Buffer): Buffer {
  return Buffer.concat([sshString(`ecdsa-sha2-${curve}`), sshString(curve), sshString(q)]);
}

function buildEcdsaSigBlob(curve: string, r: Buffer, s: Buffer): Buffer {
  const rsBlob = Buffer.concat([sshString(r), sshString(s)]);
  return Buffer.concat([sshString(`ecdsa-sha2-${curve}`), sshString(rsBlob)]);
}

describe('getKeyAlgorithm', () => {
  it('identifies key algorithms correctly', () => {
    expect(getKeyAlgorithm(sshString('ssh-ed25519'))).toBe('ssh-ed25519');
    expect(getKeyAlgorithm(sshString('ssh-rsa'))).toBe('ssh-rsa');
    expect(getKeyAlgorithm(sshString('ecdsa-sha2-nistp256'))).toBe('ecdsa-sha2-nistp256');
  });

  it('returns unknown for truncated or invalid key blobs', () => {
    expect(getKeyAlgorithm(Buffer.alloc(0))).toBe('unknown');
    expect(getKeyAlgorithm(Buffer.from([0, 0]))).toBe('unknown');
  });
});

describe('deriveSecretFromSignature and KEY_DERIVATION_MESSAGE', () => {
  it('derives a consistent hex secret from a signature blob', () => {
    const sig = Buffer.from('test-signature-bytes');
    const secret1 = deriveSecretFromSignature(sig);
    const secret2 = deriveSecretFromSignature(sig);

    expect(secret1).toBe(secret2);
    expect(secret1).toHaveLength(64); // sha256 hex length
    expect(secret1).toBe(crypto.createHash('sha256').update(sig).digest('hex'));
  });

  it('provides a fixed KEY_DERIVATION_MESSAGE', () => {
    expect(KEY_DERIVATION_MESSAGE.toString('utf-8')).toBe('sshs3-sync-stable-key-derivation-v1');
  });
});

describe('verifyAgentSignature', () => {
  describe('ssh-ed25519', () => {
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
  });

  describe('ssh-rsa', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const n = Buffer.from(jwk.n as string, 'base64url');
    const e = Buffer.from(jwk.e as string, 'base64url');
    const keyBlob = buildRsaKeyBlob(n, e);
    const challenge = crypto.randomBytes(32);

    it('verifies RSA with rsa-sha2-256', () => {
      const sig = crypto.sign('sha256', challenge, privateKey);
      const sigBlob = buildRsaSigBlob('rsa-sha2-256', sig);
      expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(true);
    });

    it('verifies RSA with rsa-sha2-512', () => {
      const sig = crypto.sign('sha512', challenge, privateKey);
      const sigBlob = buildRsaSigBlob('rsa-sha2-512', sig);
      expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(true);
    });

    it('verifies RSA with legacy ssh-rsa (sha1) if supported by OpenSSL', () => {
      try {
        const sig = crypto.sign('sha1', challenge, privateKey);
        const sigBlob = buildRsaSigBlob('ssh-rsa', sig);
        expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(true);
      } catch (err: any) {
        if (err?.message?.includes('invalid digest')) {
          // OpenSSL 3 default security level blocks SHA-1 signing
          return;
        }
        throw err;
      }
    });

    it('rejects an RSA signature with altered challenge', () => {
      const sig = crypto.sign('sha256', challenge, privateKey);
      const sigBlob = buildRsaSigBlob('rsa-sha2-256', sig);
      const wrongChallenge = crypto.randomBytes(32);
      expect(verifyAgentSignature(keyBlob, wrongChallenge, sigBlob)).toBe(false);
    });
  });

  describe('ecdsa-sha2-*', () => {
    function parseDerSignature(der: Buffer): { r: Buffer; s: Buffer } {
      let offset = 1; // skip 0x30
      if (der[offset] & 0x80) {
        const numLenBytes = der[offset] & 0x7f;
        offset += 1 + numLenBytes;
      } else {
        offset += 1;
      }
      offset += 1; // skip 0x02
      let rLen = der[offset++];
      if (rLen & 0x80) {
        const numBytes = rLen & 0x7f;
        rLen = der.readUIntBE(offset, numBytes);
        offset += numBytes;
      }
      const r = der.subarray(offset, offset + rLen);
      offset += rLen;
      offset += 1; // skip 0x02
      let sLen = der[offset++];
      if (sLen & 0x80) {
        const numBytes = sLen & 0x7f;
        sLen = der.readUIntBE(offset, numBytes);
        offset += numBytes;
      }
      const s = der.subarray(offset, offset + sLen);
      return { r, s };
    }

    it('verifies ECDSA NIST P-256 (nistp256)', () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = publicKey.export({ format: 'jwk' });
      const x = Buffer.from(jwk.x as string, 'base64url');
      const y = Buffer.from(jwk.y as string, 'base64url');
      const q = Buffer.concat([Buffer.from([0x04]), x, y]);
      const keyBlob = buildEcdsaKeyBlob('nistp256', q);

      const challenge = crypto.randomBytes(32);
      const derSig = crypto.sign('sha256', challenge, privateKey);
      const { r, s } = parseDerSignature(derSig);
      const sigBlob = buildEcdsaSigBlob('nistp256', r, s);

      expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(true);
    });

    it('verifies ECDSA NIST P-384 (nistp384)', () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
      const jwk = publicKey.export({ format: 'jwk' });
      const x = Buffer.from(jwk.x as string, 'base64url');
      const y = Buffer.from(jwk.y as string, 'base64url');
      const q = Buffer.concat([Buffer.from([0x04]), x, y]);
      const keyBlob = buildEcdsaKeyBlob('nistp384', q);

      const challenge = crypto.randomBytes(32);
      const derSig = crypto.sign('sha384', challenge, privateKey);
      const { r, s } = parseDerSignature(derSig);
      const sigBlob = buildEcdsaSigBlob('nistp384', r, s);

      expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(true);
    });

    it('verifies ECDSA NIST P-521 (nistp521)', () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp521r1' });
      const jwk = publicKey.export({ format: 'jwk' });
      const x = Buffer.from(jwk.x as string, 'base64url');
      const y = Buffer.from(jwk.y as string, 'base64url');
      const q = Buffer.concat([Buffer.from([0x04]), x, y]);
      const keyBlob = buildEcdsaKeyBlob('nistp521', q);

      const challenge = crypto.randomBytes(32);
      const derSig = crypto.sign('sha512', challenge, privateKey);
      const { r, s } = parseDerSignature(derSig);
      const sigBlob = buildEcdsaSigBlob('nistp521', r, s);

      expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(true);
    });

    it('rejects ECDSA signature when challenge does not match', () => {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = publicKey.export({ format: 'jwk' });
      const x = Buffer.from(jwk.x as string, 'base64url');
      const y = Buffer.from(jwk.y as string, 'base64url');
      const q = Buffer.concat([Buffer.from([0x04]), x, y]);
      const keyBlob = buildEcdsaKeyBlob('nistp256', q);

      const challenge = crypto.randomBytes(32);
      const wrongChallenge = crypto.randomBytes(32);
      const derSig = crypto.sign('sha256', wrongChallenge, privateKey);
      const { r, s } = parseDerSignature(derSig);
      const sigBlob = buildEcdsaSigBlob('nistp256', r, s);

      expect(verifyAgentSignature(keyBlob, challenge, sigBlob)).toBe(false);
    });
  });

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

// These tests talk to a unix-domain socket in the temp dir; Windows agents use named pipes instead.
describe.skipIf(process.platform === 'win32')('sendAgentMessage, getAgentIdentities, signChallengeWithAgent', () => {
  function getTmpSocketPath(): string {
    return path.join(os.tmpdir(), `test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  }

  function encodeAgentResponse(payload: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(payload.length, 0);
    return Buffer.concat([len, payload]);
  }

  it('sends and receives messages over the agent socket wire protocol', async () => {
    const sockPath = getTmpSocketPath();
    const server = net.createServer((sock) => {
      sock.on('data', (d) => {
        expect(d.readUInt32BE(0)).toBe(5); // length
        expect(d.subarray(4).toString('utf-8')).toBe('HELLO');
        // reply in two chunks to test chunk reassembly
        const resp = encodeAgentResponse(Buffer.from('WORLD_PONG'));
        sock.write(resp.subarray(0, 4));
        setTimeout(() => {
          sock.write(resp.subarray(4));
        }, 10);
      });
    });

    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    const response = await sendAgentMessage(sockPath, Buffer.from('HELLO'));
    expect(response.toString('utf-8')).toBe('WORLD_PONG');

    server.close();
  });

  it('times out when agent does not respond', async () => {
    const sockPath = getTmpSocketPath();
    const server = net.createServer(() => {
      // Do nothing, hang
    });

    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    await expect(sendAgentMessage(sockPath, Buffer.from('PING'), 50)).rejects.toThrow(
      'Timed out communicating with ssh-agent'
    );

    server.close();
  });

  it('rejects when socket encounters a connection error', async () => {
    const sockPath = getTmpSocketPath();
    await expect(sendAgentMessage(sockPath, Buffer.from('PING'), 100)).rejects.toThrow();
  });

  it('retrieves agent identities via getAgentIdentities', async () => {
    const sockPath = getTmpSocketPath();
    const key1 = Buffer.from('key-blob-1');
    const key2 = Buffer.from('key-blob-2');
    const comment1 = 'id_rsa_key';
    const comment2 = 'smartcard_key';

    const server = net.createServer((sock) => {
      sock.on('data', (d) => {
        expect(d[4]).toBe(11); // SSH2_AGENTC_REQUEST_IDENTITIES = 11

        // Build response: 12 (SSH2_AGENT_IDENTITIES_ANSWER), uint32 numKeys=2, [keyLen, key, commentLen, comment]...
        const header = Buffer.alloc(5);
        header[0] = 12;
        header.writeUInt32BE(2, 1);

        const payload = Buffer.concat([
          header,
          sshString(key1),
          sshString(comment1),
          sshString(key2),
          sshString(comment2),
        ]);

        sock.write(encodeAgentResponse(payload));
      });
    });

    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    const identities = await getAgentIdentities(sockPath);
    expect(identities).toHaveLength(2);
    expect(identities[0].keyBlob).toEqual(key1);
    expect(identities[0].comment).toBe(comment1);
    expect(identities[1].keyBlob).toEqual(key2);
    expect(identities[1].comment).toBe(comment2);

    server.close();
  });

  it('returns empty array when agent returns failure response code for identities', async () => {
    const sockPath = getTmpSocketPath();
    const server = net.createServer((sock) => {
      sock.on('data', () => {
        sock.write(encodeAgentResponse(Buffer.from([5]))); // SSH_AGENT_FAILURE = 5
      });
    });

    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    const identities = await getAgentIdentities(sockPath);
    expect(identities).toEqual([]);

    server.close();
  });

  it('signs challenge with agent via signChallengeWithAgent', async () => {
    const sockPath = getTmpSocketPath();
    const mockSig = Buffer.from('agent-generated-sig-1234');

    const server = net.createServer((sock) => {
      sock.on('data', (d) => {
        expect(d[4]).toBe(13); // SSH2_AGENTC_SIGN_REQUEST = 13

        // Build response: byte 14 (SSH2_AGENT_SIGN_RESPONSE), uint32 sigLen, sig
        const header = Buffer.alloc(5);
        header[0] = 14;
        header.writeUInt32BE(mockSig.length, 1);

        sock.write(encodeAgentResponse(Buffer.concat([header, mockSig])));
      });
    });

    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    const keyBlob = Buffer.from('dummy-key');
    const challenge = crypto.randomBytes(32);
    const signature = await signChallengeWithAgent(sockPath, keyBlob, challenge);

    expect(signature).toEqual(mockSig);
    server.close();
  });

  it('throws an error when agent refuses sign request', async () => {
    const sockPath = getTmpSocketPath();

    const server = net.createServer((sock) => {
      sock.on('data', () => {
        sock.write(encodeAgentResponse(Buffer.from([5]))); // SSH_AGENT_FAILURE = 5
      });
    });

    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    const keyBlob = Buffer.from('dummy-key');
    const challenge = crypto.randomBytes(32);

    await expect(signChallengeWithAgent(sockPath, keyBlob, challenge)).rejects.toThrow(
      'SSH agent refused sign request'
    );

    server.close();
  });
});
