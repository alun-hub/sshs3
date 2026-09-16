import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {
  KnownHostsStore,
  hostIdentifier,
  readKeyType,
  fingerprintKey,
} from '../../src/main/ssh/KnownHostsStore';

function fakeKeyBuffer(algo: string, payload: string): Buffer {
  const algoBuf = Buffer.from(algo, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(algoBuf.length, 0);
  return Buffer.concat([lenBuf, algoBuf, Buffer.from(payload, 'utf8')]);
}

describe('KnownHostsStore', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multissh-known-hosts-'));
    filePath = path.join(tempDir, 'known_hosts');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('reports "unknown" for a host with no known_hosts entry', async () => {
    const store = new KnownHostsStore(filePath);
    const key = fakeKeyBuffer('ssh-ed25519', 'key-bytes-1');
    const result = await store.checkHost('example.com', 22, key);
    expect(result).toBe('unknown');
  });

  it('reports "match" once a key has been added for that host', async () => {
    const store = new KnownHostsStore(filePath);
    const key = fakeKeyBuffer('ssh-ed25519', 'key-bytes-1');
    await store.addHostKey('example.com', 22, key);

    const result = await store.checkHost('example.com', 22, key);
    expect(result).toBe('match');
  });

  it('reports "mismatch" when a different key is presented for a known host', async () => {
    const store = new KnownHostsStore(filePath);
    const originalKey = fakeKeyBuffer('ssh-ed25519', 'key-bytes-original');
    await store.addHostKey('example.com', 22, originalKey);

    const rotatedKey = fakeKeyBuffer('ssh-ed25519', 'key-bytes-rotated');
    const result = await store.checkHost('example.com', 22, rotatedKey);
    expect(result).toBe('mismatch');
  });

  it('uses [host]:port identifiers for non-default ports and does not match the default-port entry', async () => {
    const store = new KnownHostsStore(filePath);
    const key = fakeKeyBuffer('ssh-rsa', 'key-bytes');
    await store.addHostKey('example.com', 22, key);

    const result = await store.checkHost('example.com', 2222, key);
    expect(result).toBe('unknown');

    await store.addHostKey('example.com', 2222, key);
    const result2 = await store.checkHost('example.com', 2222, key);
    expect(result2).toBe('match');
  });

  it('matches hashed (HashKnownHosts-style) host entries', async () => {
    const identifier = hostIdentifier('hashed.example.com', 22);
    const key = fakeKeyBuffer('ssh-ed25519', 'hashed-key-bytes');
    const salt = crypto.randomBytes(20);
    const hmac = crypto.createHmac('sha1', salt).update(identifier).digest();
    const line = `|1|${salt.toString('base64')}|${hmac.toString('base64')} ssh-ed25519 ${key.toString('base64')}\n`;
    await fs.writeFile(filePath, line, 'utf-8');

    const store = new KnownHostsStore(filePath);
    const result = await store.checkHost('hashed.example.com', 22, key);
    expect(result).toBe('match');
  });

  it('supports wildcard host patterns', async () => {
    const key = fakeKeyBuffer('ssh-ed25519', 'wildcard-key');
    await fs.writeFile(filePath, `*.example.com ssh-ed25519 ${key.toString('base64')}\n`, 'utf-8');

    const store = new KnownHostsStore(filePath);
    const result = await store.checkHost('host1.example.com', 22, key);
    expect(result).toBe('match');
  });

  it('ignores comments, blank lines and marker (@cert-authority/@revoked) lines', async () => {
    const key = fakeKeyBuffer('ssh-ed25519', 'marker-key');
    const content = [
      '# a comment',
      '',
      '@cert-authority *.example.com ssh-ed25519 SOMEKEY',
      `real.example.com ssh-ed25519 ${key.toString('base64')}`,
      '',
    ].join('\n');
    await fs.writeFile(filePath, content, 'utf-8');

    const store = new KnownHostsStore(filePath);
    expect(await store.checkHost('real.example.com', 22, key)).toBe('match');
  });

  it('creates the file (and parent dir) on first addHostKey when none exists', async () => {
    const nestedPath = path.join(tempDir, 'nested', 'known_hosts');
    const store = new KnownHostsStore(nestedPath);
    const key = fakeKeyBuffer('ssh-ed25519', 'first-key');

    await store.addHostKey('new.example.com', 22, key);

    const raw = await fs.readFile(nestedPath, 'utf-8');
    expect(raw).toContain('new.example.com');
    expect(raw).toContain('ssh-ed25519');
  });

  describe('helper functions', () => {
    it('hostIdentifier omits the port for 22 and includes it otherwise', () => {
      expect(hostIdentifier('h', 22)).toBe('h');
      expect(hostIdentifier('h', 2222)).toBe('[h]:2222');
    });

    it('readKeyType extracts the SSH wire algorithm name', () => {
      const key = fakeKeyBuffer('ssh-ed25519', 'payload');
      expect(readKeyType(key)).toBe('ssh-ed25519');
    });

    it('fingerprintKey produces a stable SHA256: fingerprint', () => {
      const key = fakeKeyBuffer('ssh-ed25519', 'payload');
      const fp = fingerprintKey(key);
      expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
      expect(fingerprintKey(key)).toBe(fp);
    });
  });
});
