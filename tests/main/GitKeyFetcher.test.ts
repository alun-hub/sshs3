import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isPrivateOrBlockedHost,
  buildGitKeysUrl,
  fetchGitPublicKeys,
} from '../../src/main/git/GitKeyFetcher';

describe('GitKeyFetcher', () => {
  describe('isPrivateOrBlockedHost', () => {
    it('blocks localhost, loopback and unspecified addresses', () => {
      expect(isPrivateOrBlockedHost('localhost')).toBe(true);
      expect(isPrivateOrBlockedHost('LOCALHOST')).toBe(true);
      expect(isPrivateOrBlockedHost('127.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedHost('127.0.0.53')).toBe(true);
      expect(isPrivateOrBlockedHost('::1')).toBe(true);
      expect(isPrivateOrBlockedHost('0.0.0.0')).toBe(true);
    });

    it('blocks cloud metadata IP 169.254.169.254 and link-local ranges', () => {
      expect(isPrivateOrBlockedHost('169.254.169.254')).toBe(true);
      expect(isPrivateOrBlockedHost('169.254.1.1')).toBe(true);
    });

    it('blocks RFC 1918 private IPv4 ranges', () => {
      expect(isPrivateOrBlockedHost('10.0.0.1')).toBe(true);
      expect(isPrivateOrBlockedHost('10.255.255.255')).toBe(true);
      expect(isPrivateOrBlockedHost('172.16.0.1')).toBe(true);
      expect(isPrivateOrBlockedHost('172.31.255.255')).toBe(true);
      expect(isPrivateOrBlockedHost('192.168.1.1')).toBe(true);
      expect(isPrivateOrBlockedHost('192.168.0.100')).toBe(true);
    });

    it('blocks .local and .internal domain suffixes', () => {
      expect(isPrivateOrBlockedHost('my-service.local')).toBe(true);
      expect(isPrivateOrBlockedHost('git.corp.internal')).toBe(true);
    });

    it('allows public hosts and IP addresses', () => {
      expect(isPrivateOrBlockedHost('github.com')).toBe(false);
      expect(isPrivateOrBlockedHost('gitlab.com')).toBe(false);
      expect(isPrivateOrBlockedHost('gitlab.example.org')).toBe(false);
      expect(isPrivateOrBlockedHost('1.1.1.1')).toBe(false);
      expect(isPrivateOrBlockedHost('8.8.8.8')).toBe(false);
      expect(isPrivateOrBlockedHost('172.15.0.1')).toBe(false);
      expect(isPrivateOrBlockedHost('172.32.0.1')).toBe(false);
    });
  });

  describe('buildGitKeysUrl', () => {
    it('builds GitHub URL correctly', () => {
      expect(buildGitKeysUrl('github', 'torvalds')).toBe('https://github.com/torvalds.keys');
      expect(buildGitKeysUrl('github', 'octo-cat')).toBe('https://github.com/octo-cat.keys');
    });

    it('builds GitLab URL correctly', () => {
      expect(buildGitKeysUrl('gitlab', 'gitlab-user')).toBe('https://gitlab.com/gitlab-user.keys');
    });

    it('builds custom host URL correctly', () => {
      expect(buildGitKeysUrl('custom', 'devuser', 'gitea.example.com')).toBe('https://gitea.example.com/devuser.keys');
      expect(buildGitKeysUrl('custom', 'devuser', 'https://forge.corp.net')).toBe('https://forge.corp.net/devuser.keys');
      expect(buildGitKeysUrl('custom', 'devuser', 'gitea.example.com:8443')).toBe('https://gitea.example.com:8443/devuser.keys');
    });

    it('rejects plain HTTP custom hosts', () => {
      expect(() => buildGitKeysUrl('custom', 'devuser', 'http://insecure.example.com')).toThrow(/HTTPS is allowed/);
    });

    it('rejects private/blocked custom hosts', () => {
      expect(() => buildGitKeysUrl('custom', 'devuser', '127.0.0.1')).toThrow(/security/);
      expect(() => buildGitKeysUrl('custom', 'devuser', 'localhost')).toThrow(/security/);
      expect(() => buildGitKeysUrl('custom', 'devuser', '192.168.1.50')).toThrow(/security/);
    });

    it('throws when custom host is missing', () => {
      expect(() => buildGitKeysUrl('custom', 'devuser')).toThrow(/custom host is required/);
    });
  });

  describe('fetchGitPublicKeys', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('validates username format', async () => {
      const resEmpty = await fetchGitPublicKeys({ provider: 'github', username: '' });
      expect(resEmpty.success).toBe(false);
      expect(resEmpty.error).toContain('Username is required');

      const resBad = await fetchGitPublicKeys({ provider: 'github', username: 'user;rm -rf /' });
      expect(resBad.success).toBe(false);
      expect(resBad.error).toContain('Invalid username format');
    });

    it('fetches and parses public keys from GitHub', async () => {
      const mockKeyData = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKey1 alice@github\nssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQExampleKey2 alice@github';
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': String(mockKeyData.length) }),
        text: () => Promise.resolve(mockKeyData),
      } as unknown as Response);

      const res = await fetchGitPublicKeys({ provider: 'github', username: 'alice' });
      expect(res.success).toBe(true);
      expect(res.keys).toHaveLength(2);
      expect(res.keys[0].type).toBe('ssh-ed25519');
      expect(res.keys[0].source).toBe('github');
    });

    it('handles 404 user not found gracefully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as unknown as Response);

      const res = await fetchGitPublicKeys({ provider: 'github', username: 'nonexistent-user-99999' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('not found on github');
    });

    it('rejects responses exceeding MAX_RESPONSE_BYTES', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-length': '100000' }),
        text: () => Promise.resolve('x'.repeat(100000)),
      } as unknown as Response);

      const res = await fetchGitPublicKeys({ provider: 'github', username: 'alice' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('Response exceeded maximum allowed size');
    });
  });
});
