/** Metric ids selectable in Settings. Not every metric exists for every session type. */
export const PERF_METRIC_IDS = [
  'cpu',
  'mem',
  'load',
  'swap',
  'disk',
  'net',
  'uptime',
  'iowait',
  'steal',
  'diskio',
  'procs',
  'cores',
  'cache',
  'disks',
  'latency',
  'restarts',
  'ready',
  'age',
  'node',
  'resources',
] as const;
export type PerfMetricId = (typeof PERF_METRIC_IDS)[number];

export type PerfLayout = 'text' | 'bars' | 'sparklines';
export const PERF_LAYOUTS: readonly PerfLayout[] = ['text', 'bars', 'sparklines'];

export const PERF_INTERVALS_SEC = [2, 5, 10, 30] as const;
/** metrics-server only refreshes every ~15-60 s, so polling faster than this is pointless. */
export const PERF_K8S_MIN_INTERVAL_SEC = 10;
/** Windows has no ssh multiplexing, so every remote sample is a fresh connection; don't do that more often than this. */
export const PERF_WIN_SSH_MIN_INTERVAL_SEC = 10;

export const DEFAULT_PERF_ITEMS: PerfMetricId[] = ['cpu', 'mem', 'load'];

/** Raw counters read from a Linux host's /proc. Rates are derived in the renderer from two samples. */
export interface PerfSshRaw {
  /** Epoch ms when the sample was taken (main process clock). */
  t: number;
  /** Aggregate jiffies (user+nice+system+idle+iowait+irq+softirq+steal). */
  cpuTotal: number;
  /** idle + iowait jiffies. */
  cpuIdle: number;
  /** iowait / steal jiffies (subsets of cpuTotal). */
  cpuIowait?: number;
  cpuSteal?: number;
  /** Per-core aggregate/idle jiffies, in cpu0..cpuN order. */
  perCore?: Array<{ total: number; idle: number }>;
  cores: number;
  /** Absent where the platform has no load average (Windows). */
  load?: [number, number, number];
  memTotalKb: number;
  memAvailKb: number;
  swapTotalKb: number;
  swapFreeKb: number;
  /** Used percentage of the root filesystem, when df produced a parsable line. */
  diskUsedPct?: number;
  /** Every real (block-device) filesystem reported by df. */
  disks?: Array<{ mount: string; usedPct: number; sizeKb: number }>;
  /** Cumulative bytes read/written on physical disks (/proc/diskstats, 512-byte sectors). */
  diskReadBytes?: number;
  diskWriteBytes?: number;
  /** Tasks currently runnable / total scheduling entities (/proc/loadavg field 4). */
  procsRunning?: number;
  procsTotal?: number;
  /** Buffers + page cache + reclaimable slab. */
  memCacheKb?: number;
  /** Round-trip time of the sampling command itself (ssh only), measured in main. */
  latencyMs?: number;
  /** Cumulative bytes over all non-loopback interfaces. Absent where unavailable (local shell on macOS/Windows). */
  netRxBytes?: number;
  netTxBytes?: number;
  uptimeSec: number;
}

export type PerfSshResult =
  | { ok: true; raw: PerfSshRaw }
  | { ok: false; reason: 'no-session' | 'unsupported' | 'auth-unsupported' | 'error' };

export interface PerfK8sTarget {
  contextName: string;
  namespace: string;
  podName: string;
  containerName: string;
}

export interface PerfK8sRaw {
  t: number;
  cpuMillicores: number;
  memBytes: number;
  cpuLimitMillicores?: number;
  memLimitBytes?: number;
  restarts: number;
  phase?: string;
  cpuRequestMillicores?: number;
  memRequestBytes?: number;
  ready?: boolean;
  /** Pod creation time, epoch ms. */
  createdAt?: number;
  nodeName?: string;
}

export type PerfK8sResult =
  | { ok: true; raw: PerfK8sRaw }
  | { ok: false; reason: 'no-metrics' | 'forbidden' | 'error' };

/** Derived, display-ready numbers. null = not available for this sample. */
export interface PerfSample {
  t: number;
  cpuPct: number | null;
  memPct: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
  load: [number, number, number] | null;
  cores: number | null;
  swapPct: number | null;
  diskPct: number | null;
  rxBps: number | null;
  txBps: number | null;
  uptimeSec: number | null;
  restarts: number | null;
  iowaitPct: number | null;
  stealPct: number | null;
  corePcts: number[] | null;
  diskReadBps: number | null;
  diskWriteBps: number | null;
  procsRunning: number | null;
  procsTotal: number | null;
  cacheBytes: number | null;
  disks: Array<{ mount: string; usedPct: number; sizeKb: number }> | null;
  latencyMs: number | null;
  /** K8s only: absolute usage, since percentages need a limit. */
  cpuMillicores: number | null;
  cpuRequestMillicores: number | null;
  cpuLimitMillicores: number | null;
  memRequestBytes: number | null;
  memLimitBytes: number | null;
  ready: boolean | null;
  ageSec: number | null;
  nodeName: string | null;
  phase: string | null;
}

/** How much history is kept for the sparklines and the detail view. */
export const PERF_HISTORY_MS = 15 * 60 * 1000;
