import net from 'node:net';

export const SSH2_AGENTC_REQUEST_IDENTITIES = 11;
export const SSH2_AGENT_IDENTITIES_ANSWER = 12;
export const SSH2_AGENTC_ADD_IDENTITY = 17;
export const SSH2_AGENTC_ADD_ID_CONSTRAINED = 25;

export const SSH_AGENT_FAILURE = 5;
export const SSH_AGENT_SUCCESS = 6;

export const SSH_AGENT_CONSTRAIN_LIFETIME = 1;

export class BinaryWriter {
  private chunks: Buffer[] = [];
  private totalLength = 0;

  public writeByte(val: number): void {
    const b = Buffer.alloc(1);
    b.writeUInt8(val, 0);
    this.chunks.push(b);
    this.totalLength += 1;
  }

  public writeUint32(val: number): void {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(val, 0);
    this.chunks.push(b);
    this.totalLength += 4;
  }

  public writeBuffer(buf: Buffer): void {
    this.writeUint32(buf.length);
    this.chunks.push(buf);
    this.totalLength += buf.length;
  }

  public writeString(str: string): void {
    this.writeBuffer(Buffer.from(str, 'utf8'));
  }

  /**
   * Produces the complete agent message packet with 4-byte big-endian length prefix.
   */
  public toMessage(): Buffer {
    const body = Buffer.concat(this.chunks, this.totalLength);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(body.length, 0);
    return Buffer.concat([prefix, body]);
  }
}

export interface AddCertifiedEd25519KeyOptions {
  certificateWire: Buffer;
  publicKeyBytes: Buffer; // 32 bytes
  privateKeySeedBytes: Buffer; // 32 bytes
  comment?: string;
  lifetimeSeconds?: number;
}

/**
 * Encodes an OpenSSH agent protocol packet (`SSH2_AGENTC_ADD_ID_CONSTRAINED` or `SSH2_AGENTC_ADD_IDENTITY`)
 * for an `ssh-ed25519-cert-v01@openssh.com` identity.
 */
export function encodeAddCertifiedEd25519Key(params: AddCertifiedEd25519KeyOptions): Buffer {
  const writer = new BinaryWriter();
  const hasLifetime = typeof params.lifetimeSeconds === 'number' && params.lifetimeSeconds > 0;

  writer.writeByte(hasLifetime ? SSH2_AGENTC_ADD_ID_CONSTRAINED : SSH2_AGENTC_ADD_IDENTITY);
  writer.writeString('ssh-ed25519-cert-v01@openssh.com');
  writer.writeBuffer(params.certificateWire);
  writer.writeBuffer(params.publicKeyBytes);

  // In OpenSSH, the ed25519 secret key parameter is 64 bytes: 32 bytes seed + 32 bytes pubkey
  const sk = Buffer.alloc(64);
  params.privateKeySeedBytes.copy(sk, 0);
  params.publicKeyBytes.copy(sk, 32);
  writer.writeBuffer(sk);

  writer.writeString(params.comment ?? 'sshs3-ca');

  if (hasLifetime) {
    writer.writeByte(SSH_AGENT_CONSTRAIN_LIFETIME);
    writer.writeUint32(params.lifetimeSeconds!);
  }

  const message = writer.toMessage();
  // The writer holds `sk` by reference, so it may only be wiped once toMessage() has copied it.
  sk.fill(0);
  return message;
}

/**
 * Sends a raw packet to an OpenSSH agent socket and waits for the 1-byte response code.
 * Rejects if the agent returns SSH_AGENT_FAILURE (5) or if the connection fails.
 */
export async function sendAgentMessage(socketPath: string, messagePacket: Buffer, timeoutMs = 5000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let client: net.Socket;
    try {
      client = net.createConnection(socketPath);
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      client.destroy(new Error(`Timeout waiting for ssh-agent response on ${socketPath}`));
    }, timeoutMs);

    const chunks: Buffer[] = [];
    let expectedLength: number | null = null;
    let received = 0;

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    client.on('data', (data) => {
      chunks.push(data);
      received += data.length;

      if (expectedLength === null && received >= 4) {
        const full = Buffer.concat(chunks);
        expectedLength = full.readUInt32BE(0) + 4;
      }

      if (expectedLength !== null && received >= expectedLength) {
        clearTimeout(timer);
        client.end();
        const full = Buffer.concat(chunks);
        const body = full.subarray(4, expectedLength);
        resolve(body);
      }
    });

    client.on('connect', () => {
      client.write(messagePacket);
    });
  });
}

/**
 * Loads a certified Ed25519 key into the specified ssh-agent socket.
 */
export async function addCertifiedEd25519KeyToAgent(
  socketPath: string,
  options: AddCertifiedEd25519KeyOptions
): Promise<void> {
  const packet = encodeAddCertifiedEd25519Key(options);
  try {
    const responseBody = await sendAgentMessage(socketPath, packet);

    if (responseBody.length === 0 || responseBody[0] !== SSH_AGENT_SUCCESS) {
      const code = responseBody.length > 0 ? responseBody[0] : 'empty';
      throw new Error(`ssh-agent refused to add certified key (response code ${code})`);
    }
  } finally {
    packet.fill(0);
  }
}
