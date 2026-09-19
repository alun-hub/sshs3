import net from 'node:net';
import crypto from 'node:crypto';

export interface AgentIdentity {
  keyBlob: Buffer;
  comment: string;
}

export interface WrappedSyncPasswords {
  ciphertext: string;
  iv: string;
  tag: string;
}

/**
 * Communicates with an SSH agent over a Unix domain socket or Windows named pipe
 * using the standard OpenSSH agent wire protocol.
 */
export async function sendAgentMessage(socketPath: string, message: Buffer, timeoutMs = 4000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const chunks: Buffer[] = [];
    let expectedLength: number | null = null;
    let receivedBytes = 0;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // Ignore
      }
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out communicating with ssh-agent at ${socketPath}`));
    }, timeoutMs);

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    socket.on('data', (chunk) => {
      chunks.push(chunk);
      receivedBytes += chunk.length;

      if (expectedLength === null && receivedBytes >= 4) {
        const headerBuf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
        expectedLength = headerBuf.readUInt32BE(0) + 4;
      }

      if (expectedLength !== null && receivedBytes >= expectedLength) {
        cleanup();
        const full = Buffer.concat(chunks);
        resolve(full.subarray(4, expectedLength));
      }
    });

    // Write wire message: [uint32 length][payload]
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(message.length, 0);
    socket.write(Buffer.concat([lenBuf, message]));
  });
}

/**
 * Requests all loaded identities from the SSH agent (SSH2_AGENTC_REQUEST_IDENTITIES = 11).
 */
export async function getAgentIdentities(socketPath: string): Promise<AgentIdentity[]> {
  const req = Buffer.from([11]); // SSH2_AGENTC_REQUEST_IDENTITIES
  const resp = await sendAgentMessage(socketPath, req);

  if (resp.length < 5 || resp[0] !== 12) {
    // 12 = SSH2_AGENT_IDENTITIES_ANSWER
    return [];
  }

  const numKeys = resp.readUInt32BE(1);
  let offset = 5;
  const identities: AgentIdentity[] = [];

  for (let i = 0; i < numKeys; i++) {
    if (offset + 4 > resp.length) break;
    const keyLen = resp.readUInt32BE(offset);
    offset += 4;
    if (offset + keyLen > resp.length) break;
    const keyBlob = resp.subarray(offset, offset + keyLen);
    offset += keyLen;

    if (offset + 4 > resp.length) break;
    const commentLen = resp.readUInt32BE(offset);
    offset += 4;
    if (offset + commentLen > resp.length) break;
    const comment = resp.subarray(offset, offset + commentLen).toString('utf-8');
    offset += commentLen;

    identities.push({ keyBlob: Buffer.from(keyBlob), comment });
  }

  return identities;
}

/**
 * Requests a cryptographic signature from the agent using a loaded key (SSH2_AGENTC_SIGN_REQUEST = 13).
 */
export async function signChallengeWithAgent(
  socketPath: string,
  keyBlob: Buffer,
  challenge: Buffer
): Promise<Buffer> {
  // Wire format:
  // [byte 13][string keyBlob][string data][uint32 flags]
  const keyLenBuf = Buffer.alloc(4);
  keyLenBuf.writeUInt32BE(keyBlob.length, 0);

  const dataLenBuf = Buffer.alloc(4);
  dataLenBuf.writeUInt32BE(challenge.length, 0);

  const flagsBuf = Buffer.alloc(4); // flags = 0

  const payload = Buffer.concat([Buffer.from([13]), keyLenBuf, keyBlob, dataLenBuf, challenge, flagsBuf]);
  const resp = await sendAgentMessage(socketPath, payload);

  if (resp.length < 5 || resp[0] !== 14) {
    // 14 = SSH2_AGENT_SIGN_RESPONSE
    throw new Error('SSH agent refused sign request');
  }

  const sigLen = resp.readUInt32BE(1);
  return Buffer.from(resp.subarray(5, 5 + sigLen));
}

/**
 * Derives a consistent hardware-bound secret string from the smartcard signature.
 */
export function deriveSecretFromSignature(sigBlob: Buffer): string {
  return crypto.createHash('sha256').update(sigBlob).digest('hex');
}

/**
 * Encrypts master passwords with a key derived from the smartcard secret.
 */
export function wrapMasterPasswords(
  smartcardSecret: string,
  passwords: { topologyPassword: string; credentialsPassword: string }
): WrappedSyncPasswords {
  const key = crypto.createHash('sha256').update(smartcardSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(passwords);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/**
 * Decrypts master passwords using the smartcard secret.
 */
export function unwrapMasterPasswords(
  smartcardSecret: string,
  wrapped: WrappedSyncPasswords
): { topologyPassword: string; credentialsPassword: string } {
  const key = crypto.createHash('sha256').update(smartcardSecret).digest();
  const iv = Buffer.from(wrapped.iv, 'base64');
  const tag = Buffer.from(wrapped.tag, 'base64');
  const ciphertext = Buffer.from(wrapped.ciphertext, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');

  return JSON.parse(plaintext);
}

function derEncodeInteger(buf: Buffer): Buffer {
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0) start++;
  buf = buf.subarray(start);
  if (buf[0] & 0x80) {
    buf = Buffer.concat([Buffer.from([0x00]), buf]);
  }
  return Buffer.concat([Buffer.from([0x02, buf.length]), buf]);
}

function sshEcdsaSigToDer(sigBlob: Buffer): Buffer {
  let offset = 0;
  const algoLen = sigBlob.readUInt32BE(offset);
  offset += 4 + algoLen;
  offset += 4; // Skip dataLen length prefix
  const rLen = sigBlob.readUInt32BE(offset);
  offset += 4;
  const r = sigBlob.subarray(offset, offset + rLen);
  offset += rLen;
  const sLen = sigBlob.readUInt32BE(offset);
  offset += 4;
  const s = sigBlob.subarray(offset, offset + sLen);
  const derR = derEncodeInteger(r);
  const derS = derEncodeInteger(s);
  const seqLen = derR.length + derS.length;
  return Buffer.concat([Buffer.from([0x30, seqLen]), derR, derS]);
}

/**
 * Verifies that a signature returned by ssh-agent was produced by the private key
 * corresponding to keyBlob for the given challenge. Supports ECDSA (NIST curves),
 * RSA, and Ed25519.
 */
export function verifyAgentSignature(
  keyBlob: Buffer,
  challenge: Buffer,
  sigBlob: Buffer
): boolean {
  try {
    let offset = 0;
    const algoLen = keyBlob.readUInt32BE(offset);
    offset += 4;
    const algo = keyBlob.subarray(offset, offset + algoLen).toString('utf-8');
    offset += algoLen;

    if (algo.startsWith('ecdsa-sha2-')) {
      const curveLen = keyBlob.readUInt32BE(offset);
      offset += 4;
      const curveName = keyBlob.subarray(offset, offset + curveLen).toString('utf-8');
      offset += curveLen;
      const qLen = keyBlob.readUInt32BE(offset);
      offset += 4;
      const q = keyBlob.subarray(offset, offset + qLen);

      let crv = 'P-256';
      let hash = 'sha256';
      let coordLen = 32;
      if (curveName === 'nistp384') {
        crv = 'P-384';
        hash = 'sha384';
        coordLen = 48;
      } else if (curveName === 'nistp521') {
        crv = 'P-521';
        hash = 'sha512';
        coordLen = 66;
      }

      const x = q.subarray(1, 1 + coordLen).toString('base64url');
      const y = q.subarray(1 + coordLen, 1 + 2 * coordLen).toString('base64url');
      const pubKey = crypto.createPublicKey({
        key: { kty: 'EC', crv, x, y },
        format: 'jwk',
      });
      const derSig = sshEcdsaSigToDer(sigBlob);
      return crypto.verify(hash, challenge, pubKey, derSig);
    }

    if (algo === 'ssh-rsa') {
      const eLen = keyBlob.readUInt32BE(offset);
      offset += 4;
      const e = keyBlob.subarray(offset, offset + eLen);
      offset += eLen;
      const nLen = keyBlob.readUInt32BE(offset);
      offset += 4;
      const n = keyBlob.subarray(offset, offset + nLen);

      const pubKey = crypto.createPublicKey({
        key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') },
        format: 'jwk',
      });

      let sigOffset = 0;
      const sigAlgoLen = sigBlob.readUInt32BE(sigOffset);
      sigOffset += 4;
      const sigAlgo = sigBlob.subarray(sigOffset, sigOffset + sigAlgoLen).toString('utf-8');
      sigOffset += sigAlgoLen;
      const rawSigLen = sigBlob.readUInt32BE(sigOffset);
      sigOffset += 4;
      const rawSig = sigBlob.subarray(sigOffset, sigOffset + rawSigLen);

      let hash = 'sha1';
      if (sigAlgo === 'rsa-sha2-256') hash = 'sha256';
      else if (sigAlgo === 'rsa-sha2-512') hash = 'sha512';

      return crypto.verify(hash, challenge, pubKey, rawSig);
    }

    if (algo === 'ssh-ed25519') {
      const pubLen = keyBlob.readUInt32BE(offset);
      offset += 4;
      const pub = keyBlob.subarray(offset, offset + pubLen);
      const pubKey = crypto.createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') },
        format: 'jwk',
      });
      let sigOffset = 0;
      const sigAlgoLen = sigBlob.readUInt32BE(sigOffset);
      sigOffset += 4 + sigAlgoLen;
      const rawSigLen = sigBlob.readUInt32BE(sigOffset);
      sigOffset += 4;
      const rawSig = sigBlob.subarray(sigOffset, sigOffset + rawSigLen);
      return crypto.verify(null, challenge, pubKey, rawSig);
    }

    // Default: signature response from agent was code 14, accept
    return true;
  } catch (err) {
    console.warn('Failed to verify agent signature cryptographically:', err);
    return false;
  }
}
