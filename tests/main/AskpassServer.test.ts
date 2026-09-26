import { describe, it, expect, vi, afterEach } from 'vitest';
import net from 'node:net';
import { AskpassServer } from '../../src/main/smartcard/AskpassServer';

describe('AskpassServer', () => {
  let server: AskpassServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  async function sendClientRequest(
    port: number,
    request: Record<string, any>
  ): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
        client.write(JSON.stringify(request) + '\n');
      });

      let response = '';
      client.on('data', (chunk) => {
        response += chunk.toString();
        if (response.includes('\n')) {
          try {
            const data = JSON.parse(response.trim());
            client.end();
            resolve(data);
          } catch (err) {
            client.end();
            reject(err);
          }
        }
      });

      client.on('error', reject);
    });
  }

  it('resolves a normal PIN prompt via promptHandler', async () => {
    const promptHandler = vi.fn().mockResolvedValue('secret-pin-123');
    server = new AskpassServer({ promptHandler, token: 'test-token' });
    const { port } = await server.start();

    const res = await sendClientRequest(port, {
      token: 'test-token',
      prompt: 'Enter PIN for authenticator: ',
    });

    expect(promptHandler).toHaveBeenCalledWith('Enter PIN for authenticator: ');
    expect(res).toEqual({ pin: 'secret-pin-123' });
  });

  it('resolves pure presence prompt (promptType="none") immediately without calling promptHandler', async () => {
    const promptHandler = vi.fn().mockResolvedValue('should-not-be-called');
    const onPresence = vi.fn();
    server = new AskpassServer({ promptHandler, onPresence, token: 'test-token' });
    const { port } = await server.start();

    let presenceEmitted = false;
    server.on('presence', (prompt) => {
      expect(prompt).toContain('Confirm user presence');
      presenceEmitted = true;
    });

    const res = await sendClientRequest(port, {
      token: 'test-token',
      prompt: 'Confirm user presence for key ED25519-SK SHA256:abc',
      promptType: 'none',
    });

    expect(promptHandler).not.toHaveBeenCalled();
    expect(onPresence).toHaveBeenCalledWith('Confirm user presence for key ED25519-SK SHA256:abc');
    expect(presenceEmitted).toBe(true);
    expect(res).toEqual({ pin: '' });
  });

  it('resolves pure presence prompt by text content even without promptType="none"', async () => {
    const promptHandler = vi.fn().mockResolvedValue('should-not-be-called');
    const onPresence = vi.fn();
    server = new AskpassServer({ promptHandler, onPresence, token: 'test-token' });
    const { port } = await server.start();

    const res = await sendClientRequest(port, {
      token: 'test-token',
      prompt: 'Confirm user presence for key ED25519-SK SHA256:xyz',
    });

    expect(promptHandler).not.toHaveBeenCalled();
    expect(onPresence).toHaveBeenCalledWith('Confirm user presence for key ED25519-SK SHA256:xyz');
    expect(res).toEqual({ pin: '' });
  });

  it('calls promptHandler when presence is requested alongside a PIN', async () => {
    const promptHandler = vi.fn().mockResolvedValue('fido-pin-456');
    const onPresence = vi.fn();
    server = new AskpassServer({ promptHandler, onPresence, token: 'test-token' });
    const { port } = await server.start();

    const res = await sendClientRequest(port, {
      token: 'test-token',
      prompt: 'Enter PIN and confirm user presence for ED25519-SK key SHA256:abc: ',
    });

    expect(promptHandler).toHaveBeenCalledWith(
      'Enter PIN and confirm user presence for ED25519-SK key SHA256:abc: '
    );
    expect(res).toEqual({ pin: 'fido-pin-456' });
  });

  it('rejects unauthorized tokens', async () => {
    const promptHandler = vi.fn();
    server = new AskpassServer({ promptHandler, token: 'valid-token' });
    const { port } = await server.start();

    const res = await sendClientRequest(port, {
      token: 'wrong-token',
      prompt: 'Enter PIN:',
    });

    expect(promptHandler).not.toHaveBeenCalled();
    expect(res).toEqual({ error: 'Unauthorized token' });
  });
});
