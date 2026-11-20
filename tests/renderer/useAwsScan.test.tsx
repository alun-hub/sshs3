// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAwsScan } from '../../src/renderer/src/lib/useAwsScan';

let progressCb: ((e: { scanId: string; done: number; total: number }) => void) | undefined;
let release: ((r: unknown) => void) | undefined;
const unsubscribe = vi.fn();
const api = {
  onAwsSsmScanProgress: vi.fn((cb) => { progressCb = cb; return unsubscribe; }),
  awsSsmScan: vi.fn((_req: { scanId: string }) => new Promise((resolve) => { release = resolve; })),
  awsSsmScanCancel: vi.fn(async () => undefined),
};
const request = { targets: [{ id: 't', label: 't', source: { kind: 'default' as const } }], regions: ['eu-north-1', 'us-east-1'] };

beforeEach(() => { Object.values(api).forEach((f) => f.mockClear()); unsubscribe.mockClear(); window.multissh = { ...api } as never; });

describe('useAwsScan', () => {
  it('reports progress for its own scan only and ends with the result', async () => {
    const { result } = renderHook(() => useAwsScan());
    let done!: Promise<void>;
    act(() => { done = result.current.start(request); });
    expect(result.current.state).toMatchObject({ phase: 'running', progress: { done: 0, total: 2 } });
    const scanId = api.awsSsmScan.mock.calls[0][0].scanId;
    act(() => progressCb!({ scanId: 'someone-else', done: 9, total: 9 }));
    expect(result.current.state.progress.done).toBe(0);
    act(() => progressCb!({ scanId, done: 1, total: 2 }));
    expect(result.current.state.progress).toEqual({ done: 1, total: 2 });
    await act(async () => { release!({ instances: [], skipped: [], truncated: false, searched: 2 }); await done; });
    expect(result.current.state).toMatchObject({ phase: 'done', cancelled: false, result: { searched: 2 } });
  });

  it('cancels, keeps the partial result and marks it cancelled', async () => {
    const { result } = renderHook(() => useAwsScan());
    let done!: Promise<void>;
    act(() => { done = result.current.start(request); });
    const scanId = api.awsSsmScan.mock.calls[0][0].scanId;
    act(() => result.current.cancel());
    expect(api.awsSsmScanCancel).toHaveBeenCalledWith(scanId);
    await act(async () => { release!({ instances: [{ instanceId: 'i-1' }], skipped: [], truncated: false, searched: 1 }); await done; });
    expect(result.current.state).toMatchObject({ phase: 'done', cancelled: true });
  });

  it('shows a failure and can be reset', async () => {
    api.awsSsmScan.mockRejectedValueOnce(new Error('Error invoking remote method: Error: AWS SSO session expired: sign in again to continue.'));
    const { result } = renderHook(() => useAwsScan());
    await act(async () => { await result.current.start(request); });
    expect(result.current.state.phase).toBe('error');
    expect(result.current.state.error).toMatch(/^.*AWS SSO session expired/);
    act(() => result.current.reset());
    expect(result.current.state.phase).toBe('idle');
  });

  it('stops a scan that is still running when the dialog goes away', async () => {
    const { result, unmount } = renderHook(() => useAwsScan());
    act(() => { void result.current.start(request); });
    const scanId = api.awsSsmScan.mock.calls[0][0].scanId;
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    await waitFor(() => expect(api.awsSsmScanCancel).toHaveBeenCalledWith(scanId));
  });
});
