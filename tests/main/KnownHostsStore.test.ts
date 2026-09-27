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

  // Regression tests for the H5 finding (code review): addHostKey used to
  // only append, leaving stale entries in place after a key rotation. Since
  // checkHost() treats ANY matching entry as 'match', a later MITM
  // presenting the retired (but still-trusted) old key was silently
  // accepted instead of raising the mismatch prompt.
  describe('invalidates stale entries on key rotation (H5)', () => {
    it('no longer matches the old key after trusting a rotated one for the same host+algorithm', async () => {
      const store = new KnownHostsStore(filePath);
      const oldKey = fakeKeyBuffer('ssh-ed25519', 'old-key-bytes');
      const newKey = fakeKeyBuffer('ssh-ed25519', 'new-key-bytes');

      await store.addHostKey('rotate.example.com', 22, oldKey);
      expect(await store.checkHost('rotate.example.com', 22, oldKey)).toBe('match');

      // User clicks "Trust Anyway" on the rotated key.
      await store.addHostKey('rotate.example.com', 22, newKey);

      expect(await store.checkHost('rotate.example.com', 22, newKey)).toBe('match');
      // The old key must now be a MISMATCH (raising the TOFU prompt again),
      // not a silent match — this is the actual security property.
      expect(await store.checkHost('rotate.example.com', 22, oldKey)).toBe('mismatch');

      const raw = await fs.readFile(filePath, 'utf-8');
      expect(raw).not.toContain(oldKey.toString('base64'));
      expect(raw).toContain(newKey.toString('base64'));
    });

    it('leaves an entry for a different key algorithm on the same host untouched', async () => {
      const store = new KnownHostsStore(filePath);
      const ed25519Key = fakeKeyBuffer('ssh-ed25519', 'ed-key-bytes');
      const rsaKey = fakeKeyBuffer('ssh-rsa', 'rsa-key-bytes');

      await store.addHostKey('multi-algo.example.com', 22, ed25519Key);
      await store.addHostKey('multi-algo.example.com', 22, rsaKey);

      // Rotate only the ed25519 key.
      const newEd25519Key = fakeKeyBuffer('ssh-ed25519', 'new-ed-key-bytes');
      await store.addHostKey('multi-algo.example.com', 22, newEd25519Key);

      expect(await store.checkHost('multi-algo.example.com', 22, newEd25519Key)).toBe('match');
      expect(await store.checkHost('multi-algo.example.com', 22, ed25519Key)).toBe('mismatch');
      // The untouched RSA key for the same host must still be trusted.
      expect(await store.checkHost('multi-algo.example.com', 22, rsaKey)).toBe('match');
    });

    it('strips only this host\'s pattern from a multi-host line, keeping the other host trusted', async () => {
      const key = fakeKeyBuffer('ssh-ed25519', 'shared-key-bytes');
      await fs.writeFile(
        filePath,
        `host-a.example.com,host-b.example.com ssh-ed25519 ${key.toString('base64')}\n`,
        'utf-8'
      );

      const store = new KnownHostsStore(filePath);
      const newKey = fakeKeyBuffer('ssh-ed25519', 'rotated-key-bytes');
      await store.addHostKey('host-a.example.com', 22, newKey);

      expect(await store.checkHost('host-a.example.com', 22, newKey)).toBe('match');
      expect(await store.checkHost('host-a.example.com', 22, key)).toBe('mismatch');
      // host-b was never rotated and must still trust the original key.
      expect(await store.checkHost('host-b.example.com', 22, key)).toBe('match');
    });

    it('preserves comments, blank lines and marker lines across a rotation rewrite', async () => {
      const oldKey = fakeKeyBuffer('ssh-ed25519', 'old-key-bytes');
      const content = [
        '# a comment',
        '',
        '@cert-authority *.example.com ssh-ed25519 SOMEKEY',
        `rotate.example.com ssh-ed25519 ${oldKey.toString('base64')}`,
        '',
      ].join('\n');
      await fs.writeFile(filePath, content, 'utf-8');

      const store = new KnownHostsStore(filePath);
      const newKey = fakeKeyBuffer('ssh-ed25519', 'new-key-bytes');
      await store.addHostKey('rotate.example.com', 22, newKey);

      const raw = await fs.readFile(filePath, 'utf-8');
      expect(raw).toContain('# a comment');
      expect(raw).toContain('@cert-authority *.example.com ssh-ed25519 SOMEKEY');
      expect(raw).not.toContain(oldKey.toString('base64'));
      expect(await store.checkHost('rotate.example.com', 22, newKey)).toBe('match');
    });
  });

  it('rejects injection attempts in host and invalid ports', async () => {
    const store = new KnownHostsStore(filePath);
    const key = fakeKeyBuffer('ssh-ed25519', 'first-key');

    await expect(store.addHostKey('example.com\nevil.com', 22, key)).rejects.toThrow(/Invalid host/);
    await expect(store.addHostKey('example.com evil.com', 22, key)).rejects.toThrow(/Invalid host/);
    await expect(store.addHostKey('example.com\r\nevil.com', 22, key)).rejects.toThrow(/Invalid host/);
    await expect(store.addHostKey('example.com', -1, key)).rejects.toThrow(/Invalid port/);
    await expect(store.addHostKey('example.com', 70000, key)).rejects.toThrow(/Invalid port/);
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
