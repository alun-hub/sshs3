// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ExternalFileStatusEvent } from '@shared/types/ipc';
import { useExternalOpenNotices } from './useExternalOpenNotices';

const event = (over: Partial<ExternalFileStatusEvent>): ExternalFileStatusEvent => ({
  sessionToken: 'tok',
  providerId: 'sftp-h',
  remotePath: '/etc/app.conf',
  status: 'uploaded',
  timestamp: '2026-11-26 19:00',
  ...over,
});

function setup() {
  let emit: (e: ExternalFileStatusEvent) => void = () => {};
  const unsubscribe = vi.fn();
  (window as unknown as { multissh: unknown }).multissh = {
    onExternalFileStatus: (cb: (e: ExternalFileStatusEvent) => void) => {
      emit = cb;
      return unsubscribe;
    },
  };
  const notify = vi.fn();
  const hook = renderHook(() => useExternalOpenNotices(notify));
  return { hook, notify, unsubscribe, emit: (e: ExternalFileStatusEvent) => act(() => emit(e)) };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { multissh?: unknown }).multissh;
});

describe('useExternalOpenNotices', () => {
  it('reports a successful upload of a tracked file', () => {
    const { hook, notify, emit } = setup();
    hook.result.current('tok', 'app.conf');
    emit(event({ status: 'uploaded' }));
    expect(notify).toHaveBeenCalledWith('Uploaded app.conf', 2000);
  });

  it('reports a failed upload with the reason, and says so when there is none', () => {
    const { hook, notify, emit } = setup();
    hook.result.current('tok', 'app.conf');
    emit(event({ status: 'error', error: 'Permission denied' }));
    emit(event({ status: 'error' }));
    expect(notify).toHaveBeenNthCalledWith(1, 'Upload of app.conf failed: Permission denied', 6000);
    expect(notify).toHaveBeenNthCalledWith(2, 'Upload of app.conf failed: unknown error', 6000);
  });

  it('ignores sessions it did not start (the editor dialog reports its own)', () => {
    const { hook, notify, emit } = setup();
    hook.result.current('tok', 'app.conf');
    emit(event({ sessionToken: 'someone-else', status: 'error', error: 'x' }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('stops listening when unmounted', () => {
    const { hook, unsubscribe } = setup();
    hook.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('works where the API is missing', () => {
    delete (window as unknown as { multissh?: unknown }).multissh;
    const { result } = renderHook(() => useExternalOpenNotices(vi.fn()));
    expect(() => result.current('tok', 'a')).not.toThrow();
  });
});
