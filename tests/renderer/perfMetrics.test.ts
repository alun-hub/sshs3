import { describe, it, expect } from 'vitest';
import type { PerfSshRaw } from '../../src/shared/types/perf';
import {
  computeK8sSample,
  computeSshSample,
  cpuSplit,
  ramSplit,
  seriesPeak,
  levelColor,
  formatUptime,
  metricApplies,
  metricPercent,
  metricText,
  pushHistory,
  tooltipText,
  resolveIntervalMs,
} from '../../src/renderer/src/lib/perfMetrics';

const raw = (over: Partial<PerfSshRaw> = {}): PerfSshRaw => ({
  t: 1000,
  cpuTotal: 1000,
  cpuIdle: 800,
  cores: 4,
  load: [1, 0.5, 0.25],
  memTotalKb: 1000,
  memAvailKb: 250,
  swapTotalKb: 0,
  swapFreeKb: 0,
  diskUsedPct: 40,
  netRxBytes: 1000,
  netTxBytes: 500,
  uptimeSec: 90000,
  ...over,
});

describe('computeSshSample', () => {
  it('has no counter-based values on the first sample', () => {
    const s = computeSshSample(null, raw());
    expect(s.cpuPct).toBeNull();
    expect(s.rxBps).toBeNull();
    expect(s.memPct).toBe(75);
    expect(s.swapPct).toBeNull();
    expect(s.diskPct).toBe(40);
  });

  it('derives cpu % and net rates from deltas', () => {
    const prev = raw();
    const cur = raw({ t: 3000, cpuTotal: 1200, cpuIdle: 850, netRxBytes: 5000, netTxBytes: 1500 });
    const s = computeSshSample(prev, cur);
    expect(s.cpuPct).toBeCloseTo(75); // 50 of 200 jiffies idle -> 75% busy
    expect(s.rxBps).toBe(2000);
    expect(s.txBps).toBe(500);
  });

  it('ignores counter resets', () => {
    const s = computeSshSample(raw({ t: 1000 }), raw({ t: 2000, cpuTotal: 10, cpuIdle: 5, netRxBytes: 1 }));
    expect(s.cpuPct).toBeNull();
    expect(s.rxBps).toBeNull();
  });

  it('computes swap %', () => {
    expect(computeSshSample(null, raw({ swapTotalKb: 100, swapFreeKb: 25 })).swapPct).toBe(75);
  });
});

describe('computeK8sSample', () => {
  it('gives percentages only with limits', () => {
    const withLimit = computeK8sSample({
      t: 1,
      cpuMillicores: 100,
      memBytes: 50,
      cpuLimitMillicores: 200,
      memLimitBytes: 100,
      restarts: 2,
      phase: 'Running',
    });
    expect(withLimit.cpuPct).toBe(50);
    expect(withLimit.memPct).toBe(50);
    expect(withLimit.restarts).toBe(2);
    const noLimit = computeK8sSample({ t: 1, cpuMillicores: 100, memBytes: 50, restarts: 0 });
    expect(noLimit.cpuPct).toBeNull();
    expect(noLimit.memPct).toBeNull();
    expect(metricText('k8s', 'cpu', noLimit)).toBe('CPU 100m');
    expect(metricText('k8s', 'cpu', withLimit)).toBe('CPU 100m (50%)');
  });
});

describe('helpers', () => {
  it('caps history length', () => {
    let h: ReturnType<typeof pushHistory> = [];
    for (let i = 0; i < 5; i++) h = pushHistory(h, computeSshSample(null, raw({ t: i })), 2);
    expect(h.map((s) => s.t)).toEqual([2, 3, 4]);
  });

  it('applies the Kubernetes floor to the interval', () => {
    expect(resolveIntervalMs('ssh', 2)).toBe(2000);
    expect(resolveIntervalMs('k8s', 2)).toBe(10000);
    expect(resolveIntervalMs('ssh', undefined)).toBe(5000);
  });

  it('knows which metrics apply where', () => {
    expect(metricApplies('ssh', 'load')).toBe(true);
    expect(metricApplies('ssh', 'restarts')).toBe(false);
    expect(metricApplies('k8s', 'load')).toBe(false);
    expect(metricApplies('k8s', 'restarts')).toBe(true);
  });

  it('formats text and percentages', () => {
    const s = computeSshSample(null, raw());
    expect(metricText('ssh', 'mem', s)).toBe('RAM 75%');
    expect(metricText('ssh', 'load', s)).toBe('Load 1.0 0.5 0.3');
    expect(metricText('ssh', 'net', s)).toBe('Net –');
    expect(metricPercent('ssh', 'load', s)).toBe(25);
    expect(metricPercent('ssh', 'net', s)).toBeNull();
    expect(formatUptime(90000)).toBe('1d 1h');
    expect(formatUptime(3700)).toBe('1h 1m');
    expect(formatUptime(null)).toBe('–');
  });
});

describe('formatBytes1', () => {
  it('uses at most one decimal', async () => {
    const { formatBytes1 } = await import('../../src/renderer/src/lib/perfMetrics');
    expect(formatBytes1(538.3251231527094)).toBe('538 B');
    expect(formatBytes1(1536)).toBe('1.5 KB');
    expect(formatBytes1(0)).toBe('0 B');
  });
});

describe('extended metrics', () => {
  const base = raw({
    cpuIowait: 20,
    cpuSteal: 5,
    perCore: [
      { total: 100, idle: 50 },
      { total: 100, idle: 90 },
    ],
    diskReadBytes: 0,
    diskWriteBytes: 0,
    procsRunning: 2,
    procsTotal: 300,
    memCacheKb: 100,
    disks: [{ mount: '/', usedPct: 40, sizeKb: 10 }],
    latencyMs: 23.4,
  });

  it('derives iowait, steal, per-core and disk I/O from deltas', () => {
    const cur = raw({
      t: 3000,
      cpuTotal: 1200,
      cpuIdle: 900,
      cpuIowait: 40,
      cpuSteal: 15,
      perCore: [
        { total: 200, idle: 100 },
        { total: 200, idle: 180 },
      ],
      diskReadBytes: 4000,
      diskWriteBytes: 2000,
    });
    const s = computeSshSample(base, cur);
    expect(s.iowaitPct).toBe(10); // 20 of 200
    expect(s.stealPct).toBe(5);
    expect(s.corePcts![0]).toBeCloseTo(50);
    expect(s.corePcts![1]).toBeCloseTo(10);
    expect(s.diskReadBps).toBe(2000);
    expect(s.diskWriteBps).toBe(1000);
    expect(s.procsTotal).toBeNull(); // cur has none
    expect(computeSshSample(null, base).procsRunning).toBe(2);
    expect(computeSshSample(null, base).latencyMs).toBe(23.4);
  });

  it('formats them', () => {
    const s = computeSshSample(null, base);
    expect(metricText('ssh', 'procs', s)).toBe('Procs 2/300');
    expect(metricText('ssh', 'latency', s)).toBe('Ping 23 ms');
    expect(metricText('ssh', 'disks', s)).toBe('Disks / 40%');
    expect(metricText('ssh', 'cache', s)).toBe('Cache 100.0 KB');
    expect(metricText('ssh', 'diskio', s)).toBe('Disk I/O –');
  });

  it('computes k8s request/limit, ready, age and node', () => {
    const s = computeK8sSample({
      t: 10_000,
      cpuMillicores: 100,
      memBytes: 1024 * 1024,
      cpuRequestMillicores: 50,
      cpuLimitMillicores: 200,
      memRequestBytes: 1024 * 1024,
      memLimitBytes: 2 * 1024 * 1024,
      restarts: 0,
      ready: false,
      createdAt: 10_000 - 90_000_000,
      nodeName: 'node-1',
    });
    expect(metricText('k8s', 'resources', s)).toBe('Req/Lim CPU 50m/200m RAM 1.0 MB/2.0 MB');
    expect(metricText('k8s', 'ready', s)).toBe('Ready no');
    expect(metricText('k8s', 'age', s)).toBe('Age 1d 1h');
    expect(metricText('k8s', 'node', s)).toBe('Node node-1');
  });

  it('tooltip lists every applicable metric, including ones the bar does not show', () => {
    const t = tooltipText('ssh', computeSshSample(null, base), 'prod');
    expect(t.split('\n')[0]).toBe('prod');
    for (const label of ['CPU', 'RAM', 'Load', 'Swap', 'Disk /', 'Net', 'Up', 'IOwait', 'Steal', 'Procs', 'Cores', 'Cache', 'Disks', 'Ping'])
      expect(t).toContain(label);
    expect(t).not.toContain('Restarts');
    expect(t).toContain('Click for history');
  });

  it('applies new metrics to the right session types', () => {
    expect(metricApplies('ssh', 'iowait')).toBe(true);
    expect(metricApplies('k8s', 'iowait')).toBe(false);
    expect(metricApplies('k8s', 'resources')).toBe(true);
    expect(metricApplies('ssh', 'node')).toBe(false);
  });
});

describe('graphics helpers', () => {
  it('splits CPU time into user+sys / iowait / steal / idle summing to 100', () => {
    const base = computeSshSample(null, raw());
    expect(cpuSplit(base)).toBeNull(); // no delta yet
    const seg = cpuSplit({ ...base, cpuPct: 30, iowaitPct: 10, stealPct: 5 })!;
    expect(Object.fromEntries(seg.map((x) => [x.label, x.value]))).toEqual({
      'user+sys': 25,
      iowait: 10,
      steal: 5,
      idle: 60,
    });
    expect(seg.reduce((a, x) => a + x.value, 0)).toBe(100);
  });

  it('splits RAM into used / cache / free without exceeding the total', () => {
    const s = { ...computeSshSample(null, raw({ memTotalKb: 1000, memAvailKb: 400, memCacheKb: 300 })) };
    const seg = ramSplit(s)!;
    expect(seg.map((x) => x.value)).toEqual([600 * 1024, 300 * 1024, 100 * 1024]);
    // cache larger than what is not "used" is clamped
    const clamped = ramSplit({ ...s, cacheBytes: 10_000 * 1024 })!;
    expect(clamped.reduce((a, x) => a + x.value, 0)).toBe(1000 * 1024);
    expect(ramSplit(computeK8sSample({ t: 1, cpuMillicores: 1, memBytes: 5, restarts: 0 }))).toBeNull();
  });

  it('finds the peak of a series and colours by threshold', () => {
    const h = [1, 5, 3].map((n) => ({ ...computeSshSample(null, raw()), rxBps: n }));
    expect(seriesPeak(h, (x) => x.rxBps)).toBe(5);
    expect(seriesPeak([], (x) => x.rxBps)).toBe(0);
    expect(levelColor(10)).toBe('#10b981');
    expect(levelColor(70)).toBe('#f59e0b');
    expect(levelColor(95)).toBe('#f43f5e');
    expect(levelColor(null)).toBe('#64748b');
  });
});
