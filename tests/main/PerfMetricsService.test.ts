import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({ execFile: (...a: unknown[]) => execFileMock(...a) }));

const existsSync = vi.fn();
const readFile = vi.fn();
const statfs = vi.fn();
vi.mock('node:fs', () => ({
  default: {
    existsSync: (...a: unknown[]) => existsSync(...a),
    promises: { readFile: (...a: unknown[]) => readFile(...a), statfs: (...a: unknown[]) => statfs(...a) },
  },
}));

const getNamespacedCustomObject = vi.fn();
const readNamespacedPod = vi.fn();
vi.mock('../../src/main/services/k8sClient', () => ({
  loadK8sClient: async () => ({ CustomObjectsApi: class {}, CoreV1Api: class {} }),
}));
vi.mock('../../src/main/services/k8sKubeConfig', () => ({
  loadKubeConfigForContext: async () => ({
    makeApiClient: (api: { name?: string }) => (api.name === 'CoreV1Api' ? { readNamespacedPod } : { getNamespacedCustomObject }),
  }),
}));

import {
  isValidPerfK8sTarget,
  parseCpuMillicores,
  parseMemBytes,
  parseProcSnapshot,
  PerfMetricsService,
} from '../../src/main/services/PerfMetricsService';

const SNAPSHOT = `@@stat
cpu  100 10 50 800 40 5 5 0 0 0
cpu0 50 5 25 400 20 2 3 0 0 0
cpu1 50 5 25 400 20 3 2 0 0 0
@@loadavg
0.52 0.40 0.30 1/200 1234
@@meminfo
MemTotal:       8000000 kB
MemFree:        1000000 kB
MemAvailable:   4000000 kB
SwapTotal:      2000000 kB
SwapFree:       1500000 kB
@@net/dev
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 999 1 0 0 0 0 0 0 999 1 0 0 0 0 0 0
  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0
  eth1: 500 5 0 0 0 0 0 0 100 2 0 0 0 0 0 0
@@uptime
3600.50 7000.00
@@diskstats
   8       0 sda 100 0 2000 50 200 0 4000 80 0 0 0
   8       1 sda1 90 0 1800 40 190 0 3800 70 0 0 0
   7       0 loop0 5 0 100 1 0 0 0 0 0 0 0
 259       0 nvme0n1 10 0 500 5 20 0 1000 9 0 0 0
@@df
Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/sda1 100000 42000 58000 42% /
tmpfs 5000 0 5000 0% /dev/shm
/dev/sdb1 200000 150000 50000 75% /mnt/data disk
`;

describe('parseProcSnapshot', () => {
  it('parses a full Linux snapshot', () => {
    const raw = parseProcSnapshot(SNAPSHOT, 123)!;
    expect(raw.t).toBe(123);
    expect(raw.cpuTotal).toBe(1010);
    expect(raw.cpuIdle).toBe(840);
    expect(raw.cores).toBe(2);
    expect(raw.load).toEqual([0.52, 0.4, 0.3]);
    expect(raw.memTotalKb).toBe(8000000);
    expect(raw.memAvailKb).toBe(4000000);
    expect(raw.swapTotalKb).toBe(2000000);
    expect(raw.swapFreeKb).toBe(1500000);
    expect(raw.netRxBytes).toBe(1500); // lo excluded
    expect(raw.netTxBytes).toBe(2100);
    expect(raw.diskUsedPct).toBe(42);
    expect(raw.uptimeSec).toBeCloseTo(3600.5);
  });

  it('parses iowait, steal, per-core, procs, cache, disk I/O and every real filesystem', () => {
    const raw = parseProcSnapshot(SNAPSHOT)!;
    expect(raw.cpuIowait).toBe(40);
    expect(raw.cpuSteal).toBe(0);
    expect(raw.perCore).toEqual([
      { total: 50 + 5 + 25 + 400 + 20 + 2 + 3 + 0, idle: 420 },
      { total: 50 + 5 + 25 + 400 + 20 + 3 + 2 + 0, idle: 420 },
    ]);
    expect(raw.procsRunning).toBe(1);
    expect(raw.procsTotal).toBe(200);
    // sda + nvme0n1 only: partitions and loop devices are excluded to avoid double counting.
    expect(raw.diskReadBytes).toBe((2000 + 500) * 512);
    expect(raw.diskWriteBytes).toBe((4000 + 1000) * 512);
    expect(raw.disks).toEqual([
      { mount: '/', usedPct: 42, sizeKb: 100000 },
      { mount: '/mnt/data disk', usedPct: 75, sizeKb: 200000 },
    ]);
    expect(raw.diskUsedPct).toBe(42);
  });

  it('counts buffers, page cache and reclaimable slab as cache', () => {
    const out = SNAPSHOT.replace('MemAvailable:', 'Buffers: 100 kB\nCached: 200 kB\nSReclaimable: 50 kB\nMemAvailable:');
    expect(parseProcSnapshot(out)!.memCacheKb).toBe(350);
  });

  it('returns null for hosts without /proc (macOS/BSD)', () => {
    expect(parseProcSnapshot('@@stat\n@@loadavg\n@@meminfo\n@@df\n/dev/disk1 1 1 1 5% /\n')).toBeNull();
    expect(parseProcSnapshot('')).toBeNull();
  });

  it('falls back to free+buffers+cached when MemAvailable is missing', () => {
    const out = SNAPSHOT.replace('MemAvailable:   4000000 kB\n', 'Buffers: 100 kB\nCached: 200 kB\n');
    expect(parseProcSnapshot(out)!.memAvailKb).toBe(1000000 + 100 + 200);
  });
});

describe('quantity parsers', () => {
  it('parses cpu quantities', () => {
    expect(parseCpuMillicores('250m')).toBe(250);
    expect(parseCpuMillicores('2')).toBe(2000);
    expect(parseCpuMillicores('0.5')).toBe(500);
    expect(parseCpuMillicores('1500000n')).toBeCloseTo(1.5);
    expect(parseCpuMillicores('garbage')).toBe(0);
    expect(parseCpuMillicores(undefined)).toBe(0);
  });
  it('parses memory quantities', () => {
    expect(parseMemBytes('128Mi')).toBe(128 * 1024 ** 2);
    expect(parseMemBytes('1Gi')).toBe(1024 ** 3);
    expect(parseMemBytes('2048Ki')).toBe(2048 * 1024);
    expect(parseMemBytes('1G')).toBe(1e9);
    expect(parseMemBytes('5e3')).toBe(5000);
    expect(parseMemBytes('12345')).toBe(12345);
    expect(parseMemBytes('nope')).toBe(0);
  });
});

describe('isValidPerfK8sTarget', () => {
  const ok = { contextName: 'ctx', namespace: 'default', podName: 'my-pod-1', containerName: 'app' };
  it('accepts valid targets', () => expect(isValidPerfK8sTarget(ok)).toBe(true));
  it('rejects bad shapes and names', () => {
    expect(isValidPerfK8sTarget(null)).toBe(false);
    expect(isValidPerfK8sTarget({ ...ok, podName: '-x' })).toBe(false);
    expect(isValidPerfK8sTarget({ ...ok, podName: 'x;rm' })).toBe(false);
    expect(isValidPerfK8sTarget({ ...ok, namespace: 'ns-' })).toBe(false);
    expect(isValidPerfK8sTarget({ ...ok, contextName: '' })).toBe(false);
    expect(isValidPerfK8sTarget({ ...ok, containerName: 5 })).toBe(false);
  });
});

describe('PerfMetricsService.sampleSsh', () => {
  const session = { host: 'example.com', controlPath: '/tmp/s3m-abc.sock' };
  beforeEach(() => {
    execFileMock.mockReset();
    existsSync.mockReset().mockReturnValue(true);
  });

  it('runs the fixed command through the mux socket and parses the result', async () => {
    execFileMock.mockImplementation((_bin, _args, _opts, cb) => cb(null, SNAPSHOT));
    const svc = new PerfMetricsService(() => session);
    const res = await svc.sampleSsh('s1');
    expect(res.ok).toBe(true);
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args.slice(0, 2)).toEqual(['-S', '/tmp/s3m-abc.sock']);
    expect(args).toContain('BatchMode=yes');
    const sep = args.indexOf('--');
    expect(args[sep + 1]).toBe('example.com');
    expect(args[sep + 2]).toMatch(/^sh -c '.*'$/);
    expect(execFileMock.mock.calls[0][2]).toMatchObject({ timeout: 4000 });
    if (res.ok) expect(res.raw.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('fails closed when the session or mux socket is missing', async () => {
    const svc = new PerfMetricsService(() => undefined);
    expect(await svc.sampleSsh('nope')).toEqual({ ok: false, reason: 'no-session' });
    expect(await svc.sampleSsh(42)).toEqual({ ok: false, reason: 'no-session' });
    existsSync.mockReturnValue(false);
    expect(await new PerfMetricsService(() => session).sampleSsh('s')).toEqual({ ok: false, reason: 'no-session' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('refuses flag-looking hosts', async () => {
    const svc = new PerfMetricsService(() => ({ host: '-oProxyCommand=x', controlPath: '/tmp/a.sock' }));
    expect(await svc.sampleSsh('s')).toEqual({ ok: false, reason: 'error' });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('reports unsupported for non-Linux output and error for ssh failures', async () => {
    const svc = new PerfMetricsService(() => session);
    execFileMock.mockImplementation((_b, _a, _o, cb) => cb(null, '@@stat\n'));
    expect(await svc.sampleSsh('s')).toEqual({ ok: false, reason: 'unsupported' });
    execFileMock.mockImplementation((_b, _a, _o, cb) => cb(new Error('boom'), ''));
    expect(await svc.sampleSsh('s')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('PerfMetricsService.sampleK8s', () => {
  const target = { contextName: 'ctx', namespace: 'default', podName: 'pod-1', containerName: 'app' };
  const svc = new PerfMetricsService(() => undefined);
  beforeEach(() => {
    getNamespacedCustomObject.mockReset();
    readNamespacedPod.mockReset();
  });

  it('combines pod metrics with limits, restarts and phase', async () => {
    getNamespacedCustomObject.mockResolvedValue({
      containers: [
        { name: 'sidecar', usage: { cpu: '1m', memory: '1Mi' } },
        { name: 'app', usage: { cpu: '250000000n', memory: '64Mi' } },
      ],
    });
    readNamespacedPod.mockResolvedValue({
      metadata: { creationTimestamp: '2026-01-01T00:00:00Z' },
      spec: {
        nodeName: 'node-7',
        containers: [
          { name: 'app', resources: { limits: { cpu: '500m', memory: '128Mi' }, requests: { cpu: '100m', memory: '64Mi' } } },
        ],
      },
      status: {
        phase: 'Running',
        containerStatuses: [{ name: 'app', restartCount: 3 }],
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    });
    const res = await svc.sampleK8s(target);
    expect(res).toMatchObject({
      ok: true,
      raw: {
        cpuMillicores: 250,
        memBytes: 64 * 1024 ** 2,
        cpuLimitMillicores: 500,
        memLimitBytes: 128 * 1024 ** 2,
        restarts: 3,
        phase: 'Running',
        cpuRequestMillicores: 100,
        memRequestBytes: 64 * 1024 ** 2,
        ready: true,
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
        nodeName: 'node-7',
      },
    });
    expect(getNamespacedCustomObject).toHaveBeenCalledWith({
      group: 'metrics.k8s.io',
      version: 'v1beta1',
      namespace: 'default',
      plural: 'pods',
      name: 'pod-1',
    });
  });

  it('maps 404 to no-metrics and 403 to forbidden', async () => {
    readNamespacedPod.mockResolvedValue({});
    getNamespacedCustomObject.mockRejectedValue({ code: 404 });
    expect(await svc.sampleK8s(target)).toEqual({ ok: false, reason: 'no-metrics' });
    getNamespacedCustomObject.mockRejectedValue({ code: 403 });
    expect(await svc.sampleK8s(target)).toEqual({ ok: false, reason: 'forbidden' });
    getNamespacedCustomObject.mockRejectedValue(new Error('x'));
    expect(await svc.sampleK8s(target)).toEqual({ ok: false, reason: 'error' });
  });

  it('reports no-metrics when the container is absent and rejects invalid targets', async () => {
    getNamespacedCustomObject.mockResolvedValue({ containers: [] });
    readNamespacedPod.mockResolvedValue({});
    expect(await svc.sampleK8s(target)).toEqual({ ok: false, reason: 'no-metrics' });
    expect(await svc.sampleK8s({ ...target, podName: 'a b' })).toEqual({ ok: false, reason: 'error' });
  });
});

describe('PerfMetricsService.sampleLocal', () => {
  const svc = new PerfMetricsService(() => undefined);
  beforeEach(() => {
    readFile.mockReset();
    statfs.mockReset().mockResolvedValue({ blocks: 1000, bfree: 500, bavail: 400 });
  });

  it('reads /proc on Linux and adds disk usage from statfs', async () => {
    if (process.platform !== 'linux') return;
    const files: Record<string, string> = {
      '/proc/stat': 'cpu  100 10 50 800 40 5 5 0 0 0\ncpu0 50 5 25 400 20 2 3 0 0 0\nintr 1 2 3\n',
      '/proc/loadavg': '0.52 0.40 0.30 1/200 1234\n',
      '/proc/meminfo': 'MemTotal: 8000000 kB\nMemAvailable: 4000000 kB\n',
      '/proc/net/dev': 'h\nh\n  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0\n',
      '/proc/uptime': '3600.50 7000.00\n',
      '/proc/diskstats': '   8       0 sda 100 0 2000 50 200 0 4000 80 0 0 0\n',
    };
    readFile.mockImplementation(async (f: string) => files[f]);
    const res = await svc.sampleLocal();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.raw.memTotalKb).toBe(8000000);
      expect(res.raw.netRxBytes).toBe(1000);
      expect(res.raw.diskUsedPct).toBe(56); // used 500 / (500 + 400 avail)
      expect(res.raw.disks?.[0].mount).toBe('/');
      expect(res.raw.diskReadBytes).toBe(2000 * 512);
    }
  });

  it('reports unsupported instead of throwing when /proc is unreadable', async () => {
    if (process.platform !== 'linux') return;
    readFile.mockRejectedValue(new Error('EACCES'));
    expect(await svc.sampleLocal()).toEqual({ ok: false, reason: 'unsupported' });
  });
});
