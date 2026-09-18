import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable, Writable } from 'node:stream';
import type { IStorageProvider, FileEntry, StorageType, WriteStreamOptions } from '../../src/shared/types/storage';
import { ProfileStore } from '../../src/main/profile/ProfileStore';
import { DotfilePoolStore } from '../../src/main/dotfiles/DotfilePoolStore';
import { SettingsStore } from '../../src/main/settings/SettingsStore';
import { SyncCryptoService, generateSalt, type ScryptParams } from '../../src/main/services/SyncCryptoService';
import {
  ProfileSyncService,
  SyncConflictError,
  mergeRecords,
  mergePools,
  getComparisonState,
  compareRecords,
  compareDotfilePools,
} from '../../src/main/services/ProfileSyncService';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';
import type { DotfilePool } from '../../src/shared/types/dotfiles';

const FAST_PARAMS: ScryptParams = { N: 16, r: 1, p: 1, maxmem: 4 * 1024 * 1024 };

/** In-memory IStorageProvider test double: enough of S3/SFTP semantics (stat/rename/streams) to exercise ProfileSyncService without a real backend. */
class FakeStorageProvider implements IStorageProvider {
  readonly id = 'fake';
  readonly name = 'fake';
  readonly type: StorageType;
  private files = new Map<string, { buffer: Buffer; mtime: string }>();
  private clock = 0;

  constructor(type: StorageType = 'sftp') {
    this.type = type;
  }

  async list(): Promise<FileEntry[]> {
    return [];
  }

  async stat(remotePath: string): Promise<FileEntry> {
    const entry = this.files.get(remotePath);
    if (!entry) {
      const err: any = new Error(`not found: ${remotePath}`);
      err.code = 'ENOENT';
      throw err;
    }
    return { name: path.basename(remotePath), path: remotePath, size: entry.buffer.length, isDirectory: false, mtime: entry.mtime };
  }

  async createFolder(): Promise<void> {}

  async delete(remotePath: string): Promise<void> {
    this.files.delete(remotePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const entry = this.files.get(oldPath);
    if (!entry) throw new Error(`rename source missing: ${oldPath}`);
    this.files.delete(oldPath);
    this.files.set(newPath, entry);
  }

  async createReadStream(remotePath: string): Promise<NodeJS.ReadableStream> {
    const entry = this.files.get(remotePath);
    if (!entry) {
      const err: any = new Error(`not found: ${remotePath}`);
      err.code = 'ENOENT';
      throw err;
    }
    return Readable.from([entry.buffer]);
  }

  async createWriteStream(remotePath: string, _options?: WriteStreamOptions): Promise<NodeJS.WritableStream> {
    const chunks: Buffer[] = [];
    return new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk as Buffer);
        cb();
      },
      final: (cb) => {
        this.clock += 1;
        this.files.set(remotePath, { buffer: Buffer.concat(chunks), mtime: String(this.clock) });
        cb();
      },
    });
  }

  /** Test-only escape hatch to simulate a write made by a different machine/process. */
  simulateExternalWrite(remotePath: string, buffer: Buffer): void {
    this.clock += 1;
    this.files.set(remotePath, { buffer, mtime: String(this.clock) });
  }

  hasFile(remotePath: string): boolean {
    return this.files.has(remotePath);
  }

  getRawBuffer(remotePath: string): Buffer | undefined {
    return this.files.get(remotePath)?.buffer;
  }
}

/**
 * In reality every machine in one sync setup shares the same salt per key
 * group (generated once, at "enable", and embedded in every uploaded file)
 * — only the first machine picks it; every other machine learns it either
 * by bootstrapping via pullFromRemote(password) or, as here, by already
 * having joined. Tests simulating multiple already-synced machines must
 * pass the SAME salts to every harness(), or their independently-cached
 * keys won't agree even with the same password.
 */
function makeCrypto(topologySalt: Buffer, credentialsSalt: Buffer): SyncCryptoService {
  const crypto = new SyncCryptoService(FAST_PARAMS);
  crypto.unlock('topology', 'topology-master-password', topologySalt);
  crypto.unlock('credentials', 'credentials-master-password', credentialsSalt);
  return crypto;
}

interface Harness {
  profileStore: ProfileStore;
  dotfilePoolStore: DotfilePoolStore;
  settingsStore: SettingsStore;
  sync: ProfileSyncService;
  dir: string;
  sshConfigPath: string;
  knownHostsPath: string;
}

async function makeHarness(topologySalt: Buffer, credentialsSalt: Buffer): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-sync-test-'));
  const sshConfigPath = path.join(dir, 'ssh_config');
  const knownHostsPath = path.join(dir, 'known_hosts');
  const profileStore = new ProfileStore(path.join(dir, 'profiles.json'));
  const dotfilePoolStore = new DotfilePoolStore(path.join(dir, 'dotfile-pools.json'));
  const settingsStore = new SettingsStore(path.join(dir, 'settings.json'));
  const sync = new ProfileSyncService(profileStore, dotfilePoolStore, settingsStore, makeCrypto(topologySalt, credentialsSalt), {
    sshConfigPath,
    knownHostsPath,
  });
  return { profileStore, dotfilePoolStore, settingsStore, sync, dir, sshConfigPath, knownHostsPath };
}

describe('ProfileSyncService', () => {
  let provider: FakeStorageProvider;
  let dirs: string[] = [];

  beforeEach(() => {
    provider = new FakeStorageProvider();
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  let sharedTopologySalt: Buffer;
  let sharedCredentialsSalt: Buffer;

  beforeEach(() => {
    sharedTopologySalt = generateSalt();
    sharedCredentialsSalt = generateSalt();
  });

  /** A "machine" already joined to the same sync setup as every other harness() call within one test. */
  async function harness(): Promise<Harness> {
    const h = await makeHarness(sharedTopologySalt, sharedCredentialsSalt);
    dirs.push(h.dir);
    return h;
  }

  it('round-trips an SSH profile between two machines, splitting secrets into credentials.enc', async () => {
    const machineA = await harness();
    await machineA.profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Prod',
      host: 'prod.example.com',
      username: 'admin',
      authType: 'password',
      password: 'super-secret',
    });

    await machineA.sync.pushToRemote(provider);

    // topology.enc must not contain the plaintext password or username.
    // (SFTP targets are anchored to the home directory — see resolveEffectiveBasePath.)
    const topologyRaw = provider.getRawBuffer('~/.sshs3/topology.enc')!.toString('utf-8');
    expect(topologyRaw).not.toContain('super-secret');
    expect(topologyRaw).not.toContain('admin');

    const machineB = await harness();
    const result = await machineB.sync.pullFromRemote(provider);

    expect(result.changedCategories).toEqual(expect.arrayContaining(['topology', 'credentials']));
    const profiles = await machineB.profileStore.getProfiles();
    expect(profiles.ssh).toHaveLength(1);
    expect(profiles.ssh[0]).toMatchObject({
      id: 'ssh-1',
      name: 'Prod',
      host: 'prod.example.com',
      username: 'admin',
      password: 'super-secret',
    });
  });

  it('preserves a local-only excluded field (privateKeyPath) across a pull that updates other fields', async () => {
    const machineA = await harness();
    await machineA.profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Prod v1',
      host: 'prod.example.com',
      username: 'admin',
      authType: 'privateKey',
    });
    await machineA.sync.pushToRemote(provider);

    const machineB = await harness();
    await machineB.profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Prod v1',
      host: 'prod.example.com',
      username: 'admin',
      authType: 'privateKey',
      privateKeyPath: 'C:\\Users\\bob\\.ssh\\id_ed25519',
    });
    await machineB.sync.pullFromRemote(provider); // nothing new yet, just establishes baseline

    // Now edit on machine A and push again.
    await new Promise((r) => setTimeout(r, 2));
    await machineA.profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Prod v2 renamed',
      host: 'prod.example.com',
      username: 'admin',
      authType: 'privateKey',
    });
    await machineA.sync.pushToRemote(provider);

    await machineB.sync.pullFromRemote(provider);
    const profiles = await machineB.profileStore.getProfiles();
    expect(profiles.ssh[0].name).toBe('Prod v2 renamed');
    expect(profiles.ssh[0].privateKeyPath).toBe('C:\\Users\\bob\\.ssh\\id_ed25519');
  });

  it('does not let an older remote copy overwrite a newer local edit', async () => {
    const machineA = await harness();
    await machineA.profileStore.saveSSH({ id: 'ssh-1', name: 'Old name', host: 'h', username: 'u', authType: 'password' });
    await machineA.sync.pushToRemote(provider);

    const machineB = await harness();
    await machineB.sync.pullFromRemote(provider);
    await new Promise((r) => setTimeout(r, 2));
    await machineB.profileStore.saveSSH({ id: 'ssh-1', name: 'New name from B', host: 'h', username: 'u', authType: 'password' });

    // B pulls again — nothing new remotely, B's own newer edit must survive.
    await machineB.sync.pullFromRemote(provider);
    const profiles = await machineB.profileStore.getProfiles();
    expect(profiles.ssh[0].name).toBe('New name from B');
  });

  it('propagates a deletion (tombstone) from one machine to another', async () => {
    const machineA = await harness();
    await machineA.profileStore.saveSSH({ id: 'ssh-1', name: 'Will be deleted', host: 'h', username: 'u', authType: 'password' });
    await machineA.sync.pushToRemote(provider);

    const machineB = await harness();
    await machineB.sync.pullFromRemote(provider);
    expect((await machineB.profileStore.getProfiles()).ssh).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 2));
    await machineA.profileStore.deleteSSH('ssh-1');
    await machineA.sync.pushToRemote(provider);

    await machineB.sync.pullFromRemote(provider);
    expect((await machineB.profileStore.getProfiles()).ssh).toHaveLength(0);
  });

  it('bootstraps a fresh machine using explicit passwords instead of a pre-established unlock', async () => {
    const machineA = await harness();
    await machineA.profileStore.saveS3({
      id: 's3-1',
      name: 'Backup',
      region: 'us-east-1',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'shh-its-a-secret',
    });
    await machineA.sync.pushToRemote(provider);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sshs3-sync-test-'));
    dirs.push(dir);
    const freshProfileStore = new ProfileStore(path.join(dir, 'profiles.json'));
    const freshDotfilePoolStore = new DotfilePoolStore(path.join(dir, 'dotfile-pools.json'));
    const freshSettingsStore = new SettingsStore(path.join(dir, 'settings.json'));
    const freshCrypto = new SyncCryptoService(FAST_PARAMS); // nothing unlocked yet
    const freshSync = new ProfileSyncService(freshProfileStore, freshDotfilePoolStore, freshSettingsStore, freshCrypto, {
      sshConfigPath: path.join(dir, 'ssh_config'),
      knownHostsPath: path.join(dir, 'known_hosts'),
    });

    await freshSync.pullFromRemote(provider, '', {
      topology: 'topology-master-password',
      credentials: 'credentials-master-password',
    });

    const profiles = await freshProfileStore.getProfiles();
    expect(profiles.s3[0]).toMatchObject({ id: 's3-1', accessKeyId: 'AKIA123', secretAccessKey: 'shh-its-a-secret' });
  });

  it('merges dotfile pool files edited independently on two machines without losing either edit', async () => {
    // Dotfile pool timestamps have minute resolution (they're shown to the
    // user as "Last saved: yyyy-mm-dd HH:mm"), so this test sets them
    // explicitly via preserveTimestamps rather than relying on wall-clock
    // delays between edits, which a fast test run could easily land within
    // the same minute.
    const machineA = await harness();
    await machineA.dotfilePoolStore.savePool(
      {
        id: 'pool-1',
        name: 'Shell',
        updatedAt: '2026-01-01 00:00',
        files: [
          { id: 'file-bashrc', remotePath: '~/.bashrc', content: 'echo A', updatedAt: '2026-01-01 00:00' },
          { id: 'file-vimrc', remotePath: '~/.vimrc', content: 'set number', updatedAt: '2026-01-01 00:00' },
        ],
      },
      { preserveTimestamps: true }
    );
    await machineA.sync.pushToRemote(provider);

    const machineB = await harness();
    await machineB.sync.pullFromRemote(provider);

    // Edit different files on each machine, at distinctly later (and different) minutes.
    const poolOnA = await machineA.dotfilePoolStore.getPool('pool-1');
    await machineA.dotfilePoolStore.savePool(
      {
        ...poolOnA!,
        updatedAt: '2026-01-01 00:05',
        files: poolOnA!.files.map((f) =>
          f.id === 'file-bashrc' ? { ...f, content: 'echo A edited on A', updatedAt: '2026-01-01 00:05' } : f
        ),
      },
      { preserveTimestamps: true }
    );
    await machineA.sync.pushToRemote(provider);

    const poolOnB = await machineB.dotfilePoolStore.getPool('pool-1');
    await machineB.dotfilePoolStore.savePool(
      {
        ...poolOnB!,
        updatedAt: '2026-01-01 00:10',
        files: poolOnB!.files.map((f) =>
          f.id === 'file-vimrc' ? { ...f, content: 'set number edited on B', updatedAt: '2026-01-01 00:10' } : f
        ),
      },
      { preserveTimestamps: true }
    );

    // B pulls A's change; both edits must survive.
    await machineB.sync.pullFromRemote(provider);
    const finalPool = await machineB.dotfilePoolStore.getPool('pool-1');
    const bashrc = finalPool!.files.find((f) => f.id === 'file-bashrc');
    const vimrc = finalPool!.files.find((f) => f.id === 'file-vimrc');
    expect(bashrc?.content).toBe('echo A edited on A');
    expect(vimrc?.content).toBe('set number edited on B');
  });

  it('merges known_hosts additively and surfaces a host-key conflict without applying it', async () => {
    const machineA = await harness();
    await fs.writeFile(machineA.knownHostsPath, 'shared-host.example.com ssh-ed25519 AAAAconflictA\n', 'utf-8');
    await machineA.sync.pushToRemote(provider);

    const machineB = await harness();
    await fs.writeFile(machineB.knownHostsPath, 'shared-host.example.com ssh-ed25519 AAAAconflictB\nother-host.example.com ssh-ed25519 AAAAother\n', 'utf-8');

    const result = await machineB.sync.pullFromRemote(provider);
    expect(result.sshNativeConflicts).toHaveLength(1);
    expect(result.sshNativeConflicts[0].hostPatternField).toBe('shared-host.example.com');

    const merged = await fs.readFile(machineB.knownHostsPath, 'utf-8');
    expect(merged).toContain('AAAAconflictB'); // local entry untouched
    expect(merged).toContain('other-host.example.com');
  });

  it('rejects a push when the remote file changed since it was last observed (optimistic concurrency)', async () => {
    const machineA = await harness();
    await machineA.profileStore.saveSSH({ id: 'ssh-1', name: 'A', host: 'h', username: 'u', authType: 'password' });
    await machineA.sync.pushToRemote(provider);

    // Simulate a third machine pushing a newer topology.enc that machineA never saw.
    provider.simulateExternalWrite('~/.sshs3/topology.enc', Buffer.from('not a real sync file'));

    await machineA.profileStore.saveSSH({ id: 'ssh-1', name: 'A edited again', host: 'h', username: 'u', authType: 'password' });
    await expect(machineA.sync.pushToRemote(provider)).rejects.toThrow(SyncConflictError);
  });

  it('keeps the whole settings object with the newer updatedAt (last-write-wins)', async () => {
    const machineA = await harness();
    await machineA.settingsStore.saveSettings({ theme: 'light' });
    await machineA.sync.pushToRemote(provider);

    const machineB = await harness();
    await new Promise((r) => setTimeout(r, 2));
    await machineB.settingsStore.saveSettings({ theme: 'dark', terminalFontSize: 20 });

    await machineB.sync.pullFromRemote(provider);
    const settings = await machineB.settingsStore.getSettings();
    // B's own edit is newer than A's push, so it must survive untouched.
    expect(settings.theme).toBe('dark');
    expect(settings.terminalFontSize).toBe(20);
  });

  it('prefixes remote paths with the given base path (e.g. an S3 bucket, which is not part of S3Config itself)', async () => {
    // Uses a dedicated S3-typed provider: an SFTP-typed one would anchor an
    // empty/relative base path to the home directory (see
    // resolveEffectiveBasePath), which doesn't apply to S3's bucket/key paths.
    const s3Provider = new FakeStorageProvider('s3');
    const machineA = await harness();
    await machineA.profileStore.saveSSH({ id: 'ssh-1', name: 'A', host: 'h', username: 'u', authType: 'password' });
    await machineA.sync.pushToRemote(s3Provider, 'my-bucket/some-prefix');

    expect(s3Provider.hasFile('my-bucket/some-prefix/.sshs3/topology.enc')).toBe(true);
    expect(s3Provider.hasFile('.sshs3/topology.enc')).toBe(false);

    const machineB = await harness();
    await machineB.sync.pullFromRemote(s3Provider, 'my-bucket/some-prefix');
    expect((await machineB.profileStore.getProfiles()).ssh[0].name).toBe('A');
  });

  it('anchors an SFTP target with no remote directory to the home directory, not a bare relative path', async () => {
    const machineA = await harness();
    await machineA.profileStore.saveSSH({ id: 'ssh-1', name: 'A', host: 'h', username: 'u', authType: 'password' });
    await machineA.sync.pushToRemote(provider); // provider.type === 'sftp', remoteBasePath defaults to ''

    expect(provider.hasFile('~/.sshs3/topology.enc')).toBe(true);
    expect(provider.hasFile('.sshs3/topology.enc')).toBe(false);
  });
});

describe('mergeRecords', () => {
  it('adds records only present on the remote side', () => {
    const local: SSHConnectionConfig[] = [];
    const remote: SSHConnectionConfig[] = [
      { id: '1', name: 'A', host: 'h', username: 'u', authType: 'password', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const { merged, changed } = mergeRecords(local, remote);
    expect(changed).toBe(true);
    expect(merged).toHaveLength(1);
  });

  it('keeps the local record when local is newer or equal', () => {
    const local: SSHConnectionConfig[] = [
      { id: '1', name: 'Local', host: 'h', username: 'u', authType: 'password', updatedAt: '2026-02-01T00:00:00.000Z' },
    ];
    const remote: SSHConnectionConfig[] = [
      { id: '1', name: 'Remote', host: 'h', username: 'u', authType: 'password', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const { merged, changed } = mergeRecords(local, remote);
    expect(changed).toBe(false);
    expect(merged[0].name).toBe('Local');
  });
});

describe('mergePools', () => {
  it('propagates a newer pool-level tombstone as a whole-pool deletion', () => {
    const local: DotfilePool[] = [{ id: 'p1', name: 'Pool', files: [{ id: 'f1', remotePath: '~/.bashrc', content: 'x', updatedAt: '2026-01-01T00:00' }], updatedAt: '2026-01-01T00:00' }];
    const remote: DotfilePool[] = [{ id: 'p1', name: 'Pool', files: [], updatedAt: '2026-02-01T00:00', deletedAt: '2026-02-01T00:00' }];

    const { merged, changedIds } = mergePools(local, remote);
    expect(changedIds.has('p1')).toBe(true);
    expect(merged[0].deletedAt).toBeTruthy();
  });
});

describe('getComparisonState', () => {
  it('correctly maps ahead/behind counts to sync states', () => {
    expect(getComparisonState(0, 0)).toBe('in_sync');
    expect(getComparisonState(2, 0)).toBe('ahead');
    expect(getComparisonState(0, 3)).toBe('behind');
    expect(getComparisonState(1, 1)).toBe('diverged');
  });
});

describe('compareRecords', () => {
  it('detects locally added and modified records as ahead', () => {
    const local = [
      { id: '1', name: 'Server 1', updatedAt: '2026-09-18 10:00' },
      { id: '2', name: 'Server 2', updatedAt: '2026-09-18 12:00' },
    ];
    const remote = [
      { id: '1', name: 'Server 1', updatedAt: '2026-09-18 10:00' },
    ];

    const result = compareRecords(local, remote, 'Profile');
    expect(result.ahead).toBe(1);
    expect(result.behind).toBe(0);
    expect(result.details[0]).toContain('created locally');
  });

  it('detects remote added records as behind', () => {
    const local = [
      { id: '1', name: 'Server 1', updatedAt: '2026-09-18 10:00' },
    ];
    const remote = [
      { id: '1', name: 'Server 1', updatedAt: '2026-09-18 10:00' },
      { id: '2', name: 'Server 2', updatedAt: '2026-09-18 12:00' },
    ];

    const result = compareRecords(local, remote, 'Profile');
    expect(result.ahead).toBe(0);
    expect(result.behind).toBe(1);
    expect(result.details[0]).toContain('added on remote');
  });

  it('detects diverged edits', () => {
    const local = [
      { id: '1', name: 'Server 1 Local', updatedAt: '2026-09-18 14:00' },
    ];
    const remote = [
      { id: '1', name: 'Server 1 Remote', updatedAt: '2026-09-18 12:00' },
      { id: '2', name: 'Server 2', updatedAt: '2026-09-18 13:00' },
    ];

    const result = compareRecords(local, remote, 'Profile');
    expect(result.ahead).toBe(1);
    expect(result.behind).toBe(1);
  });
});

describe('compareDotfilePools', () => {
  it('detects changes in pool files', () => {
    const local: DotfilePool[] = [
      {
        id: 'p1',
        name: 'Pool 1',
        files: [{ id: 'f1', remotePath: '~/.bashrc', content: 'local', updatedAt: '2026-09-18 20:00' }],
        updatedAt: '2026-09-18 19:00',
      },
    ];
    const remote: DotfilePool[] = [
      {
        id: 'p1',
        name: 'Pool 1',
        files: [{ id: 'f1', remotePath: '~/.bashrc', content: 'remote', updatedAt: '2026-09-18 19:00' }],
        updatedAt: '2026-09-18 19:00',
      },
    ];
    const res = compareDotfilePools(local, remote);
    expect(res.ahead).toBe(1);
    expect(res.behind).toBe(0);
  });
});

describe('compareWithRemote', () => {
  let tmpDir: string;
  let provider: FakeStorageProvider;
  let service: ProfileSyncService;
  let profileStore: ProfileStore;
  let dotfilePoolStore: DotfilePoolStore;
  let settingsStore: SettingsStore;
  let crypto: SyncCryptoService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-compare-test-'));
    provider = new FakeStorageProvider();
    profileStore = new ProfileStore(path.join(tmpDir, 'profiles.json'));
    dotfilePoolStore = new DotfilePoolStore(path.join(tmpDir, 'dotfiles.json'));
    settingsStore = new SettingsStore(path.join(tmpDir, 'settings.json'));
    crypto = new SyncCryptoService(FAST_PARAMS);
    service = new ProfileSyncService(profileStore, dotfilePoolStore, settingsStore, crypto, {
      sshConfigPath: path.join(tmpDir, 'ssh_config'),
      knownHostsPath: path.join(tmpDir, 'known_hosts'),
    });

    crypto.unlock('topology', 'top-secret', generateSalt());
    crypto.unlock('credentials', 'cred-secret', generateSalt());
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports not_initialized when remote has no sync files', async () => {
    await profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Server 1',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      authType: 'password',
    });

    const comparison = await service.compareWithRemote(provider);
    expect(comparison.state).toBe('not_initialized');
    expect(comparison.aheadCount).toBeGreaterThan(0);
    expect(comparison.behindCount).toBe(0);
  });

  it('reports in_sync after pushing to remote', async () => {
    await profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Server 1',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      authType: 'password',
    });

    await service.pushToRemote(provider);

    const comparison = await service.compareWithRemote(provider);
    expect(comparison.state).toBe('in_sync');
    expect(comparison.aheadCount).toBe(0);
    expect(comparison.behindCount).toBe(0);
  });

  it('reports ahead when local profile is modified after push', async () => {
    await profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Server 1',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      authType: 'password',
    });

    await service.pushToRemote(provider);

    // Modify local profile with newer timestamp
    await profileStore.saveSSH({
      id: 'ssh-1',
      name: 'Server 1 Renamed',
      host: '1.2.3.4',
      port: 22,
      username: 'root',
      authType: 'password',
      updatedAt: '2026-09-18 21:00',
    });

    const comparison = await service.compareWithRemote(provider);
    expect(comparison.state).toBe('ahead');
    expect(comparison.aheadCount).toBe(1);
    expect(comparison.behindCount).toBe(0);
  });

  it('reports behind when remote has newer changes pushed from another machine', async () => {
    const saltTop = generateSalt();
    const saltCred = generateSalt();
    const machineA = await makeHarness(saltTop, saltCred);
    const machineB = await makeHarness(saltTop, saltCred);

    try {
      await machineA.profileStore.saveSSH({
        id: 'ssh-1',
        name: 'Server on A',
        host: '1.2.3.4',
        username: 'root',
        authType: 'password',
      });
      await machineA.sync.pushToRemote(provider);

      // machineB has not pulled yet
      const comparisonB = await machineB.sync.compareWithRemote(provider);
      expect(comparisonB.state).toBe('behind');
      expect(comparisonB.behindCount).toBe(1);
      expect(comparisonB.aheadCount).toBe(0);
    } finally {
      await fs.rm(machineA.dir, { recursive: true, force: true });
      await fs.rm(machineB.dir, { recursive: true, force: true });
    }
  });

  it('reports diverged when both local and remote have independent changes', async () => {
    const saltTop = generateSalt();
    const saltCred = generateSalt();
    const machineA = await makeHarness(saltTop, saltCred);
    const machineB = await makeHarness(saltTop, saltCred);

    try {
      // Both start synced
      await machineA.profileStore.saveSSH({
        id: 'ssh-1',
        name: 'Initial Server',
        host: '1.1.1.1',
        username: 'root',
        authType: 'password',
      });
      await machineA.sync.pushToRemote(provider);
      await machineB.sync.pullFromRemote(provider);

      // machineA pushes a new profile
      await machineA.profileStore.saveSSH({
        id: 'ssh-from-A',
        name: 'Server from A',
        host: '2.2.2.2',
        username: 'root',
        authType: 'password',
      });
      await machineA.sync.pushToRemote(provider);

      // machineB adds a local profile without pulling first
      await machineB.profileStore.saveSSH({
        id: 'ssh-from-B',
        name: 'Server from B',
        host: '3.3.3.3',
        username: 'root',
        authType: 'password',
      });

      const comparisonB = await machineB.sync.compareWithRemote(provider);
      expect(comparisonB.state).toBe('diverged');
      expect(comparisonB.aheadCount).toBeGreaterThan(0);
      expect(comparisonB.behindCount).toBeGreaterThan(0);
    } finally {
      await fs.rm(machineA.dir, { recursive: true, force: true });
      await fs.rm(machineB.dir, { recursive: true, force: true });
    }
  });
});
