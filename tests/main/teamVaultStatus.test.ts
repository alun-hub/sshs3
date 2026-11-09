import { describe, it, expect, vi } from 'vitest';
import { allKnownVaultIds, healIdentityPath, mergeTeamVaultStatus } from '../../src/main/services/teamVaultStatus';
import type { TeamVaultStatus } from '../../src/shared/types/teamVault';
import type { TeamVaultConfigEntry } from '../../src/main/services/TeamVaultConfigStore';

const status = (extra: Record<string, unknown> = {}) => ({ ...extra }) as unknown as TeamVaultStatus;
const config = (extra: Record<string, unknown> = {}) => ({ ...extra }) as unknown as TeamVaultConfigEntry;

describe('healIdentityPath', () => {
  const never = () => {
    throw new Error('must not be called');
  };

  it('has nothing to heal without a remembered path (and never touches the file system)', () => {
    expect(healIdentityPath(undefined, 'vlt_a', never, never)).toEqual({ path: undefined });
    expect(healIdentityPath('', 'vlt_a', never, never)).toEqual({ path: '' });
  });

  it('keeps a path whose file still exists, without asking for a relocation', () => {
    const exists = vi.fn().mockReturnValue(true);
    expect(healIdentityPath('/ids/key.txt', 'vlt_a', exists, never)).toEqual({ path: '/ids/key.txt' });
    expect(exists).toHaveBeenCalledWith('/ids/key.txt');
  });

  it('points a missing path at its migrated copy and reports the new path so the caller can persist it', () => {
    const relocate = vi.fn().mockReturnValue('/ids/vlt_a/key.txt');
    const result = healIdentityPath('/ids/key.txt', 'vlt_a', () => false, relocate);

    expect(result).toEqual({ path: '/ids/vlt_a/key.txt', relocatedTo: '/ids/vlt_a/key.txt' });
    expect(relocate).toHaveBeenCalledWith('/ids/key.txt', 'vlt_a');
  });

  it('keeps reporting the stale path, with nothing to persist, when there is no migrated copy', () => {
    const result = healIdentityPath('/ids/gone.txt', 'vlt_a', () => false, () => undefined);

    expect(result).toEqual({ path: '/ids/gone.txt' });
    expect('relocatedTo' in result).toBe(false);
  });
});

describe('mergeTeamVaultStatus', () => {
  it('keeps everything the local-file status already knows', () => {
    const merged = mergeTeamVaultStatus(status({ vaultId: 'vlt_a', exists: true, members: [{ recipientId: 'r1', role: 'admin' }] }), config(), 'vlt_a', undefined);
    expect(merged).toMatchObject({ vaultId: 'vlt_a', exists: true, members: [{ recipientId: 'r1', role: 'admin' }] });
  });

  describe('vaultId', () => {
    it('reports the id it was asked about when there is no local file yet', () => {
      expect(mergeTeamVaultStatus(status(), config(), 'vlt_pending', undefined).vaultId).toBe('vlt_pending');
    });

    it('keeps the id the local file reported', () => {
      expect(mergeTeamVaultStatus(status({ vaultId: 'vlt_file' }), config(), 'vlt_asked', undefined).vaultId).toBe('vlt_file');
    });
  });

  it('reports whether a remote target is configured', () => {
    expect(mergeTeamVaultStatus(status(), config({ target: { id: 't', name: 'n', type: 's3' } }), 'v', undefined).remoteConfigured).toBe(true);
    expect(mergeTeamVaultStatus(status(), config(), 'v', undefined).remoteConfigured).toBe(false);
  });

  it('passes the remote location and sync time through', () => {
    const merged = mergeTeamVaultStatus(status(), config({ remoteBasePath: 'bucket/tv', lastSyncAt: '2026-11-09T10:00:00.000Z', selfRecipientId: 'r9' }), 'v', undefined);
    expect(merged).toMatchObject({ remoteBasePath: 'bucket/tv', lastSyncAt: '2026-11-09T10:00:00.000Z', selfRecipientId: 'r9' });
  });

  it("reports the identity path it is given, not the config's (the caller may have healed it)", () => {
    const merged = mergeTeamVaultStatus(status(), config({ selfIdentityFilePath: '/old/key.txt' }), 'v', '/new/key.txt');
    expect(merged.selfIdentityFilePath).toBe('/new/key.txt');
  });

  describe('target config for the editor form', () => {
    const s3 = (extra: Record<string, unknown> = {}) => ({
      id: 't',
      name: 'n',
      type: 's3',
      s3Config: { id: 't', name: 'n', region: 'eu', accessKeyId: 'AKIA', secretAccessKey: 'the-secret', ...extra }, // pragma: allowlist secret
    });

    it('is only offered for an S3 target that has its S3 config', () => {
      expect(mergeTeamVaultStatus(status(), config({ target: { id: 't', name: 'n', type: 'sftp', sftpConfig: {} } }), 'v', undefined).targetConfig).toBeUndefined();
      expect(mergeTeamVaultStatus(status(), config({ target: { id: 't', name: 'n', type: 's3' } }), 'v', undefined).targetConfig).toBeUndefined();
      expect(mergeTeamVaultStatus(status(), config(), 'v', undefined).targetConfig).toBeUndefined();
    });

    it('hands over the connection details with the secret access key blanked and only its presence reported', () => {
      const merged = mergeTeamVaultStatus(status(), config({ target: s3() }), 'v', undefined);

      expect(merged.targetConfig).toEqual({
        type: 's3',
        s3Config: { id: 't', name: 'n', region: 'eu', accessKeyId: 'AKIA', secretAccessKey: '', hasSecretAccessKey: true },
      });
      expect(JSON.stringify(merged)).not.toContain('the-secret');
    });

    it('also hides a session token, and a proxy password (reporting only that one exists)', () => {
      const merged = mergeTeamVaultStatus(
        status(),
        config({ target: s3({ secretAccessKey: '', sessionToken: 'tok', proxy: { host: 'p', port: 1, password: 'proxy-pw' } }) }),
        'v',
        undefined
      );
      const text = JSON.stringify(merged);

      expect(text).not.toContain('"tok"');
      expect(text).not.toContain('proxy-pw');
      expect(merged.targetConfig).toMatchObject({ s3Config: { hasSecretAccessKey: true, proxy: { host: 'p', hasPassword: true } } });
    });
  });

  describe("the caller's role", () => {
    const members = [
      { recipientId: 'r1', role: 'admin' },
      { recipientId: 'r2', role: 'member' },
    ];

    it.each([
      ['r1', 'admin'],
      ['r2', 'member'],
    ])('is read from the members list for recipient %s', (recipientId, role) => {
      expect(mergeTeamVaultStatus(status({ members }), config({ selfRecipientId: recipientId }), 'v', undefined).selfRole).toBe(role);
    });

    it('is unknown when the recipient is not a member, no recipient is remembered, or there are no members', () => {
      expect(mergeTeamVaultStatus(status({ members }), config({ selfRecipientId: 'nobody' }), 'v', undefined).selfRole).toBeUndefined();
      expect(mergeTeamVaultStatus(status({ members }), config(), 'v', undefined).selfRole).toBeUndefined();
      expect(mergeTeamVaultStatus(status(), config({ selfRecipientId: 'r1' }), 'v', undefined).selfRole).toBeUndefined();
    });
  });

  it('does not modify its inputs', () => {
    const s = Object.freeze(status({ members: [] }));
    const c = Object.freeze(config({ target: { id: 't', name: 'n', type: 's3', s3Config: { secretAccessKey: 'x' } } }));
    expect(() => mergeTeamVaultStatus(s, c, 'v', undefined)).not.toThrow();
    expect((c as any).target.s3Config.secretAccessKey).toBe('x');
  });
});

describe('allKnownVaultIds', () => {
  it('lists vaults with a local file first, then those that only have a configured remote, each once', () => {
    expect(allKnownVaultIds(['vlt_a', 'vlt_b'], { vlt_b: {}, vlt_pending: {}, vlt_c: {} })).toEqual(['vlt_a', 'vlt_b', 'vlt_pending', 'vlt_c']);
  });

  it('is empty when nothing is known', () => {
    expect(allKnownVaultIds([], {})).toEqual([]);
  });

  it('covers a device with only local files, and one with only configured remotes', () => {
    expect(allKnownVaultIds(['vlt_a'], {})).toEqual(['vlt_a']);
    expect(allKnownVaultIds([], { vlt_x: {} })).toEqual(['vlt_x']);
  });
});
