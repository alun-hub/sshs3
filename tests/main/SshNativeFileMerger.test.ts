import { describe, it, expect } from 'vitest';
import {
  parseManagedSshConfigBlock,
  writeManagedSshConfigBlock,
  mergeSshConfigBlocks,
  mergeKnownHosts,
} from '../../src/main/services/SshNativeFileMerger';

describe('SshNativeFileMerger — ssh config managed block', () => {
  it('returns null when no managed block exists', () => {
    expect(parseManagedSshConfigBlock('Host foo\n  HostName foo.example.com\n')).toBeNull();
  });

  it('appends a managed block to a file that has none, leaving existing content untouched', () => {
    const original = 'Host myown\n  HostName myown.example.com\n';
    const result = writeManagedSshConfigBlock(original, { updatedAt: '2026-01-01T00:00:00.000Z', body: 'Host a\n  HostName a.example.com' });

    expect(result).toContain(original.trim());
    expect(result).toContain('BEGIN sshs3-managed');
    expect(result).toContain('Host a');
    expect(result).toContain('END sshs3-managed');
  });

  it('round-trips a managed block through write then parse', () => {
    const written = writeManagedSshConfigBlock('', {
      updatedAt: '2026-02-02T00:00:00.000Z',
      body: 'Host prod\n  HostName prod.example.com\n  User admin',
    });
    const parsed = parseManagedSshConfigBlock(written);

    expect(parsed?.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(parsed?.body).toBe('Host prod\n  HostName prod.example.com\n  User admin');
  });

  it('replaces an existing managed block in place without touching content outside it', () => {
    const original = [
      'Host myown',
      '  HostName myown.example.com',
      '',
      writeManagedSshConfigBlock('', { updatedAt: '2026-01-01T00:00:00.000Z', body: 'Host old\n  HostName old.example.com' }).trim(),
      '',
      'Host another',
      '  HostName another.example.com',
      '',
    ].join('\n');

    const updated = writeManagedSshConfigBlock(original, { updatedAt: '2026-03-03T00:00:00.000Z', body: 'Host new\n  HostName new.example.com' });

    expect(updated).toContain('Host myown');
    expect(updated).toContain('Host another');
    expect(updated).toContain('Host new');
    expect(updated).not.toContain('Host old');
  });

  it('merge: remote block wins when it is newer', () => {
    const local = writeManagedSshConfigBlock('', { updatedAt: '2026-01-01T00:00:00.000Z', body: 'Host local\n  HostName local.example.com' });
    const remote = writeManagedSshConfigBlock('', { updatedAt: '2026-02-01T00:00:00.000Z', body: 'Host remote\n  HostName remote.example.com' });

    const { merged, changed } = mergeSshConfigBlocks(local, remote);
    expect(changed).toBe(true);
    expect(merged).toContain('Host remote');
    expect(merged).not.toContain('Host local');
  });

  it('merge: local block wins when it is newer or equal, and nothing changes', () => {
    const local = writeManagedSshConfigBlock('', { updatedAt: '2026-05-01T00:00:00.000Z', body: 'Host local\n  HostName local.example.com' });
    const remote = writeManagedSshConfigBlock('', { updatedAt: '2026-01-01T00:00:00.000Z', body: 'Host remote\n  HostName remote.example.com' });

    const { merged, changed } = mergeSshConfigBlocks(local, remote);
    expect(changed).toBe(false);
    expect(merged).toBe(local);
  });

  it('merge: local file with no managed block yet adopts the remote block', () => {
    const local = 'Host myown\n  HostName myown.example.com\n';
    const remote = writeManagedSshConfigBlock('', { updatedAt: '2026-01-01T00:00:00.000Z', body: 'Host remote\n  HostName remote.example.com' });

    const { merged, changed } = mergeSshConfigBlocks(local, remote);
    expect(changed).toBe(true);
    expect(merged).toContain('Host myown');
    expect(merged).toContain('Host remote');
  });
});

describe('SshNativeFileMerger — known_hosts', () => {
  const KEY_A = Buffer.from('ssh-ed25519-fake-key-material-a').toString('base64');
  const KEY_B = Buffer.from('ssh-ed25519-fake-key-material-b').toString('base64');

  it('appends new host entries from remote that are missing locally', () => {
    const local = `host-a.example.com ssh-ed25519 ${KEY_A}\n`;
    const remote = `host-a.example.com ssh-ed25519 ${KEY_A}\nhost-b.example.com ssh-ed25519 ${KEY_B}\n`;

    const result = mergeKnownHosts(local, remote);

    expect(result.changed).toBe(true);
    expect(result.addedCount).toBe(1);
    expect(result.conflicts).toHaveLength(0);
    expect(result.mergedContent).toContain('host-a.example.com');
    expect(result.mergedContent).toContain('host-b.example.com');
  });

  it('is a no-op when remote has nothing new', () => {
    const local = `host-a.example.com ssh-ed25519 ${KEY_A}\n`;
    const result = mergeKnownHosts(local, local);

    expect(result.changed).toBe(false);
    expect(result.addedCount).toBe(0);
    expect(result.mergedContent).toBe(local);
  });

  it('never removes or rewrites local lines', () => {
    const local = `stale-host.example.com ssh-rsa ${KEY_A}\n`;
    const remote = `new-host.example.com ssh-ed25519 ${KEY_B}\n`;

    const result = mergeKnownHosts(local, remote);

    expect(result.mergedContent).toContain('stale-host.example.com ssh-rsa');
    expect(result.mergedContent).toContain('new-host.example.com ssh-ed25519');
  });

  it('flags a host-key mismatch as a conflict instead of silently applying it', () => {
    const local = `shared-host.example.com ssh-ed25519 ${KEY_A}\n`;
    const remote = `shared-host.example.com ssh-ed25519 ${KEY_B}\n`;

    const result = mergeKnownHosts(local, remote);

    expect(result.changed).toBe(false);
    expect(result.addedCount).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].hostPatternField).toBe('shared-host.example.com');
    expect(result.conflicts[0].localFingerprint).toMatch(/^SHA256:/);
    expect(result.conflicts[0].remoteFingerprint).toMatch(/^SHA256:/);
    expect(result.mergedContent).toBe(local);
  });

  it('ignores comment, blank, and @-marker lines', () => {
    const local = '# comment\n\n@cert-authority *.example.com ssh-ed25519 abc\n';
    const remote = `host-a.example.com ssh-ed25519 ${KEY_A}\n`;

    const result = mergeKnownHosts(local, remote);
    expect(result.changed).toBe(true);
    expect(result.addedCount).toBe(1);
  });
});
