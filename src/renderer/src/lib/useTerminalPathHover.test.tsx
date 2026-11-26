// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTerminalPathHover } from './useTerminalPathHover';

type Api = Record<string, unknown>;

function setup(api: Api) {
  (window as unknown as { multissh: Api }).multissh = api;
  const notify = vi.fn();
  const hook = renderHook(() =>
    useTerminalPathHover({
      target: { local: true },
      pathHoverPreview: true,
      termRef: { current: null },
      sessionIdRef: { current: null },
      notify,
    })
  );
  const handlers = hook.result.current.createLinkHandlers();
  const hover = async (path: string) => {
    await act(async () => {
      handlers.hoverPath?.({ clientX: 10, clientY: 10, ctrlKey: false, metaKey: false } as MouseEvent, path);
      await vi.advanceTimersByTimeAsync(700);
    });
  };
  return { hook, notify, hover };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { multissh?: Api }).multissh;
});

describe('useTerminalPathHover: existence gate after a failed connect', () => {
  it('shows the card while the connection is down, then hides it for a missing file once it works', async () => {
    const connectStorage = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined);
    const { hook, hover } = setup({
      connectStorage,
      storageLookup: vi.fn().mockResolvedValue(null), // the file does not exist
    });

    // Connection failed: a miss is inconclusive, so the card is shown as before.
    await hover('/srv/missing/one.ts');
    expect(hook.result.current.hoverCardData?.path).toBe('/srv/missing/one.ts');

    // After the retry back-off the connection succeeds; a miss now means the file is really missing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await hover('/srv/missing/two.ts');
    expect(connectStorage).toHaveBeenCalledTimes(2);
    expect(hook.result.current.hoverCardData?.path).not.toBe('/srv/missing/two.ts');
  });
});

describe('useTerminalPathHover: onCopyPath', () => {
  const copy = async (writeText: ((t: string) => Promise<void>) | undefined) => {
    Object.defineProperty(navigator, 'clipboard', { value: writeText ? { writeText } : undefined, configurable: true });
    const { hook, notify } = setup({});
    await act(async () => {
      hook.result.current.cardProps.onCopyPath('/etc/hosts');
    });
    return { hook, notify };
  };

  it('reports success only after the clipboard accepted the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { notify } = await copy(writeText);
    expect(writeText).toHaveBeenCalledWith('/etc/hosts');
    expect(notify).toHaveBeenCalledWith('Copied path: /etc/hosts', 2000);
  });

  it('reports a failure when the clipboard rejects, without an unhandled rejection', async () => {
    const { notify } = await copy(vi.fn().mockRejectedValue(new Error('denied')));
    expect(notify).toHaveBeenCalledWith('Failed to copy path', 3000);
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('Copied'), expect.anything());
  });

  it('reports a failure when there is no clipboard', async () => {
    const { notify } = await copy(undefined);
    expect(notify).toHaveBeenCalledWith('Failed to copy path', 3000);
  });
});
