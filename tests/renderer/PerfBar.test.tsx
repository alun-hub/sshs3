// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PerfBar } from '../../src/renderer/src/components/PerfBar';
import { TerminalView } from '../../src/renderer/src/components/TerminalView';
import { computeK8sSample, computeSshSample } from '../../src/renderer/src/lib/perfMetrics';
import type { PerfSshRaw } from '../../src/shared/types/perf';
import type { SSHConnectionConfig } from '../../src/shared/types/ssh';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })),
});

const raw: PerfSshRaw = {
  t: 1000,
  cpuTotal: 1000,
  cpuIdle: 800,
  cores: 4,
  load: [1, 0.5, 0.25],
  memTotalKb: 1000,
  memAvailKb: 250,
  swapTotalKb: 100,
  swapFreeKb: 50,
  diskUsedPct: 90,
  netRxBytes: 0,
  netTxBytes: 0,
  uptimeSec: 3700,
};
const history = [computeSshSample(null, raw)];

describe('PerfBar', () => {
  afterEach(cleanup);

  it('shows placeholder text until the first sample arrives', () => {
    render(<PerfBar kind="ssh" state={{ history: [], status: 'loading' }} layout="text" items={['cpu']} />);
    expect(screen.getByTestId('perf-bar')).toHaveTextContent('Reading metrics…');
  });

  it('shows the reason when unavailable', () => {
    render(
      <PerfBar kind="k8s" state={{ history: [], status: 'unavailable', reason: 'metrics-server not available' }} layout="text" items={['cpu']} />
    );
    expect(screen.getByTestId('perf-bar')).toHaveTextContent('metrics-server not available');
  });

  it('text layout renders only the selected metrics that apply', () => {
    render(<PerfBar kind="ssh" state={{ history, status: 'ok' }} layout="text" items={['mem', 'load', 'restarts']} />);
    const bar = screen.getByTestId('perf-bar');
    expect(bar).toHaveTextContent('RAM 75%');
    expect(bar).toHaveTextContent('Load 1.0 0.5 0.3');
    expect(bar).not.toHaveTextContent('Restarts');
  });

  it('bars layout draws a fill sized to the percentage', () => {
    const { container } = render(
      <PerfBar kind="ssh" state={{ history, status: 'ok' }} layout="bars" items={['disk']} />
    );
    const fill = container.querySelector('span[style]') as HTMLElement;
    expect(fill.style.width).toBe('90%');
    expect(fill.className).toContain('bg-rose-500');
  });

  it('sparklines layout draws an svg polyline', () => {
    const { container } = render(
      <PerfBar kind="ssh" state={{ history, status: 'ok' }} layout="sparklines" items={['mem']} />
    );
    expect(container.querySelector('svg polyline')).not.toBeNull();
  });
});

describe('TerminalView perf bar', () => {
  const config: SSHConnectionConfig = {
    id: 'ssh-1',
    name: 'Prod',
    host: 'prod.example.com',
    port: 22,
    username: 'admin',
    authType: 'password',
  };
  const perfSshSample = vi.fn();

  beforeEach(() => {
    perfSshSample.mockReset().mockResolvedValue({ ok: true, raw });
    window.multissh = {
      terminalCreate: vi.fn().mockResolvedValue({ sessionId: 'session-123' }),
      terminalWrite: vi.fn().mockResolvedValue(undefined),
      terminalResize: vi.fn().mockResolvedValue(undefined),
      terminalKill: vi.fn().mockResolvedValue(undefined),
      onTerminalData: vi.fn(() => vi.fn()),
      onTerminalExit: vi.fn(() => vi.fn()),
      perfSshSample,
    } as any;
  });
  afterEach(cleanup);

  it('renders no bar and polls nothing when the feature is off', async () => {
    render(<TerminalView config={config} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('perf-bar')).toBeNull();
    expect(perfSshSample).not.toHaveBeenCalled();
  });

  it('polls the SSH session and renders the bar when enabled', async () => {
    render(<TerminalView config={config} perfMetrics={{ layout: 'text', items: ['mem'], intervalSec: 5 }} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(perfSshSample).toHaveBeenCalledWith('session-123');
    await waitFor(() => expect(screen.getByTestId('perf-bar')).toHaveTextContent('RAM 75%'));
  });

  it('samples the local machine for local shells, without an SSH session', async () => {
    const perfLocalSample = vi.fn().mockResolvedValue({ ok: true, raw });
    (window.multissh as any).perfLocalSample = perfLocalSample;
    render(<TerminalView local perfMetrics={{ layout: 'text', items: ['mem'] }} />);
    await waitFor(() => expect(screen.getByTestId('perf-bar')).toHaveTextContent('RAM 75%'));
    expect(perfLocalSample).toHaveBeenCalled();
    expect(perfSshSample).not.toHaveBeenCalled();
  });
});

describe('usePerfSamples history', () => {
  afterEach(cleanup);
  it('keeps history when the pane is deactivated and reactivated', async () => {
    const { usePerfSamples } = await import('../../src/renderer/src/lib/usePerfSamples');
    const { renderHook } = await import('@testing-library/react');
    window.multissh = { perfSshSample: vi.fn().mockResolvedValue({ ok: true, raw }) } as any;
    const { result, rerender } = renderHook(({ active }) => usePerfSamples({ sshSessionId: 's1', active }), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.history.length).toBe(1));
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.history.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PerfBar interactions', () => {
  afterEach(cleanup);

  it('puts every metric in the hover tooltip, even ones the bar hides', () => {
    render(<PerfBar kind="ssh" state={{ history, status: 'ok' }} layout="text" items={['cpu']} title="prod" />);
    const title = screen.getByTestId('perf-bar').getAttribute('title') ?? '';
    expect(title).toContain('prod');
    expect(title).toContain('RAM 75%');
    expect(title).toContain('Swap 50%');
    expect(screen.getByTestId('perf-bar')).not.toHaveTextContent('Swap');
  });

  it('opens the history view on click and closes it with Escape', () => {
    render(<PerfBar kind="ssh" state={{ history, status: 'ok' }} layout="text" items={['cpu']} />);
    expect(screen.queryByTestId('perf-detail')).toBeNull();
    fireEvent.click(screen.getByTestId('perf-bar'));
    expect(screen.getByTestId('perf-detail')).toBeInTheDocument();
    expect(screen.getByTestId('perf-chart-mem')).toBeInTheDocument();
    expect(screen.getByTestId('perf-detail-values')).toHaveTextContent('Swap 50%');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('perf-detail')).toBeNull();
  });

  it('draws per-core bars in graphical layouts', () => {
    const withCores = [
      { ...history[0], corePcts: [10, 90] },
    ];
    const { container } = render(
      <PerfBar kind="ssh" state={{ history: withCores, status: 'ok' }} layout="bars" items={['cores']} />
    );
    expect(container.querySelectorAll('span[style]').length).toBe(2);
  });
});

describe('PerfDetailModal graphics', () => {
  afterEach(cleanup);

  const rich = {
    ...history[0],
    cpuPct: 40,
    iowaitPct: 10,
    stealPct: 0,
    corePcts: [20, 80, 5, 5],
    rxBps: 1000,
    txBps: 500,
    diskReadBps: 0,
    diskWriteBps: 2048,
    cacheBytes: 100 * 1024,
    disks: [
      { mount: '/', usedPct: 9, sizeKb: 1000 },
      { mount: '/boot', usedPct: 71, sizeKb: 500 },
    ],
    procsRunning: 1,
    procsTotal: 176,
    latencyMs: 56.2,
  };

  it('renders donuts, bars, per-core chart and stat tiles for an SSH host', () => {
    render(<PerfBar kind="ssh" state={{ history: [rich], status: 'ok' }} layout="text" items={['cpu']} />);
    fireEvent.click(screen.getByTestId('perf-bar'));
    for (const id of ['cpu', 'ram', 'load', 'disks', 'cores', 'net', 'diskio', 'swap'])
      expect(screen.getByTestId(`perf-card-${id}`)).toBeInTheDocument();
    expect(screen.getByTestId('perf-card-disks')).toHaveTextContent('/boot');
    expect(screen.getByTestId('perf-card-disks')).toHaveTextContent('71%');
    expect(screen.getByTestId('perf-card-cpu')).toHaveTextContent('iowait');
    expect(screen.getByTestId('perf-tile-ping')).toHaveTextContent('56 ms');
    expect(screen.getByTestId('perf-tile-procs')).toHaveTextContent('1/176');
    expect(screen.queryByTestId('perf-card-resources')).toBeNull();
  });

  it('skips cards without data instead of drawing empty ones', () => {
    render(<PerfBar kind="ssh" state={{ history, status: 'ok' }} layout="text" items={['cpu']} />);
    fireEvent.click(screen.getByTestId('perf-bar'));
    expect(screen.queryByTestId('perf-card-cpu')).toBeNull(); // first sample: no CPU delta
    expect(screen.queryByTestId('perf-card-net')).toBeNull();
    expect(screen.getByTestId('perf-card-ram')).toBeInTheDocument();
  });

  it('shows request / limit bars and pod tiles for Kubernetes', () => {
    const pod = computeK8sSample({
      t: 100_000,
      cpuMillicores: 150,
      memBytes: 64 * 1024 * 1024,
      cpuRequestMillicores: 100,
      cpuLimitMillicores: 200,
      memRequestBytes: 32 * 1024 * 1024,
      memLimitBytes: 128 * 1024 * 1024,
      restarts: 2,
      ready: true,
      createdAt: 100_000 - 7200_000,
      nodeName: 'node-1',
      phase: 'Running',
    });
    const { container } = render(<PerfBar kind="k8s" state={{ history: [pod], status: 'ok' }} layout="text" items={['cpu']} />);
    fireEvent.click(screen.getByTestId('perf-bar'));
    void container;
    expect(screen.getByTestId('perf-card-resources')).toHaveTextContent('req 100m');
    expect(screen.getByTestId('perf-card-resources')).toHaveTextContent('lim 200m');
    expect(screen.getByTestId('perf-tile-node')).toHaveTextContent('node-1');
    expect(screen.getByTestId('perf-tile-ready')).toHaveTextContent('yes');
    expect(screen.getByTestId('perf-tile-age')).toHaveTextContent('2h 0m');
    expect(screen.queryByTestId('perf-card-load')).toBeNull();
  });
});
