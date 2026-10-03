import {
  PERF_HISTORY_MS,
  PERF_K8S_MIN_INTERVAL_SEC,
  PERF_WIN_SSH_MIN_INTERVAL_SEC,
  type PerfK8sRaw,
  type PerfMetricId,
  type PerfSample,
  type PerfSshRaw,
} from '@shared/types/perf';

/** Points drawn by the in-bar sparklines (the detail view shows the whole retained window). */
export const PERF_SPARK_POINTS = 60;

const clampPct = (v: number): number => Math.min(100, Math.max(0, v));

const EMPTY_SAMPLE: Omit<PerfSample, 't'> = {
  cpuPct: null,
  memPct: null,
  memUsedBytes: null,
  memTotalBytes: null,
  load: null,
  cores: null,
  swapPct: null,
  diskPct: null,
  rxBps: null,
  txBps: null,
  uptimeSec: null,
  restarts: null,
  iowaitPct: null,
  stealPct: null,
  corePcts: null,
  diskReadBps: null,
  diskWriteBps: null,
  procsRunning: null,
  procsTotal: null,
  cacheBytes: null,
  disks: null,
  latencyMs: null,
  cpuMillicores: null,
  cpuRequestMillicores: null,
  cpuLimitMillicores: null,
  memRequestBytes: null,
  memLimitBytes: null,
  ready: null,
  ageSec: null,
  nodeName: null,
  phase: null,
};

/** Derives display values from two consecutive /proc snapshots. Counter-based values are null on the first sample. */
export function computeSshSample(prev: PerfSshRaw | null, cur: PerfSshRaw): PerfSample {
  const s: PerfSample = { ...EMPTY_SAMPLE, t: cur.t };

  if (prev && cur.cpuTotal > prev.cpuTotal && cur.cpuIdle >= prev.cpuIdle) {
    const dTotal = cur.cpuTotal - prev.cpuTotal;
    s.cpuPct = clampPct(100 * (1 - (cur.cpuIdle - prev.cpuIdle) / dTotal));
    if (cur.cpuIowait !== undefined && prev.cpuIowait !== undefined && cur.cpuIowait >= prev.cpuIowait) {
      s.iowaitPct = clampPct((100 * (cur.cpuIowait - prev.cpuIowait)) / dTotal);
    }
    if (cur.cpuSteal !== undefined && prev.cpuSteal !== undefined && cur.cpuSteal >= prev.cpuSteal) {
      s.stealPct = clampPct((100 * (cur.cpuSteal - prev.cpuSteal)) / dTotal);
    }
  }

  if (prev?.perCore && cur.perCore && prev.perCore.length === cur.perCore.length) {
    s.corePcts = cur.perCore.map((c, i) => {
      const p = prev.perCore![i];
      const dTotal = c.total - p.total;
      return dTotal > 0 && c.idle >= p.idle ? clampPct(100 * (1 - (c.idle - p.idle) / dTotal)) : 0;
    });
  }

  const dt = prev ? (cur.t - prev.t) / 1000 : 0;
  if (prev && dt > 0) {
    if (
      cur.netRxBytes !== undefined &&
      cur.netTxBytes !== undefined &&
      prev.netRxBytes !== undefined &&
      prev.netTxBytes !== undefined &&
      cur.netRxBytes >= prev.netRxBytes &&
      cur.netTxBytes >= prev.netTxBytes
    ) {
      s.rxBps = (cur.netRxBytes - prev.netRxBytes) / dt;
      s.txBps = (cur.netTxBytes - prev.netTxBytes) / dt;
    }
    if (
      cur.diskReadBytes !== undefined &&
      cur.diskWriteBytes !== undefined &&
      prev.diskReadBytes !== undefined &&
      prev.diskWriteBytes !== undefined &&
      cur.diskReadBytes >= prev.diskReadBytes &&
      cur.diskWriteBytes >= prev.diskWriteBytes
    ) {
      s.diskReadBps = (cur.diskReadBytes - prev.diskReadBytes) / dt;
      s.diskWriteBps = (cur.diskWriteBytes - prev.diskWriteBytes) / dt;
    }
  }

  if (cur.memTotalKb > 0) {
    const used = Math.max(0, cur.memTotalKb - cur.memAvailKb);
    s.memPct = clampPct((100 * used) / cur.memTotalKb);
    s.memUsedBytes = used * 1024;
    s.memTotalBytes = cur.memTotalKb * 1024;
  }
  if (cur.memCacheKb !== undefined) s.cacheBytes = cur.memCacheKb * 1024;
  if (cur.swapTotalKb > 0) {
    s.swapPct = clampPct((100 * (cur.swapTotalKb - cur.swapFreeKb)) / cur.swapTotalKb);
  }
  s.load = cur.load ?? null;
  s.cores = cur.cores;
  s.procsRunning = cur.procsRunning ?? null;
  s.procsTotal = cur.procsTotal ?? null;
  s.diskPct = cur.diskUsedPct ?? null;
  s.disks = cur.disks ?? null;
  s.uptimeSec = cur.uptimeSec;
  s.latencyMs = cur.latencyMs ?? null;
  return s;
}

/** Pod metrics are instantaneous; percentages exist only when the container declares a limit. */
export function computeK8sSample(cur: PerfK8sRaw): PerfSample {
  return {
    ...EMPTY_SAMPLE,
    t: cur.t,
    cpuMillicores: cur.cpuMillicores,
    cpuPct: cur.cpuLimitMillicores ? clampPct((100 * cur.cpuMillicores) / cur.cpuLimitMillicores) : null,
    cpuRequestMillicores: cur.cpuRequestMillicores ?? null,
    cpuLimitMillicores: cur.cpuLimitMillicores ?? null,
    memUsedBytes: cur.memBytes,
    memTotalBytes: cur.memLimitBytes ?? null,
    memPct: cur.memLimitBytes ? clampPct((100 * cur.memBytes) / cur.memLimitBytes) : null,
    memRequestBytes: cur.memRequestBytes ?? null,
    memLimitBytes: cur.memLimitBytes ?? null,
    restarts: cur.restarts,
    ready: cur.ready ?? null,
    ageSec: cur.createdAt !== undefined ? Math.max(0, (cur.t - cur.createdAt) / 1000) : null,
    nodeName: cur.nodeName ?? null,
    phase: cur.phase ?? null,
  };
}

/** Appends a sample and drops everything older than the retention window. */
export function pushHistory(history: PerfSample[], sample: PerfSample, windowMs = PERF_HISTORY_MS): PerfSample[] {
  const cutoff = sample.t - windowMs;
  const next = [...history, sample];
  const first = next.findIndex((s) => s.t >= cutoff);
  return first > 0 ? next.slice(first) : next;
}

/** Interval in ms, with the Kubernetes floor applied (metrics-server only refreshes every ~15-60 s). */
export function resolveIntervalMs(
  kind: 'ssh' | 'k8s',
  sec: number | undefined,
  /** Remote SSH sampling on Windows (new connection per sample). Never set for local panes or other platforms. */
  windowsRemoteSsh = false
): number {
  const base = Number.isFinite(sec) && (sec as number) > 0 ? (sec as number) : 5;
  const min = kind === 'k8s' ? PERF_K8S_MIN_INTERVAL_SEC : windowsRemoteSsh ? PERF_WIN_SSH_MIN_INTERVAL_SEC : 1;
  return Math.max(base, min) * 1000;
}

const K8S_ONLY: ReadonlySet<PerfMetricId> = new Set(['restarts', 'ready', 'age', 'node', 'resources']);
const K8S_SHARED: ReadonlySet<PerfMetricId> = new Set(['cpu', 'mem']);

/** Whether a metric id means anything for the given session type. */
export function metricApplies(kind: 'ssh' | 'k8s', id: PerfMetricId): boolean {
  if (kind === 'ssh') return !K8S_ONLY.has(id);
  return K8S_ONLY.has(id) || K8S_SHARED.has(id);
}

export const PERF_METRIC_LABELS: Record<PerfMetricId, string> = {
  cpu: 'CPU',
  mem: 'RAM',
  load: 'Load',
  swap: 'Swap',
  disk: 'Disk /',
  net: 'Net',
  uptime: 'Up',
  iowait: 'IOwait',
  steal: 'Steal',
  diskio: 'Disk I/O',
  procs: 'Procs',
  cores: 'Cores',
  cache: 'Cache',
  disks: 'Disks',
  latency: 'Ping',
  restarts: 'Restarts',
  ready: 'Ready',
  age: 'Age',
  node: 'Node',
  resources: 'Req/Lim',
};

/** Bytes with at most one decimal ("538 B", "1.5 MB"); formatBytes keeps raw fractions for plain bytes. */
export function formatBytes1(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  const v = bytes / 1024 ** exp;
  return `${exp === 0 ? Math.round(v) : v.toFixed(1)} ${units[exp]}`;
}

export const formatPct = (v: number | null): string => (v === null ? '–' : `${Math.round(v)}%`);

export function formatUptime(sec: number | null): string {
  if (sec === null) return '–';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const fmtMilli = (v: number | null): string => (v === null ? '–' : `${Math.round(v)}m`);
const fmtMem = (v: number | null): string => (v === null ? '–' : formatBytes1(v));

/** The text after the label, e.g. "23%" for CPU. Shared by the bar, the gauges and the tooltip. */
export function metricValue(kind: 'ssh' | 'k8s', id: PerfMetricId, s: PerfSample): string {
  switch (id) {
    case 'cpu':
      if (kind === 'k8s') {
        return s.cpuPct === null ? fmtMilli(s.cpuMillicores) : `${fmtMilli(s.cpuMillicores)} (${formatPct(s.cpuPct)})`;
      }
      return formatPct(s.cpuPct);
    case 'mem':
      if (kind === 'k8s') {
        return s.memPct === null ? fmtMem(s.memUsedBytes) : `${fmtMem(s.memUsedBytes)} (${formatPct(s.memPct)})`;
      }
      return formatPct(s.memPct);
    case 'load':
      return s.load ? s.load.map((n) => n.toFixed(1)).join(' ') : '–';
    case 'swap':
      return formatPct(s.swapPct);
    case 'disk':
      return formatPct(s.diskPct);
    case 'net':
      return s.rxBps === null || s.txBps === null ? '–' : `↓${formatBytes1(s.rxBps)}/s ↑${formatBytes1(s.txBps)}/s`;
    case 'uptime':
      return formatUptime(s.uptimeSec);
    case 'iowait':
      return formatPct(s.iowaitPct);
    case 'steal':
      return formatPct(s.stealPct);
    case 'diskio':
      return s.diskReadBps === null || s.diskWriteBps === null
        ? '–'
        : `R ${formatBytes1(s.diskReadBps)}/s W ${formatBytes1(s.diskWriteBps)}/s`;
    case 'procs':
      return s.procsRunning === null || s.procsTotal === null ? '–' : `${s.procsRunning}/${s.procsTotal}`;
    case 'cores':
      return s.corePcts ? s.corePcts.map((p) => Math.round(p)).join(' ') : '–';
    case 'cache':
      return fmtMem(s.cacheBytes);
    case 'disks':
      return s.disks && s.disks.length ? s.disks.map((d) => `${d.mount} ${d.usedPct}%`).join(' · ') : '–';
    case 'latency':
      return s.latencyMs === null ? '–' : `${Math.round(s.latencyMs)} ms`;
    case 'restarts':
      return String(s.restarts ?? '–');
    case 'ready':
      return s.ready === null ? '–' : s.ready ? 'yes' : 'no';
    case 'age':
      return formatUptime(s.ageSec);
    case 'node':
      return s.nodeName ?? '–';
    case 'resources':
      return `CPU ${fmtMilli(s.cpuRequestMillicores)}/${fmtMilli(s.cpuLimitMillicores)} RAM ${fmtMem(s.memRequestBytes)}/${fmtMem(s.memLimitBytes)}`;
  }
}

/** One-line text for a metric, e.g. "CPU 23%". */
export function metricText(kind: 'ssh' | 'k8s', id: PerfMetricId, s: PerfSample): string {
  return `${PERF_METRIC_LABELS[id]} ${metricValue(kind, id, s)}`;
}

/** Multi-line hover text with every metric that applies to the session type, whether or not the bar shows it. */
export function tooltipText(kind: 'ssh' | 'k8s', s: PerfSample, title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(title);
  if (kind === 'k8s' && s.phase) lines.push(`Phase ${s.phase}`);
  for (const id of Object.keys(PERF_METRIC_LABELS) as PerfMetricId[]) {
    if (!metricApplies(kind, id)) continue;
    lines.push(metricText(kind, id, s));
  }
  if (kind === 'ssh' && s.memUsedBytes !== null && s.memTotalBytes !== null) {
    lines.push(`RAM used ${formatBytes1(s.memUsedBytes)} of ${formatBytes1(s.memTotalBytes)}`);
  }
  if (kind === 'ssh' && s.cores !== null) lines.push(`${s.cores} cores`);
  lines.push('Click for history');
  return lines.join('\n');
}

/** Value used for bar fill / sparkline y-axis (0-100), or null if the metric has no percentage. */
export function metricPercent(kind: 'ssh' | 'k8s', id: PerfMetricId, s: PerfSample): number | null {
  switch (id) {
    case 'cpu':
      return s.cpuPct;
    case 'mem':
      return s.memPct;
    case 'swap':
      return s.swapPct;
    case 'disk':
      return s.diskPct;
    case 'iowait':
      return s.iowaitPct;
    case 'steal':
      return s.stealPct;
    case 'load':
      return kind === 'ssh' && s.load && s.cores ? clampPct((100 * s.load[0]) / s.cores) : null;
    default:
      return null;
  }
}

export interface PerfChartSeries {
  name: string;
  color: string;
  get: (s: PerfSample) => number | null;
}

export interface PerfChartDef {
  id: string;
  title: string;
  /** 'pct' charts are fixed 0-100; others scale to the data. */
  unit: 'pct' | 'bytesPerSec' | 'ms' | 'millicores' | 'bytes' | 'load';
  series: PerfChartSeries[];
}

/** Which charts the detail view draws. Only those with at least one data point are rendered. */
export function chartDefs(kind: 'ssh' | 'k8s'): PerfChartDef[] {
  if (kind === 'k8s') {
    return [
      { id: 'cpu', title: 'CPU', unit: 'millicores', series: [{ name: 'usage', color: '#38bdf8', get: (s) => s.cpuMillicores }] },
      { id: 'mem', title: 'Memory', unit: 'bytes', series: [{ name: 'usage', color: '#a78bfa', get: (s) => s.memUsedBytes }] },
    ];
  }
  return [
    { id: 'cpu', title: 'CPU', unit: 'pct', series: [
      { name: 'busy', color: '#38bdf8', get: (s) => s.cpuPct },
      { name: 'iowait', color: '#f59e0b', get: (s) => s.iowaitPct },
      { name: 'steal', color: '#f43f5e', get: (s) => s.stealPct },
    ] },
    { id: 'mem', title: 'Memory', unit: 'pct', series: [{ name: 'used', color: '#a78bfa', get: (s) => s.memPct }] },
    { id: 'swap', title: 'Swap', unit: 'pct', series: [{ name: 'used', color: '#f472b6', get: (s) => s.swapPct }] },
    { id: 'load', title: 'Load (1 min)', unit: 'load', series: [{ name: '1 min', color: '#34d399', get: (s) => s.load?.[0] ?? null }] },
    { id: 'net', title: 'Network', unit: 'bytesPerSec', series: [
      { name: '↓ rx', color: '#38bdf8', get: (s) => s.rxBps },
      { name: '↑ tx', color: '#f59e0b', get: (s) => s.txBps },
    ] },
    { id: 'diskio', title: 'Disk I/O', unit: 'bytesPerSec', series: [
      { name: 'read', color: '#34d399', get: (s) => s.diskReadBps },
      { name: 'write', color: '#f472b6', get: (s) => s.diskWriteBps },
    ] },
    { id: 'latency', title: 'Latency', unit: 'ms', series: [{ name: 'round trip', color: '#fbbf24', get: (s) => s.latencyMs }] },
  ];
}

export function formatChartValue(unit: PerfChartDef['unit'], v: number): string {
  switch (unit) {
    case 'pct':
      return `${Math.round(v)}%`;
    case 'bytesPerSec':
      return `${formatBytes1(v)}/s`;
    case 'bytes':
      return formatBytes1(v);
    case 'ms':
      return `${Math.round(v)} ms`;
    case 'millicores':
      return `${Math.round(v)}m`;
    case 'load':
      return v.toFixed(1);
  }
}

/** Green / amber / red for a 0-100 utilisation figure (same thresholds as the bar). */
export function levelColor(pct: number | null): string {
  return pct === null ? '#64748b' : pct < 60 ? '#10b981' : pct < 85 ? '#f59e0b' : '#f43f5e';
}

export interface PerfSegment {
  label: string;
  value: number;
  color: string;
}

/** CPU time split for the donut: user+system, iowait, steal and idle (sums to 100). Null without a delta. */
export function cpuSplit(s: PerfSample): PerfSegment[] | null {
  if (s.cpuPct === null) return null;
  const steal = s.stealPct ?? 0;
  const iowait = s.iowaitPct ?? 0;
  const busy = Math.max(0, s.cpuPct - steal);
  const idle = Math.max(0, 100 - busy - steal - iowait);
  return [
    { label: 'user+sys', value: busy, color: '#38bdf8' },
    { label: 'iowait', value: iowait, color: '#f59e0b' },
    { label: 'steal', value: steal, color: '#f43f5e' },
    { label: 'idle', value: idle, color: '#334155' },
  ];
}

/** RAM split in bytes: used by programs, reclaimable cache, free. "Used" is total - available, so cache is separate. */
export function ramSplit(s: PerfSample): PerfSegment[] | null {
  if (s.memTotalBytes === null || s.memUsedBytes === null) return null;
  const cache = Math.min(s.cacheBytes ?? 0, Math.max(0, s.memTotalBytes - s.memUsedBytes));
  const free = Math.max(0, s.memTotalBytes - s.memUsedBytes - cache);
  return [
    { label: 'used', value: s.memUsedBytes, color: '#a78bfa' },
    { label: 'cache', value: cache, color: '#38bdf8' },
    { label: 'free', value: free, color: '#334155' },
  ];
}

/** Highest value of a series over the retained history, used to scale the ↓/↑ and R/W bars. */
export function seriesPeak(history: PerfSample[], get: (s: PerfSample) => number | null): number {
  let peak = 0;
  for (const s of history) {
    const v = get(s);
    if (v !== null && v > peak) peak = v;
  }
  return peak;
}
