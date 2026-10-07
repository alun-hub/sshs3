import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3', isPackaged: true },
  shell: { openPath: vi.fn() },
}));

import { registerLogHandlers, type LogHost } from '../../src/main/ipc/logHandlers';
import { IPC_CHANNELS } from '../../src/shared/types/ipc';
import { captureLogs } from './helpers/captureLogs';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

let clock = Date.parse('2026-10-07T12:00:00Z');

describe('log IPC handlers', () => {
  const handlers = new Map<string, Handler>();
  let logs: ReturnType<typeof captureLogs>;

  beforeEach(() => {
    handlers.clear();
    registerLogHandlers({ registerHandler: (channel: string, h: Handler) => void handlers.set(channel, h) } as unknown as LogHost);
    logs = captureLogs();
    vi.useFakeTimers();
    clock += 60_000; // the rate-limit window is module state: give every test its own
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.useRealTimers();
    logs.restore();
  });

  const write = (...args: unknown[]) => handlers.get(IPC_CHANNELS.LOG_WRITE)!({}, ...args);

  it('writes valid renderer entries under a renderer.* scope and masks secrets', async () => {
    await write('warn', 'SmartcardPinModal', 'failed', { pin: '1234', host: 'h' });
    expect(logs.lines).toHaveLength(1);
    expect(logs.lines[0]).toContain('[renderer.SmartcardPinModal]');
    expect(logs.text()).not.toContain('1234');
  });

  it('ignores malformed input', async () => {
    await write('verbose', 'x', 'm');
    await write('info', 5, 'm');
    await write('info', 'x', { not: 'a string' });
    expect(logs.lines).toHaveLength(0);
  });

  it('drops entries beyond the per-second rate limit and recovers next second', async () => {
    for (let i = 0; i < 150; i++) await write('info', 'flood', `m${i}`);
    expect(logs.lines).toHaveLength(100);
    vi.setSystemTime(clock + 2000);
    await write('info', 'flood', 'again');
    expect(logs.lines).toHaveLength(101);
  });

  it('returns a diagnostics header with version and level', async () => {
    const text = (await handlers.get(IPC_CHANNELS.LOG_GET_DIAGNOSTICS)!({})) as string;
    expect(text).toContain('sshs3 1.2.3 (packaged)');
    expect(text).toContain('log level: debug');
  });
});
